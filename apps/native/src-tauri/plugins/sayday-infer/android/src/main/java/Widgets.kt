package com.ivyea.sayday.infer

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.view.View
import android.widget.RemoteViews
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * 桌面小组件（六种）：本周、今天、单词卡、今日剧集、开练（1×1）、综合。
 *
 * 内容由网页那边算好（updateWidget 命令，json 字段，见 apps/web/src/lib/widget.ts 的 widgetData）存进 SharedPreferences，
 * 小组件只负责显示；过了换日时间（凌晨 4 点，和 App 一致）自己改成“今天还没练”，过了周日改成“新的一周”。
 * 换日靠每天 4 点的闹钟刷新（系统的 updatePeriodMillis 最快半小时一次，只当兜底）。
 * 按钮带动作打开 App：practice（开始练习）/ episode（今日剧集）/ words（词库），App 用 take_action 取走。
 */
object Widgets {
  const val PREFS = "sayday_widget"
  const val ACTION_REFRESH = "com.ivyea.sayday.widget.REFRESH"
  const val ACTION_NEXT_WORD = "com.ivyea.sayday.widget.NEXT_WORD"
  const val EXTRA_ACTION = "sayday_action"

  /** 种类名 → Provider（pin_widget、设置页统计都按这个） */
  val KINDS: Map<String, Class<out AppWidgetProvider>> = linkedMapOf(
    "week" to SaydayWeekWidget::class.java,
    "today" to SaydayTodayWidget::class.java,
    "word" to SaydayWordWidget::class.java,
    "episode" to SaydayEpisodeWidget::class.java,
    "mini" to SaydayMiniWidget::class.java,
    "classic" to SaydayWidget::class.java,
  )

