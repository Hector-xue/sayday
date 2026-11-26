package com.ivyea.sayday.infer

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.AudioFormat
import android.media.MediaCodec
import android.media.MediaExtractor
import android.media.MediaFormat
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.util.Log
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * 听学：前台播放服务（Media3）。网页把整轮的讲解脚本（每个词一串片段：音频 / 系统语音 / 停顿）交过来，这里：
 *  1. 后台线程一个词一个词地准备：音频包的 mp3（单词、拼读、例句）下到缓存（下过的不再下，没信号也能听），
 *     中文（释义、例句译文）用系统语音合成成 wav（同一句也缓存）；拿不到的英文音频用系统英文语音顶上
 *  2. 每个词的全部片段解码、统一成 24kHz 单声道，按脚本插好停顿，写成一个 wav = 播放列表里的一项：
 *     通知栏 / 锁屏 / 耳机的上一个、下一个就是按词切。不在播放时一段段接：停顿、音频包、系统语音的格式各不相同，
 *     每换一段播放器都要重建一次音频输出，会顿一下、偶尔“啪”一声
 *  3. ExoPlayer 管音频焦点（来电话、别的 App 放声音时暂停）、拔耳机停、锁屏不睡（WAKE_MODE_LOCAL）
 *  4. 听完（或听了六成以上切走）的词记进 SharedPreferences，网页打开时取走写进学习记录（listen_drain）
 * 播放列表的第 i 项永远对应网页里的第 i 个词（某个词什么都没准备出来也放一小段静音占位），网页据此显示讲到哪了。
 */
@OptIn(markerClass = [UnstableApi::class])
class ListenService : MediaSessionService() {
  companion object {
    private const val TAG = "SaydayListen"
    const val PREFS = "sayday_listen"
    private const val MAX_HEARD = 2000
    private const val CACHE_MAX = 150L * 1024 * 1024
    private const val CACHE_KEEP = 100L * 1024 * 1024
    /** 拼好的每个词统一成这个采样率（音频包就是 24kHz 单声道） */
    private const val SR = 24000

    @Volatile var instance: ListenService? = null
    private val waiting = mutableListOf<(ListenService) -> Unit>()
    private val main = Handler(Looper.getMainLooper())

    /** 拿到服务实例再做事：没在跑就先启动（App 在前台时调用，系统允许直接 startService） */
    fun with(ctx: Context, block: (ListenService) -> Unit) {
      main.post {
        val s = instance
        if (s != null) { block(s); return@post }
        synchronized(waiting) { waiting.add(block) }
        ctx.startService(Intent(ctx, ListenService::class.java))
      }
    }

    /** 取走听完的词（JSON 数组字符串），服务不在也能取 */
    fun drain(ctx: Context): String {
      synchronized(this) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val s = p.getString("heard", "[]") ?: "[]"
        p.edit().putString("heard", "[]").apply()
        return s
      }
    }

    private fun record(ctx: Context, word: String, sec: Double) {
      synchronized(this) {
        val p = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val arr = try { JSONArray(p.getString("heard", "[]")) } catch (e: Exception) { JSONArray() }
        arr.put(JSONObject().put("w", word).put("ts", System.currentTimeMillis()).put("sec", Math.round(sec * 10) / 10.0))
        // 很久没打开 App：只留最近的
        val keep = if (arr.length() > MAX_HEARD) JSONArray().also { out -> for (i in arr.length() - MAX_HEARD until arr.length()) out.put(arr.get(i)) } else arr
        p.edit().putString("heard", keep.toString()).apply()
      }
    }

