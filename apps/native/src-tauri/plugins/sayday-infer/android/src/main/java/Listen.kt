package com.ivyea.sayday.infer

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.MediaMetadataRetriever
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
import androidx.media3.datasource.DefaultDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.ConcatenatingMediaSource2
import androidx.media3.exoplayer.source.MediaSource
import androidx.media3.exoplayer.source.ProgressiveMediaSource
import androidx.media3.exoplayer.source.SilenceMediaSource
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
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
 *  1. 后台线程一个词一个词地准备：音频包的 mp3 下到缓存（下过的不再下，没信号也能听），字母从 APK 的 assets 里拷出来，
 *     中文（释义、例句译文）用系统语音合成成 wav（同一句也缓存）；拿不到的英文音频用系统英文语音顶上
 *  2. 每个词拼成一个 ConcatenatingMediaSource2 = 播放列表里的一项：通知栏 / 锁屏 / 耳机的上一个、下一个就是按词切
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
      for ((i, t) in list.withIndex()) {
        if (gen != generation) return@execute
        // 外层 MediaItem 带上词和意思：通知栏、锁屏、蓝牙车机上显示的就是它
        val item = MediaItem.Builder().setMediaId("w$i").setMediaMetadata(
          MediaMetadata.Builder().setTitle(t.title).setArtist(t.sub).setAlbumTitle("日日说 · 听学").setTrackNumber(i + 1).setTotalTrackCount(list.size).build(),
        ).build()
        val one = try { buildTrack(t, item) } catch (e: Throwable) {
          Log.w(TAG, "准备 ${t.word} 失败", e)
          placeholder(t, item)
        }
        main.post {
          if (gen != generation) return@post
          val wasEnded = player.playbackState == Player.STATE_ENDED
          player.addMediaSource(one)
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
  private fun placeholder(t: Track, item: MediaItem): MediaSource {
    t.durMs = 500
    return ConcatenatingMediaSource2.Builder().setMediaItem(item).add(SilenceMediaSource(500_000), 500).build()
  }

  /** 一个词的全部片段拼成一个音源（播放列表里的一项）；顺便算出总时长 */
  private fun buildTrack(t: Track, item: MediaItem): MediaSource {
    val b = ConcatenatingMediaSource2.Builder().setMediaItem(item)
    val factory = ProgressiveMediaSource.Factory(DefaultDataSource.Factory(this))
    var total = 0L
    var parts = 0
    for (k in 0 until t.segs.length()) {
      val s = t.segs.optJSONObject(k) ?: continue
      when (s.optString("t")) {
        "gap" -> {
          val ms = s.optLong("ms", 0).coerceIn(0, 10_000)
          if (ms <= 0) continue
          b.add(SilenceMediaSource(ms * 1000), ms); total += ms; parts++
        }
        "audio", "say" -> {
          val lang = s.optString("lang", "en-US")
          val text = s.optString("text")
          val f = if (s.optString("t") == "audio") fetch(s.optString("url")) ?: synth(text, lang, 0.9f) else synth(text, lang, if (lang.startsWith("zh")) 1.0f else 0.95f)
          if (f == null) { if (lang.startsWith("zh")) noZh = true; continue }
          val ms = durationMs(f)
          b.add(factory.createMediaSource(MediaItem.fromUri(Uri.fromFile(f))), ms)
          total += ms; parts++
        }
      }
    }
    if (parts == 0) return placeholder(t, item)
    t.durMs = total
    return b.build()
  }

  /** 听学的缓存目录（系统缓存目录下的 listen/…；和 Context.cacheDir 区分开，别重名） */
  private fun listenDir(name: String) = File(cacheDir, "listen/$name").apply { mkdirs() }

  /** 音频包的 mp3 下到缓存；asset:/// 从 APK 里拷出来。拿不到返回 null（调用方用系统语音顶上） */
  private fun fetch(url: String): File? {
    if (url.isEmpty()) return null
    if (url.startsWith("asset:///")) {
      val path = url.removePrefix("asset:///")
      val f = File(listenDir("assets"), path.replace('/', '_'))
      if (f.length() > 0) return f
      return try {
        val tmp = File(f.path + ".tmp")
        assets.open(path).use { input -> tmp.outputStream().use { input.copyTo(it) } }
        if (tmp.length() > 0 && tmp.renameTo(f)) f else { tmp.delete(); null }
      } catch (e: Exception) { null }
    }
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

  /**
   * 片段时长（毫秒）。拼接时每个文件音源都必须给出时长（ConcatenatingMediaSource2 对 ProgressiveMediaSource 的要求，
   * 不给直接抛异常），所以一定返回正数：读不出来就按文件估——wav 读头里的字节率，mp3 按音频包的 32kbps
   */
  private fun durationMs(f: File): Long {
    val m = MediaMetadataRetriever()
    val got = try {
      m.setDataSource(f.path)
      m.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: -1
    } catch (e: Exception) { -1L } finally { try { m.release() } catch (e: Exception) {} }
    if (got > 0) return got
    if (f.name.endsWith(".wav")) {
      try {
        RandomAccessFile(f, "r").use { r ->
          val h = ByteArray(44)
          r.readFully(h)
          val byteRate = ByteBuffer.wrap(h, 28, 4).order(ByteOrder.LITTLE_ENDIAN).int
          if (byteRate > 0) return maxOf(1L, (f.length() - 44) * 1000 / byteRate)
        }
      } catch (e: Exception) { /* 头坏了：按大小估 */ }
    }
    return maxOf(1L, f.length() / 4)
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
