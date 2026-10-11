# release 包会开 R8 混淆：ONNX Runtime 的 native 层按类名/方法名回调 Java，改名就崩
-keep class ai.onnxruntime.** { *; }
# 插件类与 @Command 方法由 Tauri 运行时反射调用
-keep class com.ivyea.sayday.infer.** { *; }
