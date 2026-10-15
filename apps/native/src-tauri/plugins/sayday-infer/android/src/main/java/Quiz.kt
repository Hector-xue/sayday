package com.ivyea.sayday.infer

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.RemoteInput
import org.json.JSONArray
import org.json.JSONObject

/**
 * 通知里直接作答（方案 1.1）：不打开 App 也能做几道复习题。
 *
 * 网页那边出好一批题（选择题：看英文选意思，最多 3 个选项做成通知按钮；拼写题：看中文写英文，用通知的快捷回复），
 * 连同接下来几天的出题时间一起交给这里（quizSet）。到点了闹钟叫醒 QuizReceiver 弹第一题，
 * 答完一题马上换下一题，每次最多 PER_ROUND 题；答题结果存在 SharedPreferences，App 下次打开时取走（quizDrain）记进复习。
 * 闹钟重启后会丢：开机广播里重新排（BOOT_COMPLETED），App 每次打开也会重排一遍。
 */
object Quiz {
  const val PREFS = "sayday_quiz"
  const val CHANNEL = "sayday_quiz"
  const val NOTIF_ID = 7201
  const val ACTION_SHOW = "com.ivyea.sayday.quiz.SHOW"
  const val ACTION_ANSWER = "com.ivyea.sayday.quiz.ANSWER"
  const val KEY_TEXT = "quiz_text"
  const val PER_ROUND = 3

  private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /** 存一批题和出题时间（毫秒时间戳），清掉旧进度，排下一次闹钟 */
  fun store(ctx: Context, questions: String, times: String) {
    prefs(ctx).edit()
      .putString("questions", questions).putString("times", times)
      .putInt("cursor", 0).putInt("round", 0).putInt("round_ok", 0)
      .apply()
    arm(ctx)
  }

  /** 取走已经答完的题（JSON 数组字符串）并清空 */
  fun drain(ctx: Context): String {
    val p = prefs(ctx)
    val s = p.getString("answers", "[]") ?: "[]"
    p.edit().putString("answers", "[]").apply()
    return s
  }

  private fun pending(ctx: Context, action: String, req: Int, extras: Intent.() -> Unit = {}, mutable: Boolean = false): PendingIntent {
    val i = Intent(ctx, QuizReceiver::class.java).setAction(action).apply(extras)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (mutable && Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else PendingIntent.FLAG_IMMUTABLE)
    return PendingIntent.getBroadcast(ctx, req, i, flags)
  }