  private fun day(offsetDays: Int = 0): String {
    val t = System.currentTimeMillis() - 4 * 3600_000L - offsetDays * 86400_000L
    return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(t))
  }

  /** 数据（按今天修正过的）：日期过了就当今天还没练，周过了就当新的一周 */
  private class Data(val j: JSONObject) {
    val today = day()
    val fresh = j.optString("date") == today
    val weekOver = j.optString("weekEnd").let { it.isNotEmpty() && today > it }
    val practiced = fresh && j.optBoolean("practiced")
    val done = fresh && j.optBoolean("done")
    val main = if (fresh) j.optString("main", "今天还没练") else "今天还没练"
    val sub = if (fresh) j.optString("sub", "") else "累的话 2 分钟也算数"
    val week = j.optJSONObject("week")
    val goal = week?.optInt("goal", 4) ?: 4
    val lit = if (weekOver) 0 else week?.optInt("lit", 0) ?: 0
    val streak = week?.optInt("streak", 0) ?: 0
    val head = when {
      weekOver -> "新的一周"
      j.has("head") -> j.optString("head")
      else -> "日日说"
    }
  }

  private fun load(ctx: Context): Data? {
    val s = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString("json", null) ?: return null
    return try { Data(JSONObject(s)) } catch (_: Exception) { null }
  }

  private fun open(ctx: Context, action: String?, req: Int): PendingIntent? {
    val launch = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    if (action != null) launch.putExtra(EXTRA_ACTION, action)
    return PendingIntent.getActivity(ctx, req, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  }

  fun renderAll(ctx: Context) {
    val m = AppWidgetManager.getInstance(ctx)
    for ((kind, cls) in KINDS) {
      val ids = m.getAppWidgetIds(ComponentName(ctx, cls))
      if (ids.isNotEmpty()) render(ctx, kind, m, ids)
    }
    armDayChange(ctx)
  }

  fun count(ctx: Context): Map<String, Int> {
    val m = AppWidgetManager.getInstance(ctx)
    return KINDS.mapValues { (_, cls) -> m.getAppWidgetIds(ComponentName(ctx, cls)).size }
  }

  /** 下一个凌晨 4 点刷新一次所有小组件（换日） */
  fun armDayChange(ctx: Context) {
    val now = System.currentTimeMillis()
    val c = Calendar.getInstance()
    c.set(Calendar.HOUR_OF_DAY, 4); c.set(Calendar.MINUTE, 0); c.set(Calendar.SECOND, 30); c.set(Calendar.MILLISECOND, 0)
    if (c.timeInMillis <= now) c.add(Calendar.DAY_OF_YEAR, 1)
    val i = Intent(ctx, SaydayWidget::class.java).setAction(ACTION_REFRESH)
    val pi = PendingIntent.getBroadcast(ctx, 7301, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val am = ctx.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    am.cancel(pi)
    if (Build.VERSION.SDK_INT >= 23) am.setAndAllowWhileIdle(AlarmManager.RTC, c.timeInMillis, pi) else am.set(AlarmManager.RTC, c.timeInMillis, pi)
  }

  fun render(ctx: Context, kind: String, m: AppWidgetManager, ids: IntArray) {
    val d = load(ctx)
    val v = when (kind) {
      "week" -> week(ctx, d)
      "today" -> today(ctx, d)
      "word" -> word(ctx, d)
      "episode" -> episode(ctx, d)
      "mini" -> mini(ctx, d)
      else -> classic(ctx, d)
    }
    m.updateAppWidget(ids, v)
  }

  private fun week(ctx: Context, d: Data?): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.sayday_w_week)
    v.setOnClickPendingIntent(R.id.w_root, open(ctx, null, 10))
    v.setOnClickPendingIntent(R.id.w_btn, open(ctx, "practice", 11))
    if (d == null) return v
    v.setTextViewText(R.id.w_head, d.head)
    v.setTextViewText(R.id.w_streak, if (!d.weekOver && d.streak > 1) "连续 ${d.streak} 周" else "")
    v.setTextViewText(R.id.w_main, d.main)
    v.setTextViewText(R.id.w_sub, if (!d.done && !d.weekOver && d.lit < d.goal) "再练 ${d.goal - d.lit} 天本周达标" else d.sub)
    v.setTextViewText(R.id.w_btn, if (d.done) "再来一组" else if (d.practiced) "继续" else "开练")
    val dots = intArrayOf(R.id.w_d0, R.id.w_d1, R.id.w_d2, R.id.w_d3, R.id.w_d4, R.id.w_d5, R.id.w_d6)
    val days = d.j.optJSONObject("week")?.optJSONArray("days")
    for (i in 0 until 7) {
      val o = days?.optJSONObject(i)
      val date = o?.optString("date") ?: ""
      val isToday = date == d.today
      // 数据是昨天推的：今天那格还没练（不能沿用昨天的状态）
      val lit = !d.weekOver && (o?.optBoolean("lit") ?: false) && (date != d.today || d.fresh)
      val bg = when {
        isToday && lit -> R.drawable.sayday_w_dot_today_on
        isToday -> R.drawable.sayday_w_dot_today
        lit -> R.drawable.sayday_w_dot_on
        else -> R.drawable.sayday_w_dot_off
      }
      v.setInt(dots[i], "setBackgroundResource", bg)
      v.setTextViewText(dots[i], if (lit) "✓" else "")
    }
    return v
  }

  private fun today(ctx: Context, d: Data?): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.sayday_w_today)
    v.setOnClickPendingIntent(R.id.w_root, open(ctx, null, 20))
    v.setOnClickPendingIntent(R.id.w_btn, open(ctx, "practice", 21))
    if (d == null) return v
    v.setTextViewText(R.id.w_lit, d.lit.toString())
    v.setTextViewText(R.id.w_goal, "/${d.goal}")
    v.setTextViewText(R.id.w_head, if (d.weekOver) "新的一周" else if (d.lit >= d.goal) "本周达标" else "本周练了几天")
    v.setTextViewText(R.id.w_main, d.main)
    v.setTextViewText(R.id.w_btn, if (d.done) "再来一组" else if (d.practiced) "继续" else "开练")
    return v
  }

  private fun word(ctx: Context, d: Data?): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.sayday_w_word)
    v.setOnClickPendingIntent(R.id.w_root, open(ctx, "words", 30))
    val next = Intent(ctx, SaydayWordWidget::class.java).setAction(ACTION_NEXT_WORD)
    v.setOnClickPendingIntent(R.id.w_next, PendingIntent.getBroadcast(ctx, 31, next, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
    val words = d?.j?.optJSONArray("words")
    if (words == null || words.length() == 0) {
      v.setViewVisibility(R.id.w_next, View.GONE)
      return v
    }
    val idx = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getInt("word_idx", 0) % words.length()
    val w = words.getJSONObject(idx)
    v.setViewVisibility(R.id.w_next, if (words.length() > 1) View.VISIBLE else View.GONE)
    v.setTextViewText(R.id.w_word, w.optString("w"))
    v.setTextViewText(R.id.w_ipa, w.optString("ipa").let { if (it.isEmpty()) "" else "/$it/" })
    v.setTextViewText(R.id.w_meaning, w.optString("zh"))
    val ex = w.optString("ex")
    v.setTextViewText(R.id.w_ex, if (ex.isEmpty()) "" else "$ex\n${w.optString("exZh")}")
    return v
  }

  private fun episode(ctx: Context, d: Data?): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.sayday_w_episode)
    v.setOnClickPendingIntent(R.id.w_root, open(ctx, "episode", 40))
    v.setOnClickPendingIntent(R.id.w_btn, open(ctx, "episode", 41))
    val e = d?.j?.optJSONObject("ep") ?: return v
    // 昨天推的“明天解锁”，换日后就能看了
    val ready = e.optBoolean("ready") || (d.j.optString("date") < d.today)
    v.setTextViewText(R.id.w_label, e.optString("label"))
    v.setTextViewText(R.id.w_title, e.optString("title"))
    v.setTextViewText(R.id.w_zh, e.optString("zh"))
    v.setTextViewText(R.id.w_btn, if (ready) "去看" else "明天解锁")
    return v
  }

  private fun mini(ctx: Context, d: Data?): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.sayday_w_mini)
    v.setOnClickPendingIntent(R.id.w_root, open(ctx, "practice", 50))
    v.setTextViewText(R.id.w_big, if (d?.practiced == true) "✓" else "练")
    v.setTextViewText(R.id.w_label, if (d == null) "日日说" else "本周 ${d.lit}/${d.goal}")
    return v
  }

  private fun classic(ctx: Context, d: Data?): RemoteViews {
    val v = RemoteViews(ctx.packageName, R.layout.sayday_widget)
    v.setOnClickPendingIntent(R.id.w_root, open(ctx, null, 60))
    if (d == null) return v
    v.setTextViewText(R.id.w_head, d.head)
    v.setTextViewText(R.id.w_main, d.main)
    v.setTextViewText(R.id.w_sub, d.sub)
    val w = d.j.optJSONArray("words")?.optJSONObject(0)
    if (w == null) v.setViewVisibility(R.id.w_word_box, View.GONE) else {
      v.setViewVisibility(R.id.w_word_box, View.VISIBLE)
      v.setTextViewText(R.id.w_word, w.optString("w"))
      v.setTextViewText(R.id.w_meaning, w.optString("zh"))
    }
    return v
  }
}

/** 各种小组件共用：系统刷新时按自己的种类画；综合那个还负责收“换日刷新”的闹钟 */
abstract class SaydayBaseWidget(private val kind: String) : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    Widgets.render(context, kind, manager, ids)
    Widgets.armDayChange(context)
  }
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Widgets.ACTION_REFRESH -> Widgets.renderAll(context)
      Widgets.ACTION_NEXT_WORD -> {
        val p = context.getSharedPreferences(Widgets.PREFS, Context.MODE_PRIVATE)
        p.edit().putInt("word_idx", p.getInt("word_idx", 0) + 1).apply()
        Widgets.renderAll(context)
      }
      else -> super.onReceive(context, intent)
    }
  }
}

class SaydayWeekWidget : SaydayBaseWidget("week")
class SaydayTodayWidget : SaydayBaseWidget("today")
class SaydayWordWidget : SaydayBaseWidget("word")
class SaydayEpisodeWidget : SaydayBaseWidget("episode")
class SaydayMiniWidget : SaydayBaseWidget("mini")
/** 最早的那个小组件（类名不能改，不然已经放在桌面上的会失效） */
class SaydayWidget : SaydayBaseWidget("classic")
