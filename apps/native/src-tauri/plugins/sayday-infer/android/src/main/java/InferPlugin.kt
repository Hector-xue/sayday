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
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import android.provider.Settings
import android.appwidget.AppWidgetManager
import android.content.ComponentName
import androidx.core.app.NotificationManagerCompat
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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

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
class UrlArgs {
  lateinit var url: String
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
  /** 标题行（“本周 3/4 天”这类），网页算好；空 = 老逻辑按 streak 拼 */
  var head: String = ""
  /** head 有效到哪天（本周日，yyyy-MM-dd）；过了这天 head 作废 */
  var headUntil: String = ""
  var practiced: Boolean = false
  var main: String = ""
  var sub: String = ""
  var word: String = ""
  var meaning: String = ""
}

@InvokeArg
class BarsArgs {
  /** 页面当前是深色底：状态栏 / 导航栏图标要用浅色 */
  var dark: Boolean = false
}

@InvokeArg
class UpdateArgs {
  /** 依次尝试的下载地址（本站镜像在前，GitHub 兜底） */
  var urls: Array<String> = arrayOf()
  var sha256: String = ""
  var size: Long = 0
  var version: String = ""
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
  // 录音中最近一段（0.1 秒）的音量，0~1，给话筒外圈的跳动用
  @Volatile private var level = 0f
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
          if (n > 0) {
            synchronized(pcm) { pcm.write(buf, 0, n) }
            var sum = 0.0
            var i = 0
            while (i + 1 < n) { val s = ((buf[i + 1].toInt() shl 8) or (buf[i].toInt() and 0xff)).toShort() / 32768.0; sum += s * s; i += 2 }
            level = Math.sqrt(sum / (n / 2)).toFloat()
          }
        }
      }
      invoke.resolve()
    } catch (e: Throwable) {
      invoke.reject("录音启动失败：${e.message}")
    }
  }

  // 安卓 15 起 App 强制铺满全屏（画到状态栏、手势条后面），但 WebView 报给网页的 safe-area-inset 是 0。
  // 网页启动和尺寸变化时来问这里：现查窗口的系统栏高度（单位 dp = CSS 像素），不挂监听、不改系统默认的分发
  @Command
  fun insets(invoke: Invoke) {
    activity.runOnUiThread {
      val ret = JSObject()
      val wi = ViewCompat.getRootWindowInsets(activity.window.decorView)
      val d = activity.resources.displayMetrics.density
      if (wi != null) {
        val b = wi.getInsets(WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout())
        ret.put("top", (b.top / d).toDouble())
        ret.put("bottom", (b.bottom / d).toDouble())
        ret.put("left", (b.left / d).toDouble())
        ret.put("right", (b.right / d).toDouble())
      }
      invoke.resolve(ret)
    }
  }

  /** 状态栏 / 导航栏图标颜色跟着页面深浅走（浅色底用深色图标） */
  @Command
  fun setBars(invoke: Invoke) {
    val args = invoke.parseArgs(BarsArgs::class.java)
    activity.runOnUiThread {
      val c = WindowCompat.getInsetsController(activity.window, activity.window.decorView)
      c.isAppearanceLightStatusBars = !args.dark
      c.isAppearanceLightNavigationBars = !args.dark
      invoke.resolve()
    }
  }

  @Command
  fun recordLevel(invoke: Invoke) {
    val ret = JSObject()
    ret.put("level", if (recording) level.toDouble() else 0.0)
    invoke.resolve(ret)
  }

  @Command
  fun recordStop(invoke: Invoke) {
    onWorker(invoke, "录音停止失败") {
      recording = false
      level = 0f
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

  // ---- 应用内更新（见 Updater.kt）----
  private val updater by lazy { Updater(activity) }

  @Command
  fun updateStart(invoke: Invoke) {
    val a = invoke.parseArgs(UpdateArgs::class.java)
    updater.start(a.urls.toList(), a.sha256, a.size, a.version)
    invoke.resolve(updateState())
  }

  @Command
  fun updateStatus(invoke: Invoke) {
    invoke.resolve(updateState())
  }

  @Command
  fun updateInstall(invoke: Invoke) {
    activity.runOnUiThread {
      try {
        val ret = JSObject()
        ret.put("opened", updater.install())
        invoke.resolve(ret)
      } catch (e: Throwable) {
        invoke.reject(e.message ?: "无法打开安装器")
      }
    }
  }

  private fun updateState(): JSObject {
    val r = JSObject()
    r.put("current", updater.appVersion())
    r.put("state", updater.state)
    r.put("done", updater.done.toDouble())
    r.put("total", updater.total.toDouble())
    r.put("error", updater.error)
    return r
  }

  // ---- 桌面小组件：网页算好内容推过来，存起来并刷新（见 SaydayWidget.kt） ----
  @Command
  fun updateWidget(invoke: Invoke) {
    val a = invoke.parseArgs(WidgetArgs::class.java)
    activity.getSharedPreferences(SaydayWidget.PREFS, android.content.Context.MODE_PRIVATE).edit()
      .putString("date", a.date).putInt("streak", a.streak).putString("head", a.head).putString("head_until", a.headUntil).putBoolean("practiced", a.practiced)
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

  // ---- 支持日日说：收款码存进相册（微信扫一扫只能从相册选图）----
  @Command
  fun saveImage(invoke: Invoke) {
    val args = invoke.parseArgs(SaveArgs::class.java)
    onWorker(invoke, "保存失败") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw IllegalStateException("这台手机的系统版本存不了图，请截图保存")
      val bytes = Base64.decode(args.data, Base64.DEFAULT)
      val values = ContentValues().apply {
        put(MediaStore.Images.Media.DISPLAY_NAME, args.name)
        put(MediaStore.Images.Media.MIME_TYPE, args.mime)
        put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/Sayday")
      }
      val uri = activity.contentResolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values) ?: throw IllegalStateException("无法创建图片")
      activity.contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
      val ret = JSObject()
      ret.put("path", "相册/Pictures/Sayday/" + args.name)
      invoke.resolve(ret)
    }
  }

  /** 用别的 App 打开链接（weixin:// 这类 WebView 自己打不开）；没装对应 App 返回 ok=false */
  @Command
  fun openUrl(invoke: Invoke) {
    val args = invoke.parseArgs(UrlArgs::class.java)
    val ok = try {
      activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(args.url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: ActivityNotFoundException) {
      false
    } catch (e: SecurityException) {
      false
    }
    val ret = JSObject()
    ret.put("ok", ok)
    invoke.resolve(ret)
  }

  // ---- 设置页「提醒与小组件」 ----
  /** 桌面上放了几个小组件、能不能一键添加、通知开没开（系统层面的总开关） */
  @Command
  fun systemStatus(invoke: Invoke) {
    val mgr = AppWidgetManager.getInstance(activity)
    val ret = JSObject()
    ret.put("widgets", mgr.getAppWidgetIds(ComponentName(activity, SaydayWidget::class.java)).size)
    ret.put("canPin", Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mgr.isRequestPinAppWidgetSupported)
    ret.put("notify", NotificationManagerCompat.from(activity).areNotificationsEnabled())
    invoke.resolve(ret)
  }

  /** 请求把小组件放到桌面（系统弹确认框）；桌面不支持时 ok=false，网页那边提示手动添加 */
  @Command
  fun pinWidget(invoke: Invoke) {
    val mgr = AppWidgetManager.getInstance(activity)
    val ok = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && mgr.isRequestPinAppWidgetSupported &&
      mgr.requestPinAppWidget(ComponentName(activity, SaydayWidget::class.java), null, null)
    val ret = JSObject()
    ret.put("ok", ok)
    invoke.resolve(ret)
  }

  /** 打开系统里本 App 的通知设置页（关了通知、想换提醒铃声时用） */
  @Command
  fun openNotifySettings(invoke: Invoke) {
    val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O)
      Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, activity.packageName)
    else
      Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + activity.packageName))
    activity.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    invoke.resolve(JSObject())
  }
}
