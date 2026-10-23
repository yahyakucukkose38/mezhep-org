// Akaid/kelâm kaynak arşivi: Markdown dosyalarını başlıklara göre parçalayıp SQLite FTS5 ile indeksler ve arar.
// İndeks ayrı bir veritabanındadır (DATA_DIR/kaynak.db); kaynak metinler depoya girmez, sunucuya ayrıca yüklenir.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const cfg = require("../config");

const INDEX_FILE = path.join(cfg.DATA_DIR, "kaynak.db");
// İç çalışma notları (redaksiyon raporları vb.) sohbet kaynağı yapılmaz.
const SKIP = /REDAKSIYON|TEYIDI|\.~lock/i;
const MAX_CHUNK = 1600;

// Özet, eğitim ve Türkçe derleme dosyaları; uzun klasik tam metinlerin önünde sıralanır.
function priorityOf(rel) {
  if (/(^|\/)README\.md$/i.test(rel)) return 0.9; // klasör tanıtımları çoğunlukla bağlantı listesidir
  if (/^09_Ozetler\//.test(rel) || /^[^/]+\.md$/.test(rel)) return 1.8;
  if (/^(07_|08_|10_)/.test(rel)) return 1.6;
  if (/^(04_|05_|06_)/.test(rel)) return 1.3;
  return 1.0;
}

function* chunksOf(text) {
  const trail = [];
  let buf = "", head = "";
  const flush = function* () {
    const body = buf.replace(/\n{3,}/g, "\n\n").trim();
    if (body.length > 40) yield { heading: head, body };
    buf = "";
  };
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(#{1,4})\s+(.+?)\s*#*\s*$/);
    if (m) {
      yield* flush();
      trail.length = m[1].length - 1;
      trail[m[1].length - 1] = m[2].replace(/[*_`]/g, "").trim();
      head = trail.filter(Boolean).join(" › ");
      continue;
    }
    if (buf.length + line.length > MAX_CHUNK && buf.length > 400) yield* flush();
    // tek satırı çok uzun olan (paragraf ayrımı olmayan) metinleri cümle sınırından böl
    if (line.length > MAX_CHUNK) {
      for (const part of line.match(new RegExp(`[^]{1,${MAX_CHUNK}}(?:[.!?。۔]\\s|$)|[^]{1,${MAX_CHUNK}}`, "g")) || []) {
        buf += part; yield* flush();
      }
      continue;
    }
    buf += line + "\n";
  }
  yield* flush();
}

function buildIndex(srcDir, outFile = INDEX_FILE, log = console.log) {
  const files = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.toLowerCase().endsWith(".md") && !SKIP.test(e.name)) files.push(p);
    }
  })(srcDir);
  const tmp = outFile + ".yeni";
  fs.rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec(`
    CREATE TABLE docs (id INTEGER PRIMARY KEY, path TEXT NOT NULL, title TEXT NOT NULL, priority REAL NOT NULL);
    CREATE VIRTUAL TABLE chunks USING fts5(heading, body, doc_id UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
  `);
  const insDoc = db.prepare("INSERT INTO docs (path, title, priority) VALUES (?, ?, ?)");
  const insChunk = db.prepare("INSERT INTO chunks (heading, body, doc_id) VALUES (?, ?, ?)");
  let n = 0;
  db.exec("BEGIN");
  for (const f of files) {
    const rel = path.relative(srcDir, f).split(path.sep).join("/");
    const text = fs.readFileSync(f, "utf8");
    const h1 = text.match(/^#\s+(.+)$/m);
    const title = (h1 ? h1[1] : path.basename(f, ".md")).replace(/[*_`]/g, "").trim().slice(0, 200);
    const docId = Number(insDoc.run(rel, title, priorityOf(rel)).lastInsertRowid);
    for (const c of chunksOf(text)) { insChunk.run(c.heading, c.body, docId); n++; }
  }
  db.exec("COMMIT");
  db.exec("INSERT INTO chunks(chunks) VALUES ('optimize')");
  db.close();
  fs.renameSync(tmp, outFile);
  log(`[kaynak] ${files.length} dosya, ${n} parça indekslendi → ${outFile}`);
  return { files: files.length, chunks: n };
}

const STOP = new Set(("ve veya ile ama fakat ki de da mi mı mu mü ne neden nasıl nedir niçin hangi kim bir bu şu o için gibi daha çok en " +
  "olan olarak olur oldu midir mıdır var yok her hem ise diye kadar sonra önce göre hakkında ile mı mi bana bize sen siz ben biz " +
  "açıkla anlat söyle nelerdir nedir neler").split(/\s+/));

function fold(s) {
  return String(s).replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").replace(/ı/g, "i")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

// Soru → FTS5 sorgusu: anlamlı kelimelerin kök benzeri önekleri (Türkçe eklerine dayanıklı) OR ile bağlanır.
function toQuery(question) {
  const words = fold(question).match(/[\p{L}\p{N}]+/gu) || [];
  const terms = [];
  for (const w of words) {
    if (w.length < 3 || STOP.has(w)) continue;
    const stem = /^[؀-ۿ]/.test(w) ? w : w.slice(0, Math.max(4, Math.min(w.length, 6)));
    const t = `"${stem}"*`;
    if (!terms.includes(t)) terms.push(t);
  }
  return terms.slice(0, 12).join(" OR ");
}

let reader = null;
function openIndex() {
  if (reader) return reader;
  if (!fs.existsSync(INDEX_FILE)) return null;
  reader = new DatabaseSync(INDEX_FILE, { readOnly: true });
  return reader;
}

function search(question, { limit = 6, maxChars = 9000 } = {}) {
  const db = openIndex();
  const q = toQuery(question);
  if (!db || !q) return [];
  const rows = db.prepare(
    `SELECT c.heading, c.body, d.path, d.title, bm25(chunks, 4.0, 1.0) * d.priority AS score
     FROM chunks c JOIN docs d ON d.id = c.doc_id WHERE chunks MATCH ? ORDER BY score LIMIT 40`
  ).all(q);
  const out = [], perDoc = {};
  let used = 0;
  for (const r of rows) {
    if ((perDoc[r.path] = (perDoc[r.path] || 0) + 1) > 2) continue; // tek eserin sonuçları doldurmasın
    const body = r.body.length > 2000 ? r.body.slice(0, 2000) + "…" : r.body;
    if (used + body.length > maxChars && out.length) break;
    used += body.length;
    out.push({ title: r.title, heading: r.heading, path: r.path, body });
    if (out.length >= limit) break;
  }
  return out;
}

function indexInfo() {
  const db = openIndex();
  if (!db) return { ready: false };
  return {
    ready: true,
    files: db.prepare("SELECT count(*) AS n FROM docs").get().n,
    built: fs.statSync(INDEX_FILE).mtime.toISOString(),
  };
}

function closeIndex() { if (reader) { reader.close(); reader = null; } }

module.exports = { buildIndex, search, toQuery, indexInfo, closeIndex, chunksOf, INDEX_FILE };

// Komut satırı: node src/ai/corpus.js <kaynak-klasörü>
if (require.main === module) {
  const dir = process.argv[2] || process.env.MZ_CORPUS_DIR;
  if (!dir || !fs.existsSync(dir)) { console.error("Kullanım: npm run kaynak -- <markdown-klasörü>"); process.exit(1); }
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
  buildIndex(dir);
}