    private fun sha1(s: String): String = MessageDigest.getInstance("SHA-1").digest(s.toByteArray()).joinToString("") { "%02x".format(it) }
  }

  private class Track(val word: String, val title: String, val sub: String, val segs: JSONArray) {
    /** 讲完这个词要多久（准备线程写、主线程读） */
    @Volatile var durMs = 0L
  }

  private lateinit var player: ExoPlayer
  private var session: MediaSession? = null
  private var worker: ExecutorService = Executors.newSingleThreadExecutor()
  private var tracks: List<Track> = emptyList()
  /** 每次换一轮 +1：上一轮还没准备完的直接作废 */
  @Volatile private var generation = 0
  @Volatile private var ready = 0
  @Volatile private var preparing = false
  @Volatile private var noZh = false
  @Volatile private var error = ""
  private var repeat = true
  private var sleepAt = 0L
  private val sleepTask = Runnable { sleepAt = 0; player.pause() }

  // ---- 系统语音：合成到文件 ----
  private var tts: TextToSpeech? = null
  private val ttsInit = CountDownLatch(1)
  @Volatile private var ttsOk = false
  private val synthDone = ConcurrentHashMap<String, CountDownLatch>()
  private val badLangs = ConcurrentHashMap.newKeySet<String>()

  override fun onCreate() {
    super.onCreate()
    val attrs = AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_SPEECH).build()
    player = ExoPlayer.Builder(this)
      .setAudioAttributes(attrs, /* handleAudioFocus= */ true)
      .setHandleAudioBecomingNoisy(true)
      .setWakeMode(C.WAKE_MODE_LOCAL)
      .build()
    player.addListener(object : Player.Listener {
      override fun onPositionDiscontinuity(oldPosition: Player.PositionInfo, newPosition: Player.PositionInfo, reason: Int) {
        val t = tracks.getOrNull(oldPosition.mediaItemIndex) ?: return
        val auto = reason == Player.DISCONTINUITY_REASON_AUTO_TRANSITION
        val moved = oldPosition.mediaItemIndex != newPosition.mediaItemIndex || auto
        if (!moved) return
        val heardMs = if (auto) t.durMs else oldPosition.positionMs
        if (t.durMs > 0 && heardMs >= t.durMs * 0.6) heard(t, heardMs)
      }
      override fun onPlaybackStateChanged(state: Int) {
        if (state != Player.STATE_ENDED) return
        // 没开循环、整轮播完：最后一个词也算听过
        val t = tracks.getOrNull(player.currentMediaItemIndex)
        if (t != null && !preparing && t.durMs > 0) heard(t, t.durMs)
      }
      override fun onPlayerError(e: PlaybackException) {
        Log.w(TAG, "播放出错", e)
        // 一个词坏了就跳过，不让整轮停下
        main.post {
          if (player.hasNextMediaItem()) { player.seekToNextMediaItem(); player.prepare(); player.play() }
          else { error = "播放出错：${e.errorCodeName}" }
        }
      }
    })
    val launch = packageManager.getLaunchIntentForPackage(packageName)?.apply { putExtra(Widgets.EXTRA_ACTION, "listen") }
    val builder = MediaSession.Builder(this, player).setId("sayday-listen")
    if (launch != null) builder.setSessionActivity(PendingIntent.getActivity(this, 31, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    session = builder.build()
    setMediaNotificationProvider(DefaultMediaNotificationProvider.Builder(this).setChannelName(R.string.sayday_listen_channel).build())
    // 没有外部控制器来连，要自己把会话交给服务：这样开播时才会挂通知、转前台
    addSession(session!!)
    tts = TextToSpeech(this) { status ->
      ttsOk = status == TextToSpeech.SUCCESS
      tts?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
        override fun onStart(id: String) {}
        override fun onDone(id: String) { synthDone.remove(id)?.countDown() }
        @Deprecated("旧接口") override fun onError(id: String) { synthDone.remove(id)?.countDown() }
        override fun onError(id: String, code: Int) { synthDone.remove(id)?.countDown() }
      })
      ttsInit.countDown()
    }
    worker.execute { pruneCache() }
    instance = this
    val q = synchronized(waiting) { waiting.toList().also { waiting.clear() } }
    q.forEach { it(this) }
  }

  // 同一个词 3 秒内只记一次：没开循环时播完会记最后一个词，接着点播放从头开始又会触发一次跳转
  private var lastHeard = ""
  private var lastHeardAt = 0L
  private fun heard(t: Track, ms: Long) {
    val now = SystemClock.elapsedRealtime()
    if (t.word == lastHeard && now - lastHeardAt < 3000) return
    lastHeard = t.word
    lastHeardAt = now
    record(this, t.word, ms / 1000.0)
  }

  override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

  // 从最近任务里划掉 App：Media3 默认就是在播接着播（像音乐 App）、没在播就退出，不用改

  override fun onDestroy() {
    instance = null
    generation++
    main.removeCallbacks(sleepTask)
    worker.shutdownNow()
    session?.run { release() }
    session = null
    player.release()
    tts?.shutdown()
    tts = null
    super.onDestroy()
  }

  // ---------------- 换一轮 ----------------

  fun load(json: String, rate: Float, repeat: Boolean) {
    val arr = JSONArray(json)
    val list = (0 until arr.length()).map { i ->
      val o = arr.getJSONObject(i)
      Track(o.optString("w"), o.optString("title", o.optString("w")), o.optString("sub"), o.optJSONArray("segs") ?: JSONArray())
    }
    val gen = ++generation
    tracks = list
    ready = 0
    noZh = false
    error = ""
    this.repeat = repeat
    preparing = list.isNotEmpty()
    player.stop()
    player.clearMediaItems()
    player.repeatMode = Player.REPEAT_MODE_OFF
    player.setPlaybackSpeed(rate.coerceIn(0.5f, 2f))
    player.playWhenReady = true
    worker.execute {
      // 上一轮没拼完整（缺音频、用系统语音顶的）的词不留：这一轮重新拼
      listenDir("track").listFiles()?.forEach { if (it.name.endsWith(".part.wav")) it.delete() }
      for ((i, t) in list.withIndex()) {
        if (gen != generation) return@execute
        val f = try { renderTrack(t, gen) } catch (e: Throwable) {
          Log.w(TAG, "准备 ${t.word} 失败", e)
          null
        } ?: silence(t)
        // MediaItem 带上词和意思：通知栏、锁屏、蓝牙车机上显示的就是它
        val item = MediaItem.Builder().setMediaId("w$i").setUri(Uri.fromFile(f)).setMediaMetadata(
          MediaMetadata.Builder().setTitle(t.title).setArtist(t.sub).setAlbumTitle("日日说 · 听学").setTrackNumber(i + 1).setTotalTrackCount(list.size).build(),
        ).build()
        main.post {
          if (gen != generation) return@post
          val wasEnded = player.playbackState == Player.STATE_ENDED
          player.addMediaItem(item)
          ready = i + 1
          if (i == 0) { player.prepare(); player.play() }
          // 播得比准备得快、停在了末尾：接着放刚准备好的这个词
          else if (wasEnded && player.playWhenReady) { player.seekTo(i, 0); player.prepare(); player.play() }
        }
      }
      main.post {
        if (gen != generation) return@post
        preparing = false
        if (repeat) {
          player.repeatMode = Player.REPEAT_MODE_ALL
          if (player.playbackState == Player.STATE_ENDED && player.playWhenReady) { player.seekTo(0, 0); player.prepare(); player.play() }
        }
      }
    }
  }

  /** 什么都没准备出来的词：放半秒静音占位，保证播放列表第 i 项 = 网页第 i 个词 */
  private fun silence(t: Track): File {
    t.durMs = 500
    val f = File(listenDir("track"), "silence-500.wav")
    if (f.length() <= 44) writeWav(f, Pcm().apply { gap(500) })
    return f
  }

  /** 一个词的讲解：所有片段解码成 24kHz 单声道 16 位，中间按脚本插静音，写成一个 wav；顺便算出总时长 */
  private fun renderTrack(t: Track, gen: Int): File? {
    val dir = listenDir("track")
    val key = sha1(t.segs.toString())
    val done = File(dir, "$key.wav")
    if (done.length() > 44) {
      done.setLastModified(System.currentTimeMillis())
      t.durMs = (done.length() - 44) * 1000 / (SR * 2)
      return done
    }
    val pcm = Pcm()
    // 每段都拿到了正经的音频（没缺、没用系统语音顶替）才存成正式文件，下次直接用；否则下次重新拼
    var complete = true
    var parts = 0
    for (k in 0 until t.segs.length()) {
      if (gen != generation) return null
      val s = t.segs.optJSONObject(k) ?: continue
      when (s.optString("t")) {
        "gap" -> pcm.gap(s.optLong("ms", 0).coerceIn(0, 10_000))
        "audio", "say" -> {
          val lang = s.optString("lang", "en-US")
          val text = s.optString("text")
          var f: File? = null
          if (s.optString("t") == "audio") {
            f = fetch(s.optString("url"))
            if (f == null) complete = false
          }
          if (f == null) f = synth(text, lang, if (lang.startsWith("zh")) 1.0f else if (s.optString("t") == "audio") 0.9f else 0.95f)
          if (f == null) { if (lang.startsWith("zh")) noZh = true; complete = false; continue }
          val a = decode(f)
          if (a == null || a.isEmpty()) { complete = false; continue }
          pcm.clip(a)
          parts++
        }
      }
    }
    if (parts == 0) return null
    val out = if (complete) done else File(dir, "$key.$gen.part.wav")
    writeWav(out, pcm)
    t.durMs = maxOf(1L, pcm.n * 1000L / SR)
    return out
  }

  /** 拼一个词用的 PCM 缓冲（24kHz 单声道 16 位） */
  private class Pcm {
    var buf = ShortArray(SR * 15)
    var n = 0
    private fun room(k: Int) { if (n + k > buf.size) buf = buf.copyOf(maxOf(buf.size * 2, n + k)) }
    fun gap(ms: Long) {
      val k = (ms * SR / 1000).toInt()
      room(k)
      java.util.Arrays.fill(buf, n, n + k, 0.toShort())
      n += k
    }
    /** 接一段音频：首尾 5 毫秒淡入淡出，接缝处不会“啪”一声 */
    fun clip(a: ShortArray) {
      room(a.size)
      val fade = minOf(SR / 200, a.size / 2)
      for (i in a.indices) {
        var v = a[i].toInt()
        if (fade > 0 && i < fade) v = v * i / fade
        else if (fade > 0 && i >= a.size - fade) v = v * (a.size - 1 - i) / fade
        buf[n + i] = v.toShort()
      }
      n += a.size
    }
  }

  private fun writeWav(f: File, p: Pcm) {
    val bytes = p.n * 2
    val b = ByteBuffer.allocate(44 + bytes).order(ByteOrder.LITTLE_ENDIAN)
    b.putInt(0x46464952).putInt(36 + bytes).putInt(0x45564157) // "RIFF" <长度> "WAVE"
    b.putInt(0x20746d66).putInt(16).putShort(1.toShort()).putShort(1.toShort()).putInt(SR).putInt(SR * 2).putShort(2.toShort()).putShort(16.toShort()) // "fmt "：PCM 单声道 16 位
    b.putInt(0x61746164).putInt(bytes) // "data"
    for (i in 0 until p.n) b.putShort(p.buf[i])
    val tmp = File(f.path + ".tmp")
    tmp.writeBytes(b.array())
    if (!tmp.renameTo(f)) { f.delete(); if (!tmp.renameTo(f)) tmp.delete() }
  }

  /** 解码成 24kHz 单声道：系统语音合成的 wav 直接读，音频包的 mp3 用系统解码器 */
  private fun decode(f: File): ShortArray? = if (f.name.endsWith(".wav")) readWav(f) else decodeCodec(f)

  private fun readWav(f: File): ShortArray? {
    val b = ByteBuffer.wrap(f.readBytes()).order(ByteOrder.LITTLE_ENDIAN)
    val cap = b.capacity()
    if (cap < 12 || b.getInt(0) != 0x46464952 || b.getInt(8) != 0x45564157) return null
    var pos = 12
    var fmt = 0
    var ch = 0
    var rate = 0
    var bits = 0
    while (pos + 8 <= cap) {
      val id = b.getInt(pos)
      var size = b.getInt(pos + 4)
      val body = pos + 8
      if (id == 0x20746d66 && body + 16 <= cap) {
        fmt = b.getShort(body).toInt()
        ch = b.getShort(body + 2).toInt()
        rate = b.getInt(body + 4)
        bits = b.getShort(body + 14).toInt()
      } else if (id == 0x61746164) {
        // 有的语音引擎写完不回填长度：按文件剩下的算
        if (size <= 0 || body + size > cap) size = cap - body
        if (fmt != 1 || bits != 16 || ch <= 0 || rate <= 0) return null
        val frames = size / (2 * ch)
        val mono = ShortArray(frames) { i ->
          var sum = 0
          for (c in 0 until ch) sum += b.getShort(body + (i * ch + c) * 2)
          (sum / ch).toShort()
        }
        return resample(mono, rate)
      }
      if (size < 0) return null
      pos = body + size + (size and 1)
    }
    return null
  }

  private fun decodeCodec(f: File): ShortArray? {
    val ex = MediaExtractor()
    var codec: MediaCodec? = null
    try {
      ex.setDataSource(f.path)
      val ti = (0 until ex.trackCount).firstOrNull { ex.getTrackFormat(it).getString(MediaFormat.KEY_MIME)?.startsWith("audio/") == true } ?: return null
      ex.selectTrack(ti)
      val fmt = ex.getTrackFormat(ti)
      var rate = fmt.getInteger(MediaFormat.KEY_SAMPLE_RATE)
      var ch = fmt.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
      var isFloat = false
      val c = MediaCodec.createDecoderByType(fmt.getString(MediaFormat.KEY_MIME)!!)
      codec = c
      c.configure(fmt, null, null, 0)
      c.start()
      val info = MediaCodec.BufferInfo()
      var out = ShortArray(rate * 3)
      var n = 0
      var inDone = false
      var idle = 0
      while (true) {
        if (!inDone) {
          val i = c.dequeueInputBuffer(10_000)
          if (i >= 0) {
            val buf = c.getInputBuffer(i)!!
            val size = ex.readSampleData(buf, 0)
            if (size < 0) { c.queueInputBuffer(i, 0, 0, 0, MediaCodec.BUFFER_FLAG_END_OF_STREAM); inDone = true }
            else { c.queueInputBuffer(i, 0, size, ex.sampleTime, 0); ex.advance() }
          }
        }
        val o = c.dequeueOutputBuffer(info, 10_000)
        if (o >= 0) {
          idle = 0
          if (info.size > 0 && ch > 0) {
            val buf = c.getOutputBuffer(o)!!
            buf.position(info.offset)
            buf.limit(info.offset + info.size)
            val bb = buf.slice().order(ByteOrder.nativeOrder())
            val frames = info.size / ((if (isFloat) 4 else 2) * ch)
            if (n + frames > out.size) out = out.copyOf(maxOf(out.size * 2, n + frames))
            for (k in 0 until frames) {
              var sum = 0f
              for (cc in 0 until ch) sum += if (isFloat) bb.getFloat((k * ch + cc) * 4) * 32767f else bb.getShort((k * ch + cc) * 2).toFloat()
              out[n++] = (sum / ch).coerceIn(-32768f, 32767f).toInt().toShort()
            }
          }
          c.releaseOutputBuffer(o, false)
          if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break
        } else if (o == MediaCodec.INFO_OUTPUT_FORMAT_CHANGED) {
          val nf = c.outputFormat
          rate = nf.getInteger(MediaFormat.KEY_SAMPLE_RATE)
          ch = nf.getInteger(MediaFormat.KEY_CHANNEL_COUNT)
          isFloat = nf.containsKey(MediaFormat.KEY_PCM_ENCODING) && nf.getInteger(MediaFormat.KEY_PCM_ENCODING) == AudioFormat.ENCODING_PCM_FLOAT
        } else if (inDone && ++idle > 200) {
          // 输入都送完了、2 秒没有输出：解码器卡住了，用已经解出来的
          break
        }
      }
      return resample(out.copyOf(n), rate)
    } catch (e: Exception) {
      Log.i(TAG, "解码失败 ${f.name}：${e.javaClass.simpleName}")
      return null
    } finally {
      try { codec?.stop() } catch (e: Exception) { /* 没启动成功 */ }
      try { codec?.release() } catch (e: Exception) { /* 已释放 */ }
      ex.release()
    }
  }

  /**
   * 重采样到 24kHz（系统语音各家采样率不同：16k / 22.05k / 44.1k / 48k…）。
   * 用加汉宁窗的 sinc 低通插值：直接线性插值从 44.1k / 48k 往下降，高频会折回来变成刺耳的“电子音”和沙沙声。
   * 核按 256 个小数相位预先算好，每个输出点只做乘加
   */
  private fun resample(a: ShortArray, rate: Int): ShortArray {
    if (rate == SR || rate <= 0 || a.isEmpty()) return a
    val step = rate.toDouble() / SR
    // 截止频率（相对输入的奈奎斯特）：往下降采样时压到输出的奈奎斯特以下，留 6% 过渡带
    val fc = minOf(1.0, SR.toDouble() / rate) * 0.94
    val half = Math.ceil(12 / fc).toInt()
    val phases = 256
    val taps = 2 * half
    val kern = FloatArray(phases * taps)
    for (p in 0 until phases) {
      val frac = p.toDouble() / phases
      var sum = 0.0
      for (t in 0 until taps) {
        val d = frac + half - 1 - t // 输出点到第 t 个输入点的距离（输入采样为单位）
        val w = if (Math.abs(d) >= half) 0.0 else 0.5 + 0.5 * Math.cos(Math.PI * d / half)
        val sinc = if (d == 0.0) fc else Math.sin(Math.PI * fc * d) / (Math.PI * d)
        val v = sinc * w
        kern[p * taps + t] = v.toFloat()
        sum += v
      }
      // 每个相位归一化：直流增益为 1，不会忽大忽小
      for (t in 0 until taps) kern[p * taps + t] = (kern[p * taps + t] / sum).toFloat()
    }
    val n = (a.size.toLong() * SR / rate).toInt()
    return ShortArray(n) { i ->
      val x = i * step
      val j = Math.floor(x).toInt()
      val p = ((x - j) * phases).toInt().coerceIn(0, phases - 1)
      var acc = 0f
      val base = j - half + 1
      for (t in 0 until taps) {
        val k = base + t
        if (k >= 0 && k < a.size) acc += a[k] * kern[p * taps + t]
      }
      acc.coerceIn(-32768f, 32767f).toInt().toShort()
    }
  }

  /** 听学的缓存目录（系统缓存目录下的 listen/…；和 Context.cacheDir 区分开，别重名） */
  private fun listenDir(name: String) = File(cacheDir, "listen/$name").apply { mkdirs() }

  /** 音频包的 mp3 下到缓存。拿不到返回 null（调用方用系统语音顶上） */
  private fun fetch(url: String): File? {
    if (url.isEmpty()) return null
    val f = File(listenDir("audio"), sha1(url) + ".mp3")
    if (f.length() > 0) { f.setLastModified(System.currentTimeMillis()); return f }
    var conn: HttpURLConnection? = null
    return try {
      conn = (URL(url).openConnection() as HttpURLConnection).apply { connectTimeout = 8000; readTimeout = 15000; instanceFollowRedirects = true }
      if (conn.responseCode != 200) return null
      val tmp = File(f.path + ".tmp")
      conn.inputStream.use { input -> tmp.outputStream().use { input.copyTo(it) } }
      if (tmp.length() == 0L || !tmp.renameTo(f)) { tmp.delete(); null } else f
    } catch (e: Exception) {
      Log.i(TAG, "下载失败 $url：${e.javaClass.simpleName}")
      null
    } finally { conn?.disconnect() }
  }

  /** 系统语音合成到 wav（同一句、同语言、同语速缓存起来）。这台手机没有这种语言的语音返回 null */
  private fun synth(text: String, lang: String, rate: Float): File? {
    if (text.isBlank()) return null
    val f = File(listenDir("tts"), sha1("$lang|$rate|$text") + ".wav")
    if (f.length() > 44) { f.setLastModified(System.currentTimeMillis()); return f }
    if (!ttsInit.await(10, TimeUnit.SECONDS) || !ttsOk) return null
    if (badLangs.contains(lang)) return null
    val t = tts ?: return null
    val r = t.setLanguage(Locale.forLanguageTag(lang))
    if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) { badLangs.add(lang); return null }
    t.setSpeechRate(rate)
    val id = "s" + SystemClock.elapsedRealtimeNanos()
    val latch = CountDownLatch(1)
    synthDone[id] = latch
    val tmp = File(f.path + ".tmp")
    if (t.synthesizeToFile(text, Bundle(), tmp, id) != TextToSpeech.SUCCESS) { synthDone.remove(id); return null }
    latch.await(20, TimeUnit.SECONDS)
    synthDone.remove(id)
    return if (tmp.length() > 44 && tmp.renameTo(f)) f else { tmp.delete(); null }
  }

  /** 缓存超过 150MB：从最久没用的删到 100MB 以下 */
  private fun pruneCache() {
    try {
      val files = File(cacheDir, "listen").walkTopDown().filter { it.isFile }.toMutableList()
      var size = files.sumOf { it.length() }
      if (size <= CACHE_MAX) return
      files.sortBy { it.lastModified() }
      for (f in files) { if (size <= CACHE_KEEP) break; size -= f.length(); f.delete() }
    } catch (e: Exception) { Log.w(TAG, "清缓存失败", e) }
  }

  // ---------------- 控制和状态 ----------------

  fun control(action: String, value: Double) {
    when (action) {
      "play" -> {
        if (player.playbackState == Player.STATE_ENDED) player.seekTo(0, 0)
        if (player.playbackState == Player.STATE_IDLE && player.mediaItemCount > 0) player.prepare()
        player.play()
      }
      "pause" -> player.pause()
      "next" -> when {
        player.hasNextMediaItem() -> player.seekToNextMediaItem()
        player.mediaItemCount > 0 -> player.seekTo(0, 0)
      }
      "prev" -> when {
        // 这个词讲了 3 秒以上就从头重讲，刚开始讲就回上一个
        player.currentPosition > 3000 -> player.seekTo(player.currentMediaItemIndex, 0)
        player.hasPreviousMediaItem() -> player.seekToPreviousMediaItem()
        player.mediaItemCount > 0 -> player.seekTo(player.mediaItemCount - 1, 0)
      }
      "seek" -> {
        val i = value.toInt()
        if (i in 0 until player.mediaItemCount) player.seekTo(i, 0)
      }
      "rate" -> player.setPlaybackSpeed(value.toFloat().coerceIn(0.5f, 2f))
      "sleep" -> {
        main.removeCallbacks(sleepTask)
        sleepAt = 0
        val min = value.toLong()
        if (min > 0) { sleepAt = System.currentTimeMillis() + min * 60_000; main.postDelayed(sleepTask, min * 60_000) }
      }
      "stop" -> {
        generation++
        main.removeCallbacks(sleepTask)
        sleepAt = 0
        player.stop()
        player.clearMediaItems()
        tracks = emptyList()
        ready = 0
        preparing = false
        stopSelf()
      }
    }
  }

  fun state(): JSONObject {
    val o = JSONObject()
    val n = tracks.size
    val idx = if (n == 0) 0 else player.currentMediaItemIndex.coerceIn(0, n - 1)
    val st = player.playbackState
    val status = when {
      n == 0 -> "idle"
      ready == 0 && error.isNotEmpty() -> "error"
      ready == 0 || (st == Player.STATE_ENDED && preparing) -> "preparing"
      st == Player.STATE_ENDED -> "ended"
      player.isPlaying || (player.playWhenReady && st == Player.STATE_BUFFERING) -> "playing"
      else -> "paused"
    }
    o.put("status", status)
    o.put("index", idx)
    o.put("total", n)
    o.put("ready", ready)
    o.put("word", tracks.getOrNull(idx)?.word ?: "")
    o.put("noZh", noZh)
    o.put("sleepAt", sleepAt)
    o.put("error", error)
    return o
  }
}
