package com.ivyea.sayday.infer

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.view.View
import android.widget.RemoteViews
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * 桌面小组件：连续天数、今天练了没有、一个最近在学的词。点一下打开 App。
 * 内容由网页那边算好（updateWidget 命令）存在 SharedPreferences；小组件自己只负责显示，
 * 以及过了换日时间（凌晨 4 点，和 App 一致）后改成“今天还没练”。
 */
class SaydayWidget : AppWidgetProvider() {
  override fun onUpdate(context: Context, manager: AppWidgetManager, ids: IntArray) {
    render(context, manager, ids)
  }

  companion object {
    const val PREFS = "sayday_widget"

    private fun day(offsetDays: Int): String {
      val t = System.currentTimeMillis() - 4 * 3600_000L - offsetDays * 86400_000L
      return SimpleDateFormat("yyyy-MM-dd", Locale.US).format(Date(t))
    }

    fun render(context: Context) {
      val manager = AppWidgetManager.getInstance(context)
      render(context, manager, manager.getAppWidgetIds(ComponentName(context, SaydayWidget::class.java)))
    }

    fun render(context: Context, manager: AppWidgetManager, ids: IntArray) {
      if (ids.isEmpty()) return
      val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val date = p.getString("date", "") ?: ""
      val streak = p.getInt("streak", 0)
      val practiced = p.getBoolean("practiced", false)
      val head: String
      val main: String
      val sub: String
      when {
        date == day(0) -> {
          head = if (streak > 0) "连续 $streak 天" else "日日说"
          main = p.getString("main", "") ?: ""
          sub = p.getString("sub", "") ?: ""
        }
        // 数据是昨天的：昨天练过，连续天数还在，提醒别断
        date == day(1) && practiced -> {
          head = "连续 $streak 天 · 今天别断"
          main = "今天还没练"
          sub = "忙的话 2 分钟也算数"
        }
        else -> {
          head = "日日说"
          main = if (date.isEmpty()) "打开 App 开始今天的练习" else "今天还没练"
          sub = "忙的话 2 分钟也算数"
        }
      }
      val word = p.getString("word", "") ?: ""
      val views = RemoteViews(context.packageName, R.layout.sayday_widget)
      views.setTextViewText(R.id.w_head, head)
      views.setTextViewText(R.id.w_main, main)
      views.setTextViewText(R.id.w_sub, sub)
      if (word.isEmpty()) {
        views.setViewVisibility(R.id.w_word_box, View.GONE)
      } else {
        views.setViewVisibility(R.id.w_word_box, View.VISIBLE)
        views.setTextViewText(R.id.w_word, word)
        views.setTextViewText(R.id.w_meaning, p.getString("meaning", "") ?: "")
      }
      context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
        val pi = PendingIntent.getActivity(context, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        views.setOnClickPendingIntent(R.id.w_root, pi)
      }
      manager.updateAppWidget(ids, views)
    }
  }
}