  /** 排下一个还没到的出题时间（不需要精确闹钟权限，系统可能晚几分钟） */
  fun arm(ctx: Context) {
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val pi = pending(ctx, ACTION_SHOW, 1)
    am.cancel(pi)
    val times = JSONArray(prefs(ctx).getString("times", "[]") ?: "[]")
    val now = System.currentTimeMillis()
    var next = Long.MAX_VALUE
    for (i in 0 until times.length()) { val t = times.getLong(i); if (t > now && t < next) next = t }
    if (next == Long.MAX_VALUE) return
    if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next, pi) else am.set(AlarmManager.RTC_WAKEUP, next, pi)
  }

  private fun channel(ctx: Context) {
    if (Build.VERSION.SDK_INT >= 26) {
      val nm = ctx.getSystemService(NotificationManager::class.java)
      if (nm.getNotificationChannel(CHANNEL) == null) {
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "通知里做题", NotificationManager.IMPORTANCE_DEFAULT).apply { description = "每天几道复习题，在通知里直接答" })
      }
    }
  }

  private fun questions(ctx: Context) = JSONArray(prefs(ctx).getString("questions", "[]") ?: "[]")

  private fun openApp(ctx: Context): PendingIntent? {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    return PendingIntent.getActivity(ctx, 2, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
  }

  /** 新一轮开始（闹钟到点 / 设置里“现在试一题”） */
  fun startRound(ctx: Context) {
    prefs(ctx).edit().putInt("round", 0).putInt("round_ok", 0).apply()
    show(ctx, null)
    arm(ctx)
  }

  /** 弹当前这道题；before = 上一题的结果（显示在这道题上面一行） */
  fun show(ctx: Context, before: String?) {
    if (!NotificationManagerCompat.from(ctx).areNotificationsEnabled()) return
    channel(ctx)
    val p = prefs(ctx)
    val qs = questions(ctx)
    val cur = p.getInt("cursor", 0)
    val round = p.getInt("round", 0)
    val nm = NotificationManagerCompat.from(ctx)
    val icon = ctx.applicationInfo.icon
    if (cur >= qs.length() || round >= PER_ROUND) {
      // 这一轮做完了（或者题出完了）：给个小结，点一下打开 App
      val ok = p.getInt("round_ok", 0)
      val text = if (round == 0) "题做完了，打开 App 会再出一批" else "这一轮 $round 题对了 $ok 题，今天算练过了 ✓"
      val n = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(icon).setContentTitle(before ?: "日日说")
        .setContentText(text).setAutoCancel(true).setContentIntent(openApp(ctx)).setOnlyAlertOnce(true).build()
      try { nm.notify(NOTIF_ID, n) } catch (_: SecurityException) {}
      return
    }
    val q = qs.getJSONObject(cur)
    val b = NotificationCompat.Builder(ctx, CHANNEL).setSmallIcon(icon)
      .setContentTitle(q.optString("prompt"))
      .setContentText(before ?: "第 ${round + 1}/$PER_ROUND 题 · 直接点下面的按钮作答")
      .setStyle(NotificationCompat.BigTextStyle().bigText((if (before != null) "$before\n" else "") + q.optString("hint", "")))
      .setContentIntent(openApp(ctx)).setOnlyAlertOnce(before != null).setAutoCancel(false)
    if (q.optString("kind") == "spell") {
      val input = RemoteInput.Builder(KEY_TEXT).setLabel("写出英文单词").build()
      val action = NotificationCompat.Action.Builder(0, "写答案", pending(ctx, ACTION_ANSWER, 10, { putExtra("idx", cur) }, mutable = true))
        .addRemoteInput(input).setAllowGeneratedReplies(false).build()
      b.addAction(action)
      b.addAction(0, "不会，看答案", pending(ctx, ACTION_ANSWER, 11, { putExtra("idx", cur); putExtra("choice", "") }))
    } else {
      val opts = q.optJSONArray("options") ?: JSONArray()
      for (k in 0 until minOf(3, opts.length())) {
        b.addAction(0, opts.getString(k), pending(ctx, ACTION_ANSWER, 20 + k, { putExtra("idx", cur); putExtra("choice", opts.getString(k)) }))
      }
    }
    try { nm.notify(NOTIF_ID, b.build()) } catch (_: SecurityException) {}
  }

  /** 收到答案：判对错、记下来、换下一题 */
  fun answer(ctx: Context, idx: Int, given: String) {
    val p = prefs(ctx)
    val qs = questions(ctx)
    if (idx != p.getInt("cursor", 0) || idx >= qs.length()) { show(ctx, null); return } // 旧通知上的按钮：重弹当前题
    val q = qs.getJSONObject(idx)
    val answer = q.optString("answer")
    val ok = given.trim().equals(answer.trim(), ignoreCase = true)
    val answers = JSONArray(p.getString("answers", "[]") ?: "[]")
    answers.put(JSONObject().put("id", q.optString("id")).put("word", q.optString("word")).put("kind", q.optString("kind")).put("ok", ok).put("given", given).put("ts", System.currentTimeMillis()))
    p.edit().putString("answers", answers.toString()).putInt("cursor", idx + 1)
      .putInt("round", p.getInt("round", 0) + 1).putInt("round_ok", p.getInt("round_ok", 0) + (if (ok) 1 else 0)).apply()
    val word = q.optString("word")
    val before = if (ok) "✓ 对了：${q.optString("reveal", word)}" else "✗ 正确答案：${q.optString("reveal", answer)}"
    show(ctx, before)
  }
}

class QuizReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    when (intent.action) {
      Quiz.ACTION_SHOW -> Quiz.startRound(ctx)
      Quiz.ACTION_ANSWER -> {
        val idx = intent.getIntExtra("idx", -1)
        val typed = RemoteInput.getResultsFromIntent(intent)?.getCharSequence(Quiz.KEY_TEXT)?.toString()
        Quiz.answer(ctx, idx, typed ?: intent.getStringExtra("choice") ?: "")
      }
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> Quiz.arm(ctx)
    }
  }
}
