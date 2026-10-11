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
]
