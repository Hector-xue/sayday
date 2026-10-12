package com.ivyea.sayday.infer

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/** 安装包要通过 FileProvider 交给系统安装器；单独一个子类，避免和其他库声明的 FileProvider 撞名 */
class UpdateFileProvider : FileProvider()

/**
 * 应用内更新：网页读 version.json 发现新版本后，这里把 apk 下载到私有缓存目录，
 * 核对大小和 SHA-256（和 version.json 一致才算下完），再交给系统安装器（覆盖安装，学习记录保留）。
 *
 * 下载在后台线程跑，网页轮询 status() 画进度条；多个地址依次试（本站镜像在前，GitHub 兜底）。
 */
class Updater(private val activity: Activity) {
  @Volatile var state = "idle" // idle / running / done / error
    private set
  @Volatile var done = 0L
    private set
  @Volatile var total = 0L
    private set
  @Volatile var error = ""
    private set
  private var version = ""

  private val dir get() = File(activity.cacheDir, "update")
  private val apk get() = File(dir, "sayday.apk")

  fun appVersion(): String {
    @Suppress("DEPRECATION")
    return activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: ""
  }

  @Synchronized
  fun start(urls: List<String>, sha256: String, size: Long, ver: String) {
    if (state == "running") return
    // 同一版本已经下好并核对过：直接算完成
    if (state == "done" && ver == version && apk.exists()) return
    version = ver
    state = "running"; done = 0; total = size; error = ""
    Thread {
      var last = ""
      for (u in urls) {
        try {
          fetch(u, sha256.lowercase(), size)
          state = "done"
          return@Thread
        } catch (e: Throwable) {
          last = e.message ?: e.javaClass.simpleName
        }
      }
      error = last
      state = "error"
    }.start()
  }

  private fun fetch(url: String, sha256: String, size: Long) {
    dir.mkdirs()
    // 旧版本留下的包先清掉，缓存目录不攒垃圾
    dir.listFiles()?.forEach { it.delete() }
    val tmp = File(dir, "sayday.apk.part")
    done = 0
    val c = URL(url).openConnection() as HttpURLConnection
    c.connectTimeout = 15000
    c.readTimeout = 30000
    c.instanceFollowRedirects = true
    try {
      if (c.responseCode != 200) throw IllegalStateException("下载失败（HTTP ${c.responseCode}）")
      val md = MessageDigest.getInstance("SHA-256")
      c.inputStream.use { input ->
        tmp.outputStream().use { out ->
          val buf = ByteArray(1 shl 16)
          while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            md.update(buf, 0, n)
            done += n
          }
        }
      }
      if (size > 0 && done != size) throw IllegalStateException("下载不完整（${done} / ${size} 字节）")
      val hex = md.digest().joinToString("") { "%02x".format(it) }
      if (sha256.isNotEmpty() && hex != sha256) throw IllegalStateException("安装包校验不通过")
      if (!tmp.renameTo(apk)) throw IllegalStateException("保存安装包失败")
    } finally {
      c.disconnect()
      tmp.delete()
    }
  }

  /** 返回 true = 已打开系统安装器；false = 先要用户允许“安装未知应用”（已跳到那一页） */
  fun install(): Boolean {
    if (state != "done" || !apk.exists()) throw IllegalStateException("安装包还没下载好")
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !activity.packageManager.canRequestPackageInstalls()) {
      activity.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + activity.packageName)))
      return false
    }
    val uri = FileProvider.getUriForFile(activity, activity.packageName + ".sayday.update", apk)
    activity.startActivity(Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
    })
    return true
  }
}
