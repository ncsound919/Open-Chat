package com.openchat.onnximagegen

import android.graphics.Bitmap
import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.zip.ZipInputStream

/**
 * OnnxImageGen — on-device Stable Diffusion 1.5 via ONNX Runtime.
 *
 * Downloads a model bundle (zip of the ONNX sub-models + tokenizer), extracts
 * it, and runs the SD pipeline to produce a PNG. The generated PNG is returned
 * as base64 so the web layer can render it in chat.
 */
@CapacitorPlugin(name = "OnnxImageGen")
class OnnxImageGenPlugin : Plugin() {

    companion object {
        private const val TAG = "OnnxImageGen"
        private const val MODELS_DIR = "onnx_models"
        private const val OUTPUT_DIR = "onnx_images"
    }

    private val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var loadedName: String? = null
    private var generating = false

    private fun modelsDir(): File {
        val dir = File(context.filesDir, MODELS_DIR)
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    private fun outputDir(): File {
        val dir = File(context.filesDir, OUTPUT_DIR)
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        ret.put("available", true)
        ret.put("modelLoaded", loadedName != null)
        ret.put("loadedName", loadedName ?: "")
        ret.put("busy", generating)
        call.resolve(ret)
    }

    @PluginMethod
    fun listModels(call: PluginCall) {
        val models = JSArray()
        modelsDir().listFiles { f -> f.isDirectory }
            ?.sortedByDescending { it.lastModified() }
            ?.forEach { dir ->
                val o = JSObject()
                o.put("name", dir.name)
                o.put("loaded", dir.name == loadedName)
                o.put("path", dir.absolutePath)
                models.put(o)
            }
        call.resolve(JSObject().put("models", models))
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        val urlStr = call.getString("url") ?: run { call.reject("url required"); return }
        val name = call.getString("name")?.trim()?.takeIf { it.isNotEmpty() } ?: run {
            call.reject("name required"); return
        }
        val targetDir = File(modelsDir(), name)
        val tmpZip = File(modelsDir(), "$name.zip.part")

        ioExecutor.execute {
            try {
                val conn = URL(urlStr).openConnection() as HttpURLConnection
                conn.instanceFollowRedirects = true
                conn.connectTimeout = 20_000
                conn.readTimeout = 30_000
                conn.connect()
                if (conn.responseCode !in 200..299) {
                    call.reject("download failed HTTP ${conn.responseCode}")
                    return@execute
                }
                val total = conn.contentLengthLong
                var received = 0L
                val input = conn.inputStream
                val output = FileOutputStream(tmpZip)
                val buf = ByteArray(64 * 1024)
                var lastPct = -1
                while (true) {
                    val read = input.read(buf)
                    if (read < 0) break
                    output.write(buf, 0, read)
                    received += read
                    val pct = if (total > 0) ((received * 100) / total).toInt() else 0
                    if (pct != lastPct && pct % 5 == 0) {
                        lastPct = pct
                        val ev = JSObject()
                        ev.put("name", name)
                        ev.put("progress", pct)
                        notifyListeners("model:progress", ev, false)
                    }
                }
                output.close()
                input.close()

                targetDir.deleteRecursively()
                targetDir.mkdirs()
                ZipInputStream(tmpZip.inputStream().buffered()).use { zip ->
                    var entry = zip.nextEntry
                    while (entry != null) {
                        val target = File(targetDir, entry.name)
                        if (entry.isDirectory) {
                            target.mkdirs()
                        } else {
                            target.parentFile?.mkdirs()
                            target.outputStream().use { out -> zip.copyTo(out) }
                        }
                        zip.closeEntry()
                        entry = zip.nextEntry
                    }
                }
                tmpZip.delete()
                call.resolve(JSObject().put("name", name).put("ok", true))
            } catch (e: Exception) {
                tmpZip.delete()
                Log.e(TAG, "download failed", e)
                call.reject("download failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun loadModel(call: PluginCall) {
        val name = call.getString("name")?.trim()?.takeIf { it.isNotEmpty() } ?: run {
            call.reject("name required"); return
        }
        val dir = File(modelsDir(), name)
        if (!dir.isDirectory) {
            call.reject("model directory not found: $name")
            return
        }
        val ok = File(dir, "unet/model.onnx").isFile &&
            File(dir, "text_encoder/model.onnx").isFile &&
            File(dir, "vae_decoder/model.onnx").isFile &&
            File(dir, "tokenizer/vocab.json").isFile
        if (!ok) {
            call.reject("model bundle incomplete (expected unet/, text_encoder/, vae_decoder/, tokenizer/)")
            return
        }
        loadedName = name
        call.resolve(JSObject().put("ok", true).put("name", name))
    }

    @PluginMethod
    fun generate(call: PluginCall) {
        val prompt = call.getString("prompt")?.takeIf { it.isNotEmpty() } ?: run {
            call.reject("prompt required"); return
        }
        val name = loadedName ?: run { call.reject("no image model loaded"); return }
        if (generating) {
            call.reject("image generation already in progress")
            return
        }
        generating = true
        ioExecutor.execute {
            try {
                val baseDir = File(modelsDir(), name)
                val outFile = File(outputDir(), "img_${System.currentTimeMillis()}.png")
                val pipeline = SdInferencePipeline(baseDir)
                val elapsedMs = pipeline.generate(prompt, outFile.absolutePath)
                val b64 = outFile.readBytes().let {
                    android.util.Base64.encodeToString(it, android.util.Base64.NO_WRAP)
                }
                val ret = JSObject()
                ret.put("ok", true)
                ret.put("data", b64)
                ret.put("elapsedMs", elapsedMs)
                call.resolve(ret)
            } catch (e: Exception) {
                Log.e(TAG, "generate failed", e)
                call.reject("generate failed: ${e.message}")
            } finally {
                generating = false
            }
        }
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        loadedName = null
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun deleteModel(call: PluginCall) {
        val name = call.getString("name")?.trim() ?: run { call.reject("name required"); return }
        val dir = File(modelsDir(), name)
        if (name == loadedName) loadedName = null
        if (dir.exists()) dir.deleteRecursively()
        call.resolve(JSObject().put("ok", true))
    }

    override fun handleOnDestroy() {
        ioExecutor.shutdownNow()
        loadedName = null
        super.handleOnDestroy()
    }
}
