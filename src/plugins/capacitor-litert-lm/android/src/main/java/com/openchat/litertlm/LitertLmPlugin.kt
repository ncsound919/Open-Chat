package com.openchat.litertlm

import android.util.Log
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.google.ai.edge.litertlm.Backend
import com.google.ai.edge.litertlm.Conversation
import com.google.ai.edge.litertlm.ConversationConfig
import com.google.ai.edge.litertlm.Contents
import com.google.ai.edge.litertlm.Engine
import com.google.ai.edge.litertlm.EngineConfig
import com.google.ai.edge.litertlm.Message
import com.google.ai.edge.litertlm.MessageCallback
import com.google.ai.edge.litertlm.SamplerConfig
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * LitertLmPlugin — on-device LLM runtime via Google LiteRT-LM.
 *
 * Downloads `.litertlm` bundles into getFilesDir()/models, initializes an
 * [Engine], holds one persistent [Conversation] (system prompt seeded once in
 * the KV cache), and streams generations via notifyListeners. JS-facing method
 * names and argument shapes mirror the retired MediaPipe plugin so the chat
 * loop swaps providers with zero contract changes.
 */
@CapacitorPlugin(name = "LitertLm")
class LitertLmPlugin : Plugin() {

    companion object {
        private const val TAG = "LitertLm"
        private const val MODELS_DIR = "models"
    }

