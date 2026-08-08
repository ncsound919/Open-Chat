package com.openchat.phonecontrol

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Bitmap
import android.graphics.Path
import android.graphics.Rect
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.util.concurrent.Executors

/**
 * PhoneControlAccessibilityService — reads the active window's accessibility
 * tree and injects gestures/text on behalf of the on-device agent.
 */
class PhoneControlAccessibilityService : AccessibilityService() {

    companion object {
        private const val TAG = "PhoneControlSvc"

        /** Live service instance (null until the user enables it). */
        @Volatile
        var instance: PhoneControlAccessibilityService? = null
            private set

        /** Most recent active-window root. */
        @Volatile
        var lastRoot: AccessibilityNodeInfo? = null
            private set
    }

    private val mainHandler = Handler(Looper.getMainLooper())

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "Accessibility service connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        val root = rootInActiveWindow ?: return
        lastRoot = root
    }

    override fun onInterrupt() {
        Log.w(TAG, "Accessibility service interrupted")
    }

    override fun onDestroy() {
        instance = null
        lastRoot = null
        super.onDestroy()
    }

    // ── Screen reading ───────────────────────────────────────────────────────

    fun readScreenJson(): JSONObject {
        val root = rootInActiveWindow
        val out = JSONObject()
        out.put("foregroundPackage", root?.packageName?.toString() ?: "")
        out.put("foregroundClass", root?.className?.toString() ?: "")
        val nodes = JSONArray()
        if (root != null) {
            collectNodes(root, nodes, 0)
            root.recycle()
        }
        out.put("nodes", nodes)
        return out
    }

    private fun collectNodes(node: AccessibilityNodeInfo, out: JSONArray, depth: Int) {
        if (depth > 48) return
        val text = node.text?.toString() ?: ""
        val desc = node.contentDescription?.toString() ?: ""
        val className = node.className?.toString() ?: ""
        val viewId = node.viewIdResourceName ?: ""
        val clickable = node.isClickable
        val editable = node.isEditable
        val bounds = Rect()
        node.getBoundsInScreen(bounds)

        if ((text.isNotBlank() || desc.isNotBlank() || clickable) && bounds.width() > 0 && bounds.height() > 0) {
            val o = JSONObject()
            o.put("text", text.take(2000))
            o.put("desc", desc.take(2000))
            o.put("className", className)
            o.put("viewId", viewId)
            o.put("clickable", clickable)
            o.put("editable", editable)
            o.put("x", bounds.left)
            o.put("y", bounds.top)
            o.put("w", bounds.width())
            o.put("h", bounds.height())
            o.put("depth", depth)
            out.put(o)
        }

        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            collectNodes(child, out, depth + 1)
            child.recycle()
        }
    }

    // ── Tapping ──────────────────────────────────────────────────────────────

    /** Try to click the clickable node under (x, y) directly. */
    fun clickNode(x: Int, y: Int): Boolean {
        val root = rootInActiveWindow ?: return false
        val target = findClickableAt(root, x, y)
        if (target != null) {
            val ok = target.performAction(AccessibilityNodeInfo.ACTION_CLICK)
            target.recycle()
            root.recycle()
            return ok
        }
        root.recycle()
        return false
    }

    private fun findClickableAt(node: AccessibilityNodeInfo, x: Int, y: Int): AccessibilityNodeInfo? {
        val bounds = Rect()
        node.getBoundsInScreen(bounds)
        if (bounds.contains(x, y) && node.isClickable) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findClickableAt(child, x, y)
            if (found != null) {
                child.recycle()
                return found
            }
            child.recycle()
        }
        return null
    }

    /** Fallback coordinate tap via injected gesture. */
    fun gestureTap(x: Int, y: Int, onResult: (Boolean) -> Unit) {
        val path = Path().apply {
            moveTo(x.toFloat(), y.toFloat())
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, 80))
            .build()
        mainHandler.post {
            val ok = dispatchGesture(
                gesture,
                object : GestureResultCallback() {
                    override fun onCompleted(g: GestureDescription?) = onResult(true)
                    override fun onCancelled(g: GestureDescription?) = onResult(false)
                },
                null
            )
            if (!ok) onResult(false)
        }
    }

    // ── Text input ───────────────────────────────────────────────────────────

    /** Set text into the focused/editable node. */
    fun typeText(text: String): Boolean {
        val root = rootInActiveWindow ?: return false
        val target = findEditable(root)
        if (target == null) {
            root.recycle()
            return false
        }
        val args = Bundle()
        args.putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, text)
        val ok = target.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
        target.recycle()
        root.recycle()
        return ok
    }

    private fun findEditable(node: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        if (node.isEditable) return node
        for (i in 0 until node.childCount) {
            val child = node.getChild(i) ?: continue
            val found = findEditable(child)
            if (found != null) {
                child.recycle()
                return found
            }
            child.recycle()
        }
        return null
    }

    // ── Gestures ─────────────────────────────────────────────────────────────

    fun gestureSwipe(x1: Int, y1: Int, x2: Int, y2: Int, durationMs: Long, onResult: (Boolean) -> Unit) {
        val path = Path().apply {
            moveTo(x1.toFloat(), y1.toFloat())
            lineTo(x2.toFloat(), y2.toFloat())
        }
        val gesture = GestureDescription.Builder()
            .addStroke(GestureDescription.StrokeDescription(path, 0, durationMs))
            .build()
        mainHandler.post {
            val ok = dispatchGesture(
                gesture,
                object : GestureResultCallback() {
                    override fun onCompleted(g: GestureDescription?) = onResult(true)
                    override fun onCancelled(g: GestureDescription?) = onResult(false)
                },
                null
            )
            if (!ok) onResult(false)
        }
    }

    fun performGlobalAction(actionId: Int, onResult: (Boolean) -> Unit) {
        mainHandler.post {
            onResult(performGlobalAction(actionId))
        }
    }

    // ── Screenshot (API 30+) ─────────────────────────────────────────────────

    fun takeScreenshot(onResult: (String?) -> Unit) {
        if (Build.VERSION.SDK_INT < 30) {
            onResult(null)
            return
        }
        val executor = Executors.newSingleThreadExecutor()
        takeScreenshot(
            Display.DEFAULT_DISPLAY,
            executor,
            object : TakeScreenshotCallback {
                override fun onSuccess(screenshot: ScreenshotResult) {
                    try {
                        val hb = screenshot.hardwareBuffer
                        val colorSpace = screenshot.colorSpace
                        val wrapped = Bitmap.wrapHardwareBuffer(hb, colorSpace)
                        if (wrapped == null) {
                            hb.close()
                            onResult(null)
                            return
                        }
                        val bmp = wrapped.copy(Bitmap.Config.ARGB_8888, false)
                        wrapped.recycle()
                        hb.close()
                        val bos = ByteArrayOutputStream()
                        bmp.compress(Bitmap.CompressFormat.PNG, 100, bos)
                        val b64 = Base64.encodeToString(bos.toByteArray(), Base64.NO_WRAP)
                        bmp.recycle()
                        onResult(b64)
                    } catch (e: Exception) {
                        Log.e(TAG, "screenshot encode failed", e)
                        onResult(null)
                    } finally {
                        executor.shutdown()
                    }
                }

                override fun onFailure(errorCode: Int) {
                    executor.shutdown()
                    Log.w(TAG, "screenshot failed: $errorCode")
                    onResult(null)
                }
            }
        )
    }
}
