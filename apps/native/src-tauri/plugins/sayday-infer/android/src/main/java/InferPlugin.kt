package com.ivyea.sayday.infer

import ai.onnxruntime.OnnxTensor
import ai.onnxruntime.OrtEnvironment
import ai.onnxruntime.OrtSession
import android.Manifest
import android.app.Activity
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.os.SystemClock
import android.util.Base64
import app.tauri.PermissionState
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.ByteArrayOutputStream
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.FloatBuffer
import java.util.concurrent.Executors
import kotlin.concurrent.thread

@InvokeArg
class LoadArgs {
  var threads: Int = 4
}

@InvokeArg
class RunArgs {
  /** 已归一化的 16kHz 单声道音频，float32 小端序的 base64 */
  lateinit var audio: String
}

/**
 * 原生音素推理 + 录音。
 *
 * 模型随 APK 打在 assets/models/ 里（CI 现导出，不入库），首次使用拷到 filesDir 再建会话：
 * ORT 从文件路径建会话可以内存映射，比把 122MB 读进 ByteArray 省一半内存。
 * 音频和 logits 都走 base64 编码的 float32：JSON 数组要大好几倍，序列化也慢。
 */
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.RECORD_AUDIO], alias = "microphone")])
class InferPlugin(private val activity: Activity) : Plugin(activity) {
  private val worker = Executors.newSingleThreadExecutor()
  private val env: OrtEnvironment = OrtEnvironment.getEnvironment()
  private var session: OrtSession? = null
  private var threads = 0

  @Volatile private var recording = false
  private var recorder: AudioRecord? = null
  private var pcm = ByteArrayOutputStream()
  private var recThread: Thread? = null

  private fun onWorker(invoke: Invoke, what: String, block: () -> Unit) {
    worker.execute {
      try {
        block()
      } catch (e: Throwable) {
        invoke.reject("$what：${e.javaClass.simpleName}: ${e.message}")
      }
    }
  }

  private fun modelFile(): File {
    val f = File(activity.filesDir, "models/phone_ctc.int8.onnx")
    if (!f.exists()) {
      f.parentFile?.mkdirs()
      val tmp = File(f.path + ".tmp")
      activity.assets.open("models/phone_ctc.int8.onnx").use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 20) } }
      tmp.renameTo(f)
    }
    return f
  }

  @Command
  fun loadModel(invoke: Invoke) {
    onWorker(invoke, "模型载入失败") {
      val args = invoke.parseArgs(LoadArgs::class.java)
      val t0 = SystemClock.elapsedRealtime()
      val file = modelFile()
      val tCopy = SystemClock.elapsedRealtime() - t0
      session?.close()
      val opts = OrtSession.SessionOptions().apply {
        setIntraOpNumThreads(args.threads)
        setOptimizationLevel(OrtSession.SessionOptions.OptLevel.ALL_OPT)
      }
      session = env.createSession(file.path, opts)
      threads = args.threads
      val ret = JSObject()
      ret.put("copyMs", tCopy)
      ret.put("createMs", SystemClock.elapsedRealtime() - t0 - tCopy)
      ret.put("threads", threads)
      ret.put("cores", Runtime.getRuntime().availableProcessors())
      ret.put("device", "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} · Android ${android.os.Build.VERSION.RELEASE}")
      invoke.resolve(ret)
    }
  }

  @Command
  fun infer(invoke: Invoke) {
    onWorker(invoke, "推理失败") {
      val s = session ?: throw IllegalStateException("模型还没载入")
      val args = invoke.parseArgs(RunArgs::class.java)
      val bytes = Base64.decode(args.audio, Base64.NO_WRAP)
      val fb = ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
      val n = fb.remaining()
      val input = FloatBuffer.allocate(n).put(fb).also { it.rewind() }
      val t0 = SystemClock.elapsedRealtime()
      OnnxTensor.createTensor(env, input, longArrayOf(1, n.toLong())).use { tensor ->
        s.run(mapOf("input_values" to tensor)).use { res ->
          val inferMs = SystemClock.elapsedRealtime() - t0
          val out = res[0] as OnnxTensor
          val shape = out.info.shape
          val logits = out.floatBuffer
          val bb = ByteBuffer.allocate(logits.remaining() * 4).order(ByteOrder.LITTLE_ENDIAN)
          bb.asFloatBuffer().put(logits)
          val ret = JSObject()
          ret.put("logits", Base64.encodeToString(bb.array(), Base64.NO_WRAP))
          ret.put("frames", shape[1])
          ret.put("vocab", shape[2])
          ret.put("inferMs", inferMs)
          ret.put("threads", threads)
          invoke.resolve(ret)
        }
      }
    }
  }

  @Command
  fun recordStart(invoke: Invoke) {
    if (getPermissionState("microphone") != PermissionState.GRANTED) {
      requestPermissionForAlias("microphone", invoke, "afterMicPermission")
      return
    }
    startRecording(invoke)
  }

  // 权限回调按名字反射查找，保持 public 最稳
  @PermissionCallback
  fun afterMicPermission(invoke: Invoke) {
    if (getPermissionState("microphone") == PermissionState.GRANTED) startRecording(invoke)
    else invoke.reject("没有麦克风权限：请在系统设置里允许“日日说”使用麦克风")
  }

  private fun startRecording(invoke: Invoke) {
    try {
      val sr = 16000
      val minBuf = AudioRecord.getMinBufferSize(sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
      // VOICE_RECOGNITION：多数机型会关掉自动增益和降噪，更接近原声，适合发音评测
      val r = AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, sr, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuf, sr))
      if (r.state != AudioRecord.STATE_INITIALIZED) throw IllegalStateException("AudioRecord 初始化失败")
      pcm = ByteArrayOutputStream()
      recorder = r
      recording = true
      r.startRecording()
      recThread = thread(name = "sayday-rec") {
        val buf = ByteArray(3200)
        while (recording) {
          val n = r.read(buf, 0, buf.size)
          if (n > 0) synchronized(pcm) { pcm.write(buf, 0, n) }
        }
      }
      invoke.resolve()
    } catch (e: Throwable) {
      invoke.reject("录音启动失败：${e.message}")
    }
  }

  @Command
  fun recordStop(invoke: Invoke) {
    onWorker(invoke, "录音停止失败") {
      recording = false
      recThread?.join(1000)
      recorder?.run { stop(); release() }
      recorder = null
      val raw = synchronized(pcm) { pcm.toByteArray() }
      val shorts = ByteBuffer.wrap(raw).order(ByteOrder.LITTLE_ENDIAN).asShortBuffer()
      val out = ByteBuffer.allocate(shorts.remaining() * 4).order(ByteOrder.LITTLE_ENDIAN)
      val of = out.asFloatBuffer()
      while (shorts.hasRemaining()) of.put(shorts.get() / 32768f)
      val ret = JSObject()
      ret.put("audio", Base64.encodeToString(out.array(), Base64.NO_WRAP))
      ret.put("samples", raw.size / 2)
      invoke.resolve(ret)
    }
  }
}
