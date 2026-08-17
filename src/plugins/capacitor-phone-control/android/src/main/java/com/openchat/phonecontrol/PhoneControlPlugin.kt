package com.openchat.phonecontrol

import android.accessibilityservice.AccessibilityService
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.provider.Settings
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
        ret.put("enabled", PhoneControlAccessibilityService.instance != null)
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
}
