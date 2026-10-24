// SQLite veritabanı: şema, ilk içerik aktarımı ve küçük yardımcılar.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const cfg = require("./config");

fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
const db = new DatabaseSync(cfg.DB_FILE);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  title         TEXT NOT NULL DEFAULT '',
  university    TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'admin')),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'blocked')),
  member_id     INTEGER,
  must_change   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  last_login    TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
-- İçerik: akademisyen (member), eser (work), haber/etkinlik (topic), albüm, bağlantı, dosya, sayfa.
CREATE TABLE IF NOT EXISTS items (
  kind       TEXT NOT NULL,
  id         INTEGER NOT NULL,
  data       TEXT NOT NULL,
  deleted    INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER,
  PRIMARY KEY (kind, id)
);
-- Üyelerin gönderdiği ekleme / düzeltme önerileri; yönetici onaylayınca içeriğe işlenir.
CREATE TABLE IF NOT EXISTS submissions (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('member', 'work', 'topic', 'claim')),
  target_id   INTEGER,
  data        TEXT NOT NULL,
  note        TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  admin_note  TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_by INTEGER,
  reviewed_at TEXT,
  result_id   INTEGER
);
CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
  target     TEXT NOT NULL,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'visible', 'hidden')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS comments_target ON comments(target, status);
-- Yapay zekâ çağrılarının token ve maliyet kaydı (soru/yanıt metni saklanmaz).
CREATE TABLE IF NOT EXISTS ai_usage (
  id               INTEGER PRIMARY KEY,
  user_id          INTEGER,
  day              TEXT NOT NULL,             -- Europe/Istanbul takvim günü (YYYY-MM-DD)
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  model            TEXT NOT NULL,
  task             TEXT NOT NULL,
  effort           TEXT NOT NULL,
  status           TEXT NOT NULL,             -- ok | incomplete | error | blocked:<neden>
  input_tokens     INTEGER NOT NULL DEFAULT 0,
  cached_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens    INTEGER NOT NULL DEFAULT 0,
  reasoning_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd         REAL NOT NULL DEFAULT 0,
  latency_ms       INTEGER NOT NULL DEFAULT 0,
  input_chars      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ai_usage_user_day ON ai_usage(user_id, day);
CREATE INDEX IF NOT EXISTS ai_usage_day ON ai_usage(day);
-- Paylaşım düğmesi tıklamaları: gün + içerik + platform başına yalnızca sayı. Kişi, IP ya da tarayıcı bilgisi tutulmaz (KVKK).
-- Bir tıklama, paylaşımın gerçekten tamamlandığı anlamına gelmez; raporda "paylaşım tıklaması" olarak gösterilir.
CREATE TABLE IF NOT EXISTS share_clicks (
  day      TEXT NOT NULL,             -- Europe/Istanbul takvim günü (YYYY-MM-DD)
  target   TEXT NOT NULL,             -- topic:305 | work:12 | member:10 | album:8-37
  platform TEXT NOT NULL,
  n        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, target, platform)
);
-- Bir kez çalışması gereken veri taşımaları (ad + zaman)
CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS logs (
  id      INTEGER PRIMARY KEY,
  user_id INTEGER,
  action  TEXT NOT NULL,
  detail  TEXT NOT NULL DEFAULT '',
  at      TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// Şema geçişleri (var olan veritabanlarında eksik sütunları ekler)
{
  const cols = db.prepare("PRAGMA table_info(items)").all().map((c) => c.name);
  // created_by: kaydı ekleyen kullanıcı (sahiplik kuralı için; eski siteden gelenlerde boş)
  if (!cols.includes("created_by")) db.exec("ALTER TABLE items ADD COLUMN created_by INTEGER");
  // assistant: kaydın ait olduğu asistan (akaid | hanefi); eski kayıtlar Akaid Asistanı'na aittir
  const aiCols = db.prepare("PRAGMA table_info(ai_usage)").all().map((c) => c.name);
  if (!aiCols.includes("assistant")) db.exec("ALTER TABLE ai_usage ADD COLUMN assistant TEXT NOT NULL DEFAULT 'akaid'");
}

const SEED_FILES = { member: "members", work: "works", topic: "topics", album: "albums", link: "links", file: "files" };

function seedIfEmpty() {
  const { n } = db.prepare("SELECT count(*) AS n FROM items").get();
  if (n > 0) return false;
  const ins = db.prepare("INSERT INTO items (kind, id, data) VALUES (?, ?, ?)");
  db.exec("BEGIN");
  try {
    for (const [kind, file] of Object.entries(SEED_FILES)) {
      const rows = JSON.parse(fs.readFileSync(path.join(cfg.SEED_DIR, file + ".json"), "utf8"));
      rows.forEach((row, i) => {
        // albümlerin kendi kimliği yoktur: kategori ve alt kategori kimliğinden türetilir
        const id = row.id ?? (kind === "album" ? row.cid * 1000 + row.sid : i + 1);
        ins.run(kind, id, JSON.stringify({ ...row, id }));
      });
    }
    const pages = JSON.parse(fs.readFileSync(path.join(cfg.SEED_DIR, "pages.json"), "utf8"));
    ins.run("page", 1, JSON.stringify(pages));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return true;
}

// Adlandırılmış veri taşımasını yalnızca bir kez çalıştırır; sonucu döndürür (daha önce çalıştıysa null).
function runOnce(name, fn) {
  if (db.prepare("SELECT 1 FROM migrations WHERE name = ?").get(name)) return null;
  const out = fn();
  db.prepare("INSERT INTO migrations (name) VALUES (?)").run(name);
  return out;
}

function log(userId, action, detail = "") {
  db.prepare("INSERT INTO logs (user_id, action, detail) VALUES (?, ?, ?)").run(userId ?? null, action, String(detail).slice(0, 500));
}

// node:sqlite satırları null-prototype nesnedir; JSON'a ve yayılıma uygun düz nesneye çevirir.
const plain = (row) => (row ? { ...row } : row);

module.exports = { db, seedIfEmpty, log, plain, runOnce, SEED_FILES };
