# ONNX Runtime Android — required to avoid runtime crashes under R8 minification.
-keep class ai.onnxruntime.** { *; }
-dontwarn ai.onnxruntime.**
