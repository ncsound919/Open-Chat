package com.openchat.onnximagegen

import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.TensorInfo
import ai.onnxruntime.providers.NNAPIFlags
import android.util.Log
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.nio.IntBuffer
import java.util.EnumSet
import java.util.Random
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * On-device Stable Diffusion 1.5 pipeline via ONNX Runtime. Supports both
 * fp32 and fp16 (Olive/onnxruntime-optimized) sub-models by inspecting each
 * session's input/output tensor types and converting accordingly.
 *
 * Flow: CLIP tokenize -> text_encoder x2 (cond/uncond) -> Karras sigma
 * schedule -> UNet denoise loop with CFG (batch=2) -> VAE decode -> PNG.
 * The UNet is routed through NNAPI (USE_FP16) when available for NPU speed.
 */
class SdInferencePipeline(
    private val baseDir: File,
    private val numInferenceSteps: Int = 12,
    private val cfgScale: Float = 7.5f,
    private val width: Int = 512,
    private val height: Int = 512,
) {
    private val latentH = height / 8
    private val latentW = width / 8
    private val ortEnv = OrtEnvironment.getEnvironment()

    fun generate(prompt: String, outputPath: String): Long {
        val totalT0 = System.currentTimeMillis()
        Log.d("SdInferencePipeline", "pipe: prompt='${prompt.take(60)}' steps=$numInferenceSteps cfg=$cfgScale")

        val tok = ClipTokenizer(File(baseDir, "tokenizer"))
        val condIds = tok.encode(prompt, ClipTokenizer.MAX_LENGTH)
        val uncondIds = tok.encode("", ClipTokenizer.MAX_LENGTH)

        val teSession = ortEnv.createSession(File(baseDir, "text_encoder/model.onnx").absolutePath, sessionOptions())
        val teOutputType = outputType(teSession, "last_hidden_state")
        val condHidden = runTextEncoder(teSession, condIds, teOutputType)
        val uncondHidden = runTextEncoder(teSession, uncondIds, teOutputType)
        teSession.close()

        val sched = DpmScheduler()
        val sigmas = sched.karrasSigmas(numInferenceSteps)
        val timesteps = sched.karrasTimesteps(sigmas)
        val seed = prompt.hashCode().toLong()
        var latent = gaussianLatent(seed, sigmas[0])

        val unetSession = ortEnv.createSession(File(baseDir, "unet/model.onnx").absolutePath, sessionOptionsUnet())
        val unetSampleType = inputType(unetSession, "sample")
        val unetTsType = inputType(unetSession, "timestep")
        val unetHiddenType = inputType(unetSession, "encoder_hidden_states")
        val unetOutType = outputType(unetSession, "out_sample")
        try {
            for (k in 0 until numInferenceSteps) {
                val sigmaCurrent = sigmas[k]
                val sigmaNext = sigmas[k + 1]
                val scaleFactor = 1f / sqrt(sigmaCurrent * sigmaCurrent + 1f)
                val scaledSample = FloatArray(latent.size) { latent[it] * scaleFactor }
                val stepT0 = System.currentTimeMillis()
                val noisePred = runUnetCfg(
                    unetSession, scaledSample, timesteps[k].toFloat(),
                    condHidden, uncondHidden,
                    unetSampleType, unetTsType, unetHiddenType, unetOutType,
                )
                latent = sched.stepEuler(latent, noisePred, sigmaCurrent, sigmaNext)
                Log.d("SdInferencePipeline", "pipe: step ${k + 1}/$numInferenceSteps ${System.currentTimeMillis() - stepT0}ms")
            }
        } finally {
            unetSession.close()
        }

        val vaeSession = ortEnv.createSession(File(baseDir, "vae_decoder/model.onnx").absolutePath, sessionOptions())
        val vaeInputType = inputType(vaeSession, "latent_sample")
        val vaeOutputType = outputType(vaeSession, "sample")
        val image: FloatArray
        try {
            val scaled = FloatArray(latent.size) { latent[it] / 0.18215f }
            image = runVaeDecoder(vaeSession, scaled, vaeInputType, vaeOutputType)
        } finally {
            vaeSession.close()
        }

        val bitmap = floatChwToBitmap(image, width, height)
        FileOutputStream(File(outputPath)).use { out -> bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, out) }
        bitmap.recycle()
        return System.currentTimeMillis() - totalT0
    }

    private fun sessionOptions(): OrtSession.SessionOptions {
        val opts = OrtSession.SessionOptions()
        opts.setMemoryPatternOptimization(false)
        opts.setCPUArenaAllocator(false)
        return opts
    }

    private fun sessionOptionsUnet(): OrtSession.SessionOptions {
        val opts = sessionOptions()
        try {
            opts.addNnapi(EnumSet.of(NNAPIFlags.USE_FP16))
        } catch (e: Throwable) {
            Log.w("SdInferencePipeline", "UNet: NNAPI add failed, CPU fallback: ${e.message}")
        }
        return opts
    }

    private fun inputType(session: OrtSession, name: String): OnnxJavaType {
        val info = session.inputInfo[name]?.info as? TensorInfo ?: return OnnxJavaType.FLOAT
        return info.type
    }

    private fun outputType(session: OrtSession, name: String): OnnxJavaType {
        val info = session.outputInfo[name]?.info as? TensorInfo ?: return OnnxJavaType.FLOAT
        return info.type
    }

    private fun runTextEncoder(session: OrtSession, ids: IntArray, outType: OnnxJavaType): FloatArray {
        var idsTensor: OnnxTensor? = null
        try {
            // input_ids is INT32 in this ONNX SD text_encoder.
            idsTensor = OnnxTensor.createTensor(ortEnv, IntBuffer.wrap(ids), longArrayOf(1, ids.size.toLong()))
            val out = session.run(mapOf("input_ids" to idsTensor))
            val hidden = out.get("last_hidden_state").get() as OnnxTensor
            val n = hidden.info.shape.fold(1L) { acc, d -> acc * d }.toInt()
            val flat = if (outType == OnnxJavaType.FLOAT16) halfTensorToFloatArray(hidden, n) else FloatArray(n).also { hidden.floatBuffer.get(it) }
            hidden.close()
            out.close()
            return flat
        } finally {
            idsTensor?.close()
        }
    }

    private fun runUnetCfg(
        session: OrtSession,
        sample: FloatArray,
        timestep: Float,
        condHidden: FloatArray,
        uncondHidden: FloatArray,
        sampleType: OnnxJavaType,
        tsType: OnnxJavaType,
        hiddenType: OnnxJavaType,
        outType: OnnxJavaType,
    ): FloatArray {
        val perFrame = 4 * latentH * latentW
        require(sample.size == perFrame) { "sample size mismatch" }
        val sampleBatch = FloatArray(2 * perFrame)
        System.arraycopy(sample, 0, sampleBatch, 0, perFrame)
        System.arraycopy(sample, 0, sampleBatch, perFrame, perFrame)
        val perHidden = 77 * 768
        val hiddenBatch = FloatArray(2 * perHidden)
        System.arraycopy(uncondHidden, 0, hiddenBatch, 0, perHidden)
        System.arraycopy(condHidden, 0, hiddenBatch, perHidden, perHidden)
        val tsBatch = floatArrayOf(timestep, timestep)

        var sampleT: OnnxTensor? = null
        var tsT: OnnxTensor? = null
        var hiddenT: OnnxTensor? = null
        try {
            val sampleShape = longArrayOf(2, 4, latentH.toLong(), latentW.toLong())
            val hiddenShape = longArrayOf(2, 77, 768)
            val tsShape = longArrayOf(2)
            sampleT = createTensor(sampleBatch, sampleShape, sampleType)
            // UNet timestep is INT64 in the standard ONNX SD model.
            tsT = OnnxTensor.createTensor(
                ortEnv,
                java.nio.LongBuffer.wrap(tsBatch.map { it.toLong() }.toLongArray()),
                tsShape
            )
            hiddenT = createTensor(hiddenBatch, hiddenShape, hiddenType)
            val out = session.run(mapOf(
                "sample" to sampleT,
                "timestep" to tsT,
                "encoder_hidden_states" to hiddenT,
            ))
            val outSample = out.get("out_sample").get() as OnnxTensor
            val flat = if (outType == OnnxJavaType.FLOAT16) halfTensorToFloatArray(outSample, 2 * perFrame) else FloatArray(2 * perFrame).also { outSample.floatBuffer.get(it) }
            outSample.close()
            out.close()
            val combined = FloatArray(perFrame)
            for (i in 0 until perFrame) {
                val nUncond = flat[i]
                val nCond = flat[perFrame + i]
                combined[i] = nUncond + cfgScale * (nCond - nUncond)
            }
            return combined
        } finally {
            sampleT?.close()
            tsT?.close()
            hiddenT?.close()
        }
    }

    private fun runVaeDecoder(session: OrtSession, latent: FloatArray, inType: OnnxJavaType, outType: OnnxJavaType): FloatArray {
        var latentT: OnnxTensor? = null
        try {
            latentT = createTensor(latent, longArrayOf(1, 4, latentH.toLong(), latentW.toLong()), inType)
            val out = session.run(mapOf("latent_sample" to latentT))
            val image = out.get("sample").get() as OnnxTensor
            val n = image.info.shape.fold(1L) { acc, d -> acc * d }.toInt()
            val flat = if (outType == OnnxJavaType.FLOAT16) halfTensorToFloatArray(image, n) else FloatArray(n).also { image.floatBuffer.get(it) }
            image.close()
            out.close()
            return flat
        } finally {
            latentT?.close()
        }
    }

    private fun createTensor(arr: FloatArray, shape: LongArray, type: OnnxJavaType): OnnxTensor {
        return if (type == OnnxJavaType.FLOAT16) {
            OnnxTensor.createTensor(ortEnv, floatArrayToHalfBuffer(arr), shape, OnnxJavaType.FLOAT16)
        } else {
            OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(arr), shape)
        }
    }

    private fun gaussianLatent(seed: Long, sigma: Float): FloatArray {
        val rng = Random(seed)
        val n = 4 * latentH * latentW
        val out = FloatArray(n)
        var i = 0
        while (i < n) {
            val u1 = (rng.nextDouble() + 1e-12).coerceAtMost(1.0 - 1e-12)
            val u2 = rng.nextDouble()
            val mag = sqrt(-2.0 * ln(u1))
            val z0 = mag * cos(2.0 * Math.PI * u2)
            val z1 = mag * sin(2.0 * Math.PI * u2)
            out[i] = (z0 * sigma).toFloat()
            if (i + 1 < n) out[i + 1] = (z1 * sigma).toFloat()
            i += 2
        }
        return out
    }

    private fun floatChwToBitmap(chw: FloatArray, w: Int, h: Int): android.graphics.Bitmap {
        val pixels = IntArray(w * h)
        val planeSize = w * h
        for (y in 0 until h) {
            for (x in 0 until w) {
                val idx = y * w + x
                val r = clampU8(chw[0 * planeSize + idx])
                val g = clampU8(chw[1 * planeSize + idx])
                val b = clampU8(chw[2 * planeSize + idx])
                pixels[idx] = (0xFF shl 24) or (r shl 16) or (g shl 8) or b
            }
        }
        val bmp = android.graphics.Bitmap.createBitmap(w, h, android.graphics.Bitmap.Config.ARGB_8888)
        bmp.setPixels(pixels, 0, w, 0, 0, w, h)
        return bmp
    }

    private fun clampU8(v: Float): Int {
        val x = ((v + 1f) * 0.5f * 255f + 0.5f).toInt()
        return x.coerceIn(0, 255)
    }

    // ── fp16 helpers ────────────────────────────────────────────────────────

    private fun floatToHalfBits(f: Float): Short {
        val bits = java.lang.Float.floatToRawIntBits(f)
        val sign = (bits ushr 16) and 0x8000
        var expF = (bits ushr 23) and 0xff
        var mantF = bits and 0x7fffff
        if (expF == 255) return (sign or 0x7c00 or (if (mantF != 0) 0x200 else 0)).toShort()
        val newExp = expF - 127 + 15
        return when {
            newExp <= 0 -> sign.toShort()
            newExp >= 0x1f -> (sign or 0x7c00).toShort()
            else -> {
                val rounded = mantF + 0x1000
                val mant16 = (rounded ushr 13) and 0x3ff
                val carry = (rounded ushr 23) and 0x1
                val finalExp = newExp + carry
                if (finalExp >= 0x1f) (sign or 0x7c00).toShort()
                else (sign or (finalExp shl 10) or mant16).toShort()
            }
        }
    }

    private fun halfBitsToFloat(h: Short): Float {
        val bits = h.toInt() and 0xffff
        val sign = (bits and 0x8000) shl 16
        val exp = (bits and 0x7c00) ushr 10
        val mant = bits and 0x3ff
        return when (exp) {
            0 -> if (mant == 0) java.lang.Float.intBitsToFloat(sign)
            else {
                var m = mant
                var e = -14
                while ((m and 0x400) == 0) { m = m shl 1; e -= 1 }
                java.lang.Float.intBitsToFloat(sign or ((e + 127) shl 23) or ((m and 0x3ff) shl 13))
            }
            0x1f -> java.lang.Float.intBitsToFloat(sign or 0x7f800000 or (mant shl 13))
            else -> java.lang.Float.intBitsToFloat(sign or ((exp - 15 + 127) shl 23) or (mant shl 13))
        }
    }

    private fun floatArrayToHalfBuffer(arr: FloatArray): ByteBuffer {
        val buf = ByteBuffer.allocateDirect(arr.size * 2).order(ByteOrder.nativeOrder())
        for (v in arr) buf.putShort(floatToHalfBits(v))
        buf.rewind()
        return buf
    }

    private fun halfTensorToFloatArray(tensor: OnnxTensor, count: Int): FloatArray {
        val raw = tensor.byteBuffer
        raw.order(ByteOrder.nativeOrder())
        val sb = raw.asShortBuffer()
        val out = FloatArray(count)
        for (i in 0 until count) out[i] = halfBitsToFloat(sb.get(i))
        return out
    }
}
