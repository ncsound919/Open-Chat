package com.openchat.phonecontrol

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.provider.Settings
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * PhoneControl — exposes the accessibility service to the WebView so the
 * on-device agent can read and drive the phone.
 */
@CapacitorPlugin(name = "PhoneControl")
class PhoneControlPlugin : Plugin() {

    @PluginMethod
    fun getStatus(call: PluginCall) {
        val ret = JSObject()
        var enabled = PhoneControlAccessibilityService.instance != null
        if (!enabled) {
            // Android 16+ restricts Settings.Secure for third-party apps, so
            // fall back to the accessibility manager's enabled-service list.
            val am = context.getSystemService(android.content.Context.ACCESSIBILITY_SERVICE)
                    as? android.view.accessibility.AccessibilityManager
            val services = am?.getEnabledAccessibilityServiceList(
                android.accessibilityservice.AccessibilityServiceInfo.FEEDBACK_ALL_MASK
            )
            enabled = services?.any { info ->
                info.resolveInfo?.serviceInfo?.packageName == context.packageName
            } == true
        }
        ret.put("enabled", enabled)
        ret.put("available", true)
        call.resolve(ret)
    }

    @PluginMethod
    fun listApps(call: PluginCall) {
        val pm = context.packageManager
        val launchIntent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val resolved = pm.queryIntentActivities(launchIntent, 0)
        val apps = mutableListOf<JSObject>()
        val seen = HashSet<String>()
        for (ri in resolved) {
            val pkg = ri.activityInfo.packageName
            if (!seen.add(pkg)) continue
            val label = try {
                pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString()
            } catch (_: Exception) {
                pkg
            }
            val o = JSObject()
            o.put("packageName", pkg)
            o.put("label", label)
            apps.add(o)
        }
        apps.sortBy { it.getString("label").orEmpty().lowercase() }
        val out = JSArray()
        for (o in apps) out.put(o)
        call.resolve(JSObject().put("apps", out))
    }

    @PluginMethod
    fun openAccessibilitySettings(call: PluginCall) {
        try {
            val intent = Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(intent)
            call.resolve(JSObject().put("ok", true))
        } catch (e: Exception) {
            call.reject("Could not open accessibility settings", e)
        }
    }

    @PluginMethod
    fun getForegroundApp(call: PluginCall) {
        val root = PhoneControlAccessibilityService.lastRoot
        val ret = JSObject()
        ret.put("packageName", root?.packageName?.toString() ?: "")
        ret.put("className", root?.className?.toString() ?: "")
        call.resolve(ret)
    }

    @PluginMethod
    fun readScreen(call: PluginCall) {
        val svc = PhoneControlAccessibilityService.instance
        if (svc == null) {
            call.reject("Accessibility service not enabled — open system Settings and enable Open Chat.")
            return
        }
        val data = svc.readScreenJson()
        call.resolve(JSObject(data.toString()))
    }

    @PluginMethod
    fun performTap(call: PluginCall) {
        val x = call.getInt("x") ?: run { call.reject("x required"); return }
        val y = call.getInt("y") ?: run { call.reject("y required"); return }
        val svc = PhoneControlAccessibilityService.instance
        if (svc == null) {
            call.reject("Accessibility service not enabled")
            return
        }
        if (svc.clickNode(x, y)) {
            call.resolve(JSObject().put("ok", true))
            return
        }
        svc.gestureTap(x, y) { ok ->
            if (ok) call.resolve(JSObject().put("ok", true))
            else call.reject("tap failed (no clickable node under pointer)")
        }
    }

    @PluginMethod
    fun inputText(call: PluginCall) {
        val text = call.getString("text") ?: run { call.reject("text required"); return }
        val svc = PhoneControlAccessibilityService.instance
        if (svc == null) {
            call.reject("Accessibility service not enabled")
            return
        }
        val ok = svc.typeText(text)
        if (ok) call.resolve(JSObject().put("ok", true))
        else call.reject("no editable field found on screen")
    }

    @PluginMethod
    fun submitText(call: PluginCall) {
        val svc = PhoneControlAccessibilityService.instance
        if (svc == null) {
            call.reject("Accessibility service not enabled")
            return
        }
        val ok = svc.submitText()
        if (ok) call.resolve(JSObject().put("ok", true))
        else call.reject("no focused editable field to submit")
    }

    @PluginMethod
    fun performGlobalAction(call: PluginCall) {
        val action = call.getString("action") ?: "back"
        val svc = PhoneControlAccessibilityService.instance
        if (svc == null) {
            call.reject("Accessibility service not enabled")
            return
        }
        val id = when (action) {
            "back" -> AccessibilityService.GLOBAL_ACTION_BACK
            "home" -> AccessibilityService.GLOBAL_ACTION_HOME
            "recents" -> AccessibilityService.GLOBAL_ACTION_RECENTS
            "notifications" -> AccessibilityService.GLOBAL_ACTION_NOTIFICATIONS
            "quickSettings" -> AccessibilityService.GLOBAL_ACTION_QUICK_SETTINGS
            else -> null
        }
        if (id == null) {
            call.reject("unknown global action: $action")
            return
        }
        svc.performGlobalAction(id) { ok -> call.resolve(JSObject().put("ok", ok)) }
    }

    @PluginMethod
    fun openApp(call: PluginCall) {
        val pkg = call.getString("packageName") ?: run { call.reject("packageName required"); return }
        val launchIntent = context.packageManager.getLaunchIntentForPackage(pkg)
        if (launchIntent == null) {
            call.reject("package not installed: $pkg")
            return
        }
        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(launchIntent)
        call.resolve(JSObject().put("ok", true))
    }

