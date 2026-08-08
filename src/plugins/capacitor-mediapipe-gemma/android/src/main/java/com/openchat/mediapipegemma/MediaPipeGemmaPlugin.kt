package com.openchat.mediapipegemma

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.common.util.concurrent.FutureCallback
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.MoreExecutors
import com.google.mediapipe.tasks.genai.llminference.LlmInference
import com.google.mediapipe.tasks.genai.llminference.ProgressListener
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max

/**
 * MediaPipeGemma — on-device Gemma (tasks-genai).
 *
 * Downloads .task bundles into getFilesDir()/models, loads one into the
 * MediaPipe LLM session, and streams generations via notifyListeners.
 */
@CapacitorPlugin(name = "MediaPipeGemma")
class MediaPipeGemmaPlugin : Plugin() {

    companion object {
        private const val TAG = "MediaPipeGemma"
        private const val MODELS_DIR = "models"
    }

    private val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var llm: LlmInference? = null
    private var loadedFileName: String? = null
    private var loadedBackend: String? = null
    private val cancelled = AtomicBoolean(false)

    private fun modelsDir(): File {
        val dir = File(context.filesDir, MODELS_DIR)
        if (!dir.exists()) dir.mkdirs()
        return dir
    }

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        ret.put("available", true)
        ret.put("modelLoaded", llm != null)
        ret.put("modelPath", loadedFileName?.let { File(modelsDir(), it).absolutePath } ?: "")
        ret.put("loadedFileName", loadedFileName ?: "")
        ret.put("backend", loadedBackend ?: "none")
        call.resolve(ret)
    }

    @PluginMethod
    fun listModels(call: PluginCall) {
        val models = JSArray()
        modelsDir().listFiles { f -> f.isFile && f.name.endsWith(".task") }
            ?.sortedByDescending { it.lastModified() }
            ?.forEach { f ->
                val o = JSObject()
                o.put("fileName", f.name)
                o.put("sizeBytes", f.length())
                o.put("loaded", f.name == loadedFileName)
                o.put("path", f.absolutePath)
                models.put(o)
            }
        val ret = JSObject()
        ret.put("models", models)
        call.resolve(ret)
    }

    @PluginMethod
    fun downloadModel(call: PluginCall) {
        val urlStr = call.getString("url") ?: run { call.reject("url required"); return }
        val fileName = call.getString("fileName")?.trim()?.takeIf { it.isNotEmpty() } ?: run {
            call.reject("fileName required"); return
        }
        val target = File(modelsDir(), fileName)
        val tmp = File(modelsDir(), "$fileName.part")

        cancelled.set(false)
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
                val output = FileOutputStream(tmp)
                val buf = ByteArray(64 * 1024)
                var lastPct = -1
                while (true) {
                    if (cancelled.get()) {
                        output.close()
                        input.close()
                        tmp.delete()
                        call.reject("download cancelled")
                        return@execute
                    }
                    val read = input.read(buf)
                    if (read < 0) break
                    output.write(buf, 0, read)
                    received += read
                    val pct = if (total > 0) ((received * 100) / total).toInt() else 0
                    if (pct != lastPct && pct % 5 == 0) {
                        lastPct = pct
                        val ev = JSObject()
                        ev.put("fileName", fileName)
                        ev.put("received", received)
                        ev.put("total", total)
                        ev.put("progress", pct)
                        notifyListeners("model:progress", ev, false)
                    }
                }
                output.close()
                input.close()
                if (tmp.exists()) tmp.renameTo(target)
                val done = JSObject()
                done.put("fileName", fileName)
                done.put("sizeBytes", target.length())
                done.put("ok", true)
                call.resolve(done)
            } catch (e: Exception) {
                tmp.delete()
                Log.e(TAG, "download failed", e)
                call.reject("download failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun loadModel(call: PluginCall) {
        val fileName = call.getString("fileName")?.trim()?.takeIf { it.isNotEmpty() } ?: run {
            call.reject("fileName required"); return
        }
        val file = File(modelsDir(), fileName)
        if (!file.exists()) {
            call.reject("model file not found: $fileName")
            return
        }
        val maxTokens = call.getInt("maxTokens") ?: 4096
        val topK = call.getInt("topK") ?: 40
        val backendName = call.getString("backend") ?: "auto"

        ioExecutor.execute {
            try {
                llm?.close()
            } catch (_: Exception) {
            }
            try {
                val builder = LlmInference.LlmInferenceOptions.builder()
                    .setModelPath(file.absolutePath)
                    .setMaxTokens(maxTokens)
                    .setMaxTopK(topK)
                when (backendName.lowercase()) {
                    "gpu" -> builder.setPreferredBackend(LlmInference.Backend.GPU)
                    "cpu" -> builder.setPreferredBackend(LlmInference.Backend.CPU)
                    else -> builder.setPreferredBackend(LlmInference.Backend.DEFAULT)
                }
                val session = LlmInference.createFromOptions(context, builder.build())
                llm = session
                loadedFileName = fileName
                loadedBackend = backendName.lowercase()
                val ret = JSObject()
                ret.put("ok", true)
                ret.put("modelPath", file.absolutePath)
                ret.put("backend", loadedBackend)
                call.resolve(ret)
            } catch (e: Exception) {
                Log.e(TAG, "loadModel failed", e)
                call.reject("model load failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun generate(call: PluginCall) {
        val prompt = call.getString("prompt")?.takeIf { it.isNotEmpty() } ?: run {
            call.reject("prompt required"); return
        }
        val sessionId = call.getString("sessionId") ?: "default"
        val session = llm
        if (session == null) {
            call.reject("no model loaded")
            return
        }
        cancelled.set(false)
        ioExecutor.execute {
            try {
                val sb = StringBuilder()
                val future = session.generateResponseAsync(
                    prompt,
                    object : ProgressListener<String> {
                        override fun run(partial: String, done: Boolean) {
                            if (partial.isNotEmpty()) {
                                sb.append(partial)
                                val ev = JSObject()
                                ev.put("sessionId", sessionId)
                                ev.put("text", partial)
                                ev.put("done", done)
                                notifyListeners("generate:progress", ev, false)
                            }
                            if (done) {
                                val doneEv = JSObject()
                                doneEv.put("sessionId", sessionId)
                                doneEv.put("text", "")
                                doneEv.put("done", true)
                                notifyListeners("generate:progress", doneEv, false)
                            }
                        }
                    }
                )
                Futures.addCallback(future, object : FutureCallback<String> {
                    override fun onSuccess(result: String) {
                        if (cancelled.get()) {
                            call.reject("cancelled")
                            return
                        }
                        val ret = JSObject()
                        ret.put("text", result ?: sb.toString())
                        ret.put("ok", true)
                        call.resolve(ret)
                    }

                    override fun onFailure(t: Throwable) {
                        Log.e(TAG, "generate failed", t)
                        if (cancelled.get()) call.reject("cancelled")
                        else call.reject("generate failed: ${t.message}")
                    }
                }, MoreExecutors.directExecutor())
            } catch (e: Exception) {
                Log.e(TAG, "generate call failed", e)
                call.reject("generate failed: ${e.message}")
            }
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        cancelled.set(true)
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        ioExecutor.execute {
            try {
                llm?.close()
            } catch (_: Exception) {
            }
            llm = null
            loadedFileName = null
            loadedBackend = null
            call.resolve(JSObject().put("ok", true))
        }
    }

    @PluginMethod
    fun deleteModel(call: PluginCall) {
        val fileName = call.getString("fileName")?.trim() ?: run {
            call.reject("fileName required"); return
        }
        val file = File(modelsDir(), fileName)
        if (!file.exists()) {
            call.reject("model file not found")
            return
        }
        if (fileName == loadedFileName) {
            ioExecutor.execute {
                try {
                    llm?.close()
                } catch (_: Exception) {
                }
                llm = null
                loadedFileName = null
                if (file.delete()) call.resolve(JSObject().put("ok", true))
                else call.reject("delete failed")
            }
        } else {
            if (file.delete()) call.resolve(JSObject().put("ok", true))
            else call.reject("delete failed")
        }
    }

    override fun handleOnDestroy() {
        ioExecutor.shutdownNow()
        try {
            llm?.close()
        } catch (_: Exception) {
        }
        llm = null
        loadedFileName = null
        loadedBackend = null
        super.handleOnDestroy()
    }
}