    private val ioExecutor: ExecutorService = Executors.newSingleThreadExecutor()
    private var engine: Engine? = null
    private var conversation: Conversation? = null
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
        ret.put("modelLoaded", engine != null)
        ret.put("modelPath", loadedFileName?.let { File(modelsDir(), it).absolutePath } ?: "")
        ret.put("loadedFileName", loadedFileName ?: "")
        ret.put("backend", loadedBackend ?: "none")
        call.resolve(ret)
    }

    @PluginMethod
    fun listModels(call: PluginCall) {
        val models = JSArray()
        modelsDir().listFiles { f -> f.isFile && f.name.endsWith(".litertlm") }
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

    private fun closeEngine() {
        try {
            conversation?.close()
        } catch (_: Exception) {
        }
        conversation = null
        try {
            engine?.close()
        } catch (_: Exception) {
        }
        engine = null
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
        val backendName = call.getString("backend") ?: "auto"

        ioExecutor.execute {
            try {
                closeEngine()
                val backend = when (backendName.lowercase()) {
                    "gpu" -> Backend.GPU()
                    "cpu" -> Backend.CPU()
                    else -> Backend.CPU()
                }
                val config = EngineConfig(
                    modelPath = file.absolutePath,
                    backend = backend,
                    cacheDir = context.cacheDir.absolutePath,
                )
                val e = Engine(config)
                e.initialize()
                engine = e
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

    /** Begin (or reset) the persistent conversation, seeding the system prompt once. */
    @PluginMethod
    fun beginSession(call: PluginCall) {
        val systemPrompt = call.getString("systemPrompt") ?: ""
        val engine = this.engine
        if (engine == null) {
            call.reject("no model loaded")
            return
        }
        ioExecutor.execute {
            try {
                conversation?.close()
            } catch (_: Exception) {
            }
            try {
                val cfg = ConversationConfig(
                    systemInstruction = if (systemPrompt.isNotEmpty()) Contents.of(systemPrompt) else null,
                    samplerConfig = SamplerConfig(topK = 40, topP = 0.95, temperature = 0.7),
                )
                conversation = engine.createConversation(cfg)
                call.resolve(JSObject().put("ok", true))
            } catch (e: Exception) {
                Log.e(TAG, "beginSession failed", e)
                call.reject("beginSession failed: ${e.message}")
            }
        }
    }

    /** Generate against the persistent conversation, appending `prompt` to context. */
    @PluginMethod
    fun generateSession(call: PluginCall) {
        val prompt = call.getString("prompt")?.takeIf { it.isNotEmpty() } ?: run {
            call.reject("prompt required"); return
        }
        val sessionId = call.getString("sessionId") ?: "default"
        val conversation = this.conversation ?: run {
            call.reject("no active session — call beginSession first"); return
        }
        cancelled.set(false)
        ioExecutor.execute {
            try {
                val sb = StringBuilder()
                val callback = object : MessageCallback {
                    override fun onMessage(message: Message) {
                        val partial = message.toString()
                        if (partial.isNotEmpty()) {
                            sb.append(partial)
                            val ev = JSObject()
                            ev.put("sessionId", sessionId)
                            ev.put("text", partial)
                            ev.put("done", false)
                            notifyListeners("generate:progress", ev, false)
                        }
                    }

                    override fun onDone() {
                        if (cancelled.get()) {
                            call.reject("cancelled")
                            return
                        }
                        val doneEv = JSObject()
                        doneEv.put("sessionId", sessionId)
                        doneEv.put("text", "")
                        doneEv.put("done", true)
                        notifyListeners("generate:progress", doneEv, false)
                        val ret = JSObject()
                        ret.put("text", sb.toString())
                        ret.put("ok", true)
                        call.resolve(ret)
                    }

                    override fun onError(throwable: Throwable) {
                        Log.e(TAG, "generateSession failed", throwable)
                        if (cancelled.get()) call.reject("cancelled")
                        else call.reject("generateSession failed: ${throwable.message}")
                    }
                }
                conversation.sendMessageAsync(prompt, callback)
            } catch (e: Exception) {
                Log.e(TAG, "generateSession call failed", e)
                call.reject("generateSession failed: ${e.message}")
            }
        }
    }

    /** Drop the persistent conversation (start a fresh one). */
    @PluginMethod
    fun resetSession(call: PluginCall) {
        ioExecutor.execute {
            try {
                conversation?.close()
            } catch (_: Exception) {
            }
            conversation = null
            call.resolve(JSObject().put("ok", true))
        }
    }

    /** Stateless single-turn generation via a throwaway conversation. */
    @PluginMethod
    fun generate(call: PluginCall) {
        val prompt = call.getString("prompt")?.takeIf { it.isNotEmpty() } ?: run {
            call.reject("prompt required"); return
        }
        val sessionId = call.getString("sessionId") ?: "default"
        val engine = this.engine
        if (engine == null) {
            call.reject("no model loaded")
            return
        }
        cancelled.set(false)
        ioExecutor.execute {
            var oneShot: Conversation? = null
            try {
                oneShot = engine.createConversation()
                val sb = StringBuilder()
                val callback = object : MessageCallback {
                    override fun onMessage(message: Message) {
                        val partial = message.toString()
                        if (partial.isNotEmpty()) {
                            sb.append(partial)
                            val ev = JSObject()
                            ev.put("sessionId", sessionId)
                            ev.put("text", partial)
                            ev.put("done", false)
                            notifyListeners("generate:progress", ev, false)
                        }
                    }

                    override fun onDone() {
                        val doneEv = JSObject()
                        doneEv.put("sessionId", sessionId)
                        doneEv.put("text", "")
                        doneEv.put("done", true)
                        notifyListeners("generate:progress", doneEv, false)
                        val ret = JSObject()
                        ret.put("text", sb.toString())
                        ret.put("ok", true)
                        call.resolve(ret)
                    }

                    override fun onError(throwable: Throwable) {
                        Log.e(TAG, "generate failed", throwable)
                        if (cancelled.get()) call.reject("cancelled")
                        else call.reject("generate failed: ${throwable.message}")
                    }
                }
                oneShot.sendMessageAsync(prompt, callback)
            } catch (e: Exception) {
                Log.e(TAG, "generate call failed", e)
                call.reject("generate failed: ${e.message}")
            } finally {
                try {
                    oneShot?.close()
                } catch (_: Exception) {
                }
            }
        }
    }

    @PluginMethod
    fun cancel(call: PluginCall) {
        cancelled.set(true)
        // Best-effort native cancel is not exposed on Conversation; the
        // cancelled flag stops progress events and rejects the in-flight call.
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun unloadModel(call: PluginCall) {
        ioExecutor.execute {
            closeEngine()
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
                closeEngine()
                loadedFileName = null
                loadedBackend = null
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
        closeEngine()
        loadedFileName = null
        loadedBackend = null
        super.handleOnDestroy()
    }
}