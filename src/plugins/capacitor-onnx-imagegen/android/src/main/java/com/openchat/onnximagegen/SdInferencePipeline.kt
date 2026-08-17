package com.openchat.onnximagegen

import android.graphics.Bitmap
import android.util.Log
import ai.onnxruntime.OnnxJavaType
import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import ai.onnxruntime.providers.NNAPIFlags
import java.io.File
import java.io.FileOutputStream
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.EnumSet
import java.util.Random
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * On-device Stable Diffusion 1.5 pipeline via ONNX Runtime. Ported from the
 * ondevice-imagen reference implementation (MIT-style research code).
 *
 * Flow: CLIP tokenize -> text_encoder x2 (cond/uncond) -> Karras sigma
 * schedule -> UNet denoise loop with CFG (batch=2) -> VAE decode -> PNG.
 *
 * The UNet is routed through the NNAPI EP when available (USE_FP16), which
 * on Snapdragon 8 Elite drops the ~25s CPU step to ~3s. Falls back to CPU
 * per-node automatically.
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
        Log.d(TAG, "pipe: prompt='${prompt.take(60)}' steps=$numInferenceSteps cfg=$cfgScale")

        val tok = ClipTokenizer(File(baseDir, "tokenizer"))
        val condIds = tok.encode(prompt, ClipTokenizer.MAX_LENGTH)
        val uncondIds = tok.encode("", ClipTokenizer.MAX_LENGTH)

        val teSession = ortEnv.createSession(File(baseDir, "text_encoder/model.onnx").absolutePath, sessionOptions())
        val condHidden = runTextEncoder(teSession, condIds)
        val uncondHidden = runTextEncoder(teSession, uncondIds)
        teSession.close()

        val sched = DpmScheduler()
        val sigmas = sched.karrasSigmas(numInferenceSteps)
        val timesteps = sched.karrasTimesteps(sigmas)
        val seed = prompt.hashCode().toLong()
        var latent = gaussianLatent(seed, sigmas[0])

        val unetSession = ortEnv.createSession(File(baseDir, "unet/model.onnx").absolutePath, sessionOptionsUnet())
        try {
            for (k in 0 until numInferenceSteps) {
                val sigmaCurrent = sigmas[k]
                val sigmaNext = sigmas[k + 1]
                val scaleFactor = 1f / sqrt(sigmaCurrent * sigmaCurrent + 1f)
                val scaledSample = FloatArray(latent.size) { latent[it] * scaleFactor }
                val stepT0 = System.currentTimeMillis()
                val noisePred = runUnetCfg(unetSession, scaledSample, timesteps[k].toFloat(), condHidden, uncondHidden)
                latent = sched.stepEuler(latent, noisePred, sigmaCurrent, sigmaNext)
                Log.d(TAG, "pipe: step ${k + 1}/$numInferenceSteps ${System.currentTimeMillis() - stepT0}ms")
            }
        } finally {
            unetSession.close()
        }

        val vaeSession = ortEnv.createSession(File(baseDir, "vae_decoder/model.onnx").absolutePath, sessionOptions())
        val image: FloatArray
        try {
            val scaled = FloatArray(latent.size) { latent[it] / 0.18215f }
            image = runVaeDecoder(vaeSession, scaled)
        } finally {
            vaeSession.close()
        }

        val bitmap = floatChwToBitmap(image, width, height)
        FileOutputStream(File(outputPath)).use { out -> bitmap.compress(Bitmap.CompressFormat.PNG, 100, out) }
        bitmap.recycle()

        return System.currentTimeMillis() - totalT0
    }

    private fun sessionOptions(): OrtSession.SessionOptions {
        val opts = OrtSession.SessionOptions()
        opts.setMemoryPatternOptimization(false)
        opts.setCPUArenaAllocator(false)
        return opts
    }

    /** UNet session with NNAPI delegate (USE_FP16) for NPU/Hexagon speed. */
    private fun sessionOptionsUnet(): OrtSession.SessionOptions {
        val opts = sessionOptions()
        try {
            opts.addNnapi(EnumSet.of(NNAPIFlags.USE_FP16))
            Log.d(TAG, "UNet: NNAPI EP enabled (USE_FP16)")
        } catch (e: Throwable) {
            Log.w(TAG, "UNet: NNAPI add failed, CPU fallback: ${e.message}")
        }
        return opts
    }

    private fun runTextEncoder(session: OrtSession, ids: IntArray): FloatArray {
        var idsTensor: OnnxTensor? = null
        try {
            idsTensor = OnnxTensor.createTensor(ortEnv, IntBuffer.wrap(ids), longArrayOf(1, ids.size.toLong()))
            val out = session.run(mapOf("input_ids" to idsTensor))
            val hidden = out.get("last_hidden_state").get() as OnnxTensor
            val n = hidden.info.shape.fold(1L) { acc, d -> acc * d }.toInt()
            val flat = FloatArray(n)
            hidden.floatBuffer.get(flat)
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
            sampleT = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(sampleBatch), longArrayOf(2, 4, latentH.toLong(), latentW.toLong()))
            tsT = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(tsBatch), longArrayOf(2))
            hiddenT = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(hiddenBatch), longArrayOf(2, 77, 768))
            val out = session.run(mapOf(
                "sample" to sampleT,
                "timestep" to tsT,
                "encoder_hidden_states" to hiddenT,
            ))
            val outSample = out.get("out_sample").get() as OnnxTensor
            val flat = FloatArray(2 * perFrame).also { outSample.floatBuffer.get(it) }
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

    private fun runVaeDecoder(session: OrtSession, latent: FloatArray): FloatArray {
        var latentT: OnnxTensor? = null
        try {
            latentT = OnnxTensor.createTensor(ortEnv, FloatBuffer.wrap(latent), longArrayOf(1, 4, latentH.toLong(), latentW.toLong()))
            val out = session.run(mapOf("latent_sample" to latentT))
            val image = out.get("sample").get() as OnnxTensor
            val n = image.info.shape.fold(1L) { acc, d -> acc * d }.toInt()
            val flat = FloatArray(n)
            image.floatBuffer.get(flat)
            image.close()
            out.close()
            return flat
        } finally {
            latentT?.close()
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

    private fun floatChwToBitmap(chw: FloatArray, w: Int, h: Int): Bitmap {
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
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        bmp.setPixels(pixels, 0, w, 0, 0, w, h)
        return bmp
    }

    private fun clampU8(v: Float): Int {
        val x = ((v + 1f) * 0.5f * 255f + 0.5f).toInt()
        return x.coerceIn(0, 255)
    }

    companion object {
        private const val TAG = "SdInferencePipeline"
    }
}