    @PluginMethod
    fun swipe(call: PluginCall) {
        val x1 = call.getInt("fromX") ?: 0
        val y1 = call.getInt("fromY") ?: 0
        val x2 = call.getInt("toX") ?: 0
        val y2 = call.getInt("toY") ?: 0
        val duration = call.getInt("duration") ?: 300
        val svc = PhoneControlAccessibilityService.instance
        if (svc == null) {
            call.reject("Accessibility service not enabled")
            return
        }
        svc.gestureSwipe(x1, y1, x2, y2, duration.toLong()) { ok ->
            if (ok) call.resolve(JSObject().put("ok", true))
            else call.reject("swipe failed")
        }
    }

    @PluginMethod
    fun screenshot(call: PluginCall) {
        val svc = PhoneControlAccessibilityService.instance
        if (svc == null) {
            call.reject("Accessibility service not enabled")
            return
        }
        svc.takeScreenshot { b64 ->
            if (b64 == null) call.reject("screenshot unavailable on this device")
            else call.resolve(JSObject().put("data", b64))
        }
    }

    // ── Text-to-speech (default engine = the phone assistant's voice) ──────

    private var tts: android.speech.tts.TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeak: PluginCall? = null

    private fun doSpeak(engine: android.speech.tts.TextToSpeech, call: PluginCall, text: String, rate: Float, pitch: Float) {
        engine.setSpeechRate(rate)
        engine.setPitch(pitch)
        val result = engine.speak(text, android.speech.tts.TextToSpeech.QUEUE_FLUSH, null, "oc-${text.hashCode()}")
        if (result == android.speech.tts.TextToSpeech.SUCCESS) call.resolve(JSObject().put("ok", true))
        else call.reject("speak failed")
    }

    @PluginMethod
    fun speak(call: PluginCall) {
        val text = call.getString("text")?.trim().orEmpty()
        if (text.isEmpty()) {
            call.reject("text required")
            return
        }
        val rate = (call.getFloat("rate") ?: 1.0f).coerceIn(0.5f, 2.0f)
        val pitch = (call.getFloat("pitch") ?: 1.0f).coerceIn(0.5f, 2.0f)

        val engine = tts
        if (engine != null && ttsReady) {
            doSpeak(engine, call, text, rate, pitch)
            return
        }
        // First use: create the engine and queue this request until init lands.
        if (engine == null) {
            tts = android.speech.tts.TextToSpeech(context) { status ->
                ttsReady = status == android.speech.tts.TextToSpeech.SUCCESS
                val queued = pendingSpeak
                pendingSpeak = null
                if (queued == null) return@TextToSpeech
                if (ttsReady) doSpeak(this.tts!!, queued, queued.getString("text")?.trim().orEmpty(),
                    (queued.getFloat("rate") ?: 1.0f), (queued.getFloat("pitch") ?: 1.0f))
                else queued.reject("tts init failed")
            }
        }
        pendingSpeak?.reject("superseded")
        pendingSpeak = call
    }

    @PluginMethod
    fun stopSpeaking(call: PluginCall) {
        tts?.stop()
        call.resolve(JSObject().put("ok", true))
    }

    // ── Speech-to-text (Android SpeechRecognizer Intent) ───────────────────
    // Launches the system speech recognition Activity; the result text is
    // delivered back to the WebView through Capacitor's @ActivityCallback
    // bridge. This is offline-capable when the device has a local pack
    // installed (e.g. Pixel, Samsung) and falls back to Google's server
    // recognizer otherwise. No model is bundled in the APK.

    @PluginMethod
    fun startSpeechRecognition(call: PluginCall) {
        val language = call.getString("language") ?: java.util.Locale.getDefault().toLanguageTag()
        val prompt = call.getString("prompt") ?: "Speak now"
        val intent = android.speech.RecognizerIntent.ACTION_RECOGNIZE_SPEECH.let { action ->
            Intent(action).apply {
                putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_MODEL,
                    android.speech.RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE, language)
                putExtra(android.speech.RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, language)
                putExtra(android.speech.RecognizerIntent.EXTRA_MAX_RESULTS, 1)
                putExtra(android.speech.RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
                putExtra(android.speech.RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                putExtra(android.speech.RecognizerIntent.EXTRA_PROMPT, prompt)
            }
        }
        // Verify the device has a speech recognition engine before launching.
        val pm = context.packageManager
        val activities = pm.queryIntentActivities(intent, 0)
        if (activities.isEmpty()) {
            call.reject("no speech recognition engine on this device")
            return
        }
        try {
            startActivityForResult(call, intent, "onSpeechResult")
        } catch (e: Exception) {
            call.reject("failed to launch speech recognition: ${e.message}")
        }
    }

    @com.getcapacitor.annotation.ActivityCallback
    fun onSpeechResult(call: PluginCall?, result: ActivityResult) {
        val pluginCall = call ?: return
        val ret = JSObject()
        val activityResultCode = result.resultCode
        val activityData = result.data
        when {
            activityResultCode == android.app.Activity.RESULT_OK && activityData != null -> {
                @Suppress("UNCHECKED_CAST")
                val matches = activityData.getStringArrayListExtra(android.speech.RecognizerIntent.EXTRA_RESULTS)
                val text = matches?.firstOrNull().orEmpty()
                ret.put("ok", true)
                ret.put("text", text)
            }
            activityResultCode == android.app.Activity.RESULT_CANCELED -> {
                ret.put("ok", false)
                ret.put("error", "cancelled")
            }
            else -> {
                ret.put("ok", false)
                ret.put("error", "no result")
            }
        }
        pluginCall.resolve(ret)
    }

    override fun handleOnDestroy() {
        tts?.shutdown()
        tts = null
        ttsReady = false
        super.handleOnDestroy()
    }
}
