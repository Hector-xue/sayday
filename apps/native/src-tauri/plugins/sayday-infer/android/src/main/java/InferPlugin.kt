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
import android.content.ContentValues
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale
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
class SaveArgs {
  lateinit var name: String
  var mime: String = "application/json"
  /** 文件内容的 base64 */
  lateinit var data: String
}

@InvokeArg
class SpeakArgs {
  lateinit var text: String
  var lang: String = "en-GB"
  var rate: Float = 0.95f
}

@InvokeArg
class WidgetArgs {
  var date: String = ""
  var streak: Int = 0
  var practiced: Boolean = false
  var main: String = ""
  var sub: String = ""
  var word: String = ""
  var meaning: String = ""
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

  // 模型从 APK 拷到私有目录才能按文件路径加载。拷的时候记下 App 的安装时间：
  // 升级 App 后（可能换了模型，评分校准表也跟着换）安装时间变了，就重新拷一次
  private fun modelFile(): File {
    val f = File(activity.filesDir, "models/phone_ctc.int8.onnx")
    val stamp = File(activity.filesDir, "models/phone_ctc.stamp")
    @Suppress("DEPRECATION")
    val installed = activity.packageManager.getPackageInfo(activity.packageName, 0).lastUpdateTime.toString()
    if (!f.exists() || !stamp.exists() || stamp.readText() != installed) {
      f.parentFile?.mkdirs()
      val tmp = File(f.path + ".tmp")
      activity.assets.open("models/phone_ctc.int8.onnx").use { input -> tmp.outputStream().use { input.copyTo(it, 1 shl 20) } }
      f.delete()
      if (!tmp.renameTo(f)) throw IllegalStateException("模型文件替换失败")
      stamp.writeText(installed)
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

  // ---- 系统 TTS：AI 回复、日记这类现编的句子（例句和单词走预生成的音频包）----
  private var tts: TextToSpeech? = null
  private var ttsReady: Boolean? = null
  private val ttsWaiting = mutableListOf<() -> Unit>()
  private val speaking = mutableMapOf<String, Invoke>()

  private fun withTts(invoke: Invoke, block: (TextToSpeech) -> Unit) {
    when (ttsReady) {
      true -> block(tts!!)
      false -> invoke.reject("手机上没有可用的语音引擎：到系统设置 → 文字转语音 里装一个（例如 Google 语音服务）")
      null -> {
        synchronized(ttsWaiting) { ttsWaiting.add { withTts(invoke, block) } }
        if (tts == null) {
          tts = TextToSpeech(activity) { status ->
            ttsReady = status == TextToSpeech.SUCCESS
            tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
              override fun onStart(id: String) {}
              override fun onDone(id: String) { speaking.remove(id)?.resolve(JSObject()) }
              @Deprecated("旧接口") override fun onError(id: String) { speaking.remove(id)?.reject("朗读失败") }
              override fun onStop(id: String, interrupted: Boolean) { speaking.remove(id)?.resolve(JSObject()) }
            })
            val q = synchronized(ttsWaiting) { ttsWaiting.toList().also { ttsWaiting.clear() } }
            q.forEach { it() }
          }
        }
      }
    }
  }

  @Command
  fun speak(invoke: Invoke) {
    val args = invoke.parseArgs(SpeakArgs::class.java)
    withTts(invoke) { t ->
      val loc = Locale.forLanguageTag(args.lang)
      val ok = t.setLanguage(loc)
      if (ok == TextToSpeech.LANG_MISSING_DATA || ok == TextToSpeech.LANG_NOT_SUPPORTED) t.setLanguage(Locale.US)
      t.setSpeechRate(args.rate)
      val id = "u" + SystemClock.elapsedRealtimeNanos()
      speaking[id] = invoke
      if (t.speak(args.text, TextToSpeech.QUEUE_FLUSH, null, id) != TextToSpeech.SUCCESS) {
        speaking.remove(id)
        invoke.reject("朗读失败")
      }
    }
  }

  @Command
  fun speakStop(invoke: Invoke) {
    tts?.stop()
    invoke.resolve(JSObject())
  }

  // ---- 桌面小组件：网页算好内容推过来，存起来并刷新（见 SaydayWidget.kt） ----
  @Command
  fun updateWidget(invoke: Invoke) {
    val a = invoke.parseArgs(WidgetArgs::class.java)
    activity.getSharedPreferences(SaydayWidget.PREFS, android.content.Context.MODE_PRIVATE).edit()
      .putString("date", a.date).putInt("streak", a.streak).putBoolean("practiced", a.practiced)
      .putString("main", a.main).putString("sub", a.sub).putString("word", a.word).putString("meaning", a.meaning)
      .apply()
    SaydayWidget.render(activity)
    invoke.resolve(JSObject())
  }

  // ---- 导出备份：WebView 不处理网页触发的下载，这里直接写进系统“下载”目录 ----
  @Command
  fun saveToDownloads(invoke: Invoke) {
    val args = invoke.parseArgs(SaveArgs::class.java)
    onWorker(invoke, "保存失败") {
      val bytes = Base64.decode(args.data, Base64.DEFAULT)
      val where: String
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val values = ContentValues().apply {
          put(MediaStore.Downloads.DISPLAY_NAME, args.name)
          put(MediaStore.Downloads.MIME_TYPE, args.mime)
          put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Sayday")
        }
        val uri = activity.contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("无法创建文件")
        activity.contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
        where = "下载/Sayday/" + args.name
      } else {
        // 安卓 9 及以下：写到 App 自己的外部目录（不用存储权限）
        val dir = activity.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS) ?: activity.filesDir
        File(dir, args.name).writeBytes(bytes)
        where = File(dir, args.name).absolutePath
      }
      val ret = JSObject()
      ret.put("path", where)
      invoke.resolve(ret)
    }
  }
}
