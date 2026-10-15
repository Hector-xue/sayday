// 数据库迁移：只追加，不改已发布的条目（schema 版本号 = 已执行的条数）
export const MIGRATIONS: string[] = [
  `
  CREATE TABLE kv(key TEXT PRIMARY KEY, value TEXT NOT NULL);
  -- 词卡：FSRS 状态（ts-fsrs Card 字段）；due / last_review 存毫秒时间戳
  CREATE TABLE card(
    word TEXT PRIMARY KEY, due INTEGER NOT NULL, stability REAL NOT NULL, difficulty REAL NOT NULL,
    elapsed_days INTEGER NOT NULL, scheduled_days INTEGER NOT NULL, learning_steps INTEGER NOT NULL,
    reps INTEGER NOT NULL, lapses INTEGER NOT NULL, state INTEGER NOT NULL, last_review INTEGER,
    added INTEGER NOT NULL, known INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX card_due ON card(due);
  CREATE TABLE review_log(id INTEGER PRIMARY KEY, word TEXT NOT NULL, rating INTEGER NOT NULL, state INTEGER NOT NULL, ts INTEGER NOT NULL, ms INTEGER);
  CREATE INDEX review_ts ON review_log(ts);
  -- 跟读记录：整句分 0~100，phones = [[音素, 校准分], ...]
  CREATE TABLE attempt(id INTEGER PRIMARY KEY, sentence_id INTEGER, text TEXT NOT NULL, score INTEGER NOT NULL, phones TEXT NOT NULL, tails TEXT, ts INTEGER NOT NULL);
  CREATE INDEX attempt_ts ON attempt(ts);
  CREATE TABLE phoneme_stat(phone TEXT PRIMARY KEY, n INTEGER NOT NULL, sum REAL NOT NULL, bad INTEGER NOT NULL, last INTEGER NOT NULL);
  -- 每天一行：做了多少、是不是保底
  CREATE TABLE day(date TEXT PRIMARY KEY, reviews INTEGER NOT NULL DEFAULT 0, new_words INTEGER NOT NULL DEFAULT 0, shadows INTEGER NOT NULL DEFAULT 0, seconds INTEGER NOT NULL DEFAULT 0, minimum INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0);
  -- 水平估计（定级 / 日常 / 手动），值的含义见 source
  CREATE TABLE level_estimate(id INTEGER PRIMARY KEY, skill TEXT NOT NULL, cefr TEXT NOT NULL, value REAL, se REAL, source TEXT NOT NULL, ts INTEGER NOT NULL, detail TEXT);
  `,
  // v0.0.4：听力记录、每天的听力量、录音存档（进步页的前后对比）
  `
  ALTER TABLE day ADD COLUMN listens INTEGER NOT NULL DEFAULT 0;
  -- 听音选义：sentence 的难度（hard = 句中最难词的词频排名）和对错
  CREATE TABLE listen_log(id INTEGER PRIMARY KEY, sentence_id INTEGER NOT NULL, hard INTEGER NOT NULL, cefr TEXT NOT NULL, ok INTEGER NOT NULL, ts INTEGER NOT NULL);
  CREATE INDEX listen_ts ON listen_log(ts);
  -- 录音存档：16kHz 单声道 int16；只留“第一次”和每句最近一次，够做前后对比
  CREATE TABLE recording(id INTEGER PRIMARY KEY, sentence_id INTEGER, text TEXT NOT NULL, score INTEGER NOT NULL, pcm BLOB NOT NULL, ts INTEGER NOT NULL);
  CREATE INDEX recording_text ON recording(text, ts);
  `,
  // v0.0.5：AI 陪练对话、日记
  `
  CREATE TABLE chat(id INTEGER PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL, meta TEXT, ts INTEGER NOT NULL);
  CREATE INDEX chat_ts ON chat(ts);
  CREATE TABLE diary(id INTEGER PRIMARY KEY, date TEXT NOT NULL, text TEXT NOT NULL, result TEXT, ts INTEGER NOT NULL);
  CREATE INDEX diary_date ON diary(date);
  `,
  // v0.0.5：雅思口语模考记录（题目、转写、流利度、发音分、AI 评分都放 data）
  `
  CREATE TABLE speaking_test(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, band REAL, data TEXT NOT NULL);
  `,
  // v0.0.5：雅思写作批改记录
  `
  CREATE TABLE writing(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, prompt_id TEXT NOT NULL, text TEXT NOT NULL, band REAL, result TEXT);
  `,
  // v0.0.5：雅思阅读 / 听力练习（part = 0 表示整套）
  `
  CREATE TABLE practice(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, kind TEXT NOT NULL, test INTEGER NOT NULL, part INTEGER NOT NULL, score INTEGER NOT NULL, total INTEGER NOT NULL, band REAL, answers TEXT);
  CREATE INDEX practice_kind ON practice(kind, ts);
  `,
  // v0.0.19：声音日记（每周用同一段话录一次；同一周重录覆盖），pcm 同 recording：16kHz 单声道 int16
  `
  CREATE TABLE voice_diary(id INTEGER PRIMARY KEY, week TEXT NOT NULL, pcm BLOB NOT NULL, score INTEGER, wpm REAL, pauses INTEGER, sec REAL NOT NULL, ts INTEGER NOT NULL);
  CREATE INDEX voice_diary_week ON voice_diary(week);
  `,
  // v0.0.21：工作英语练习（task = content/work 的任务 id；result = AI 批改 JSON，没接 AI 为空）
  `
  CREATE TABLE work(id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, task TEXT NOT NULL, text TEXT NOT NULL, score REAL, result TEXT);
  `,
]
