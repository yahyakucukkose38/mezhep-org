// Haber ve yazı kategorileri, kategori sayfaları, sayfalardaki kategori bölümleri ve ana menü.
// Kategori anahtarı haber kaydındaki "forum" alanıdır (haber, sempozyum, koordinasyon…): haber kayıtlarına dokunulmaz,
// bir kaydın kategorisini seçmek onu kategori sayfasına, ayarlanan sayfalardaki bölümlere ve menüye kendiliğinden taşır.
// Varsayılanlar data/categories.json'dadır; panelden yapılan değişiklikler "categories" ve "menu_pages" tablolarında durur.
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config");
const { db, runOnce } = require("./db");
require("./site-settings"); // settings tablosu (ilk taşımada eski ana sayfa ayarları okunur)

db.exec(`
CREATE TABLE IF NOT EXISTS categories (
  key        TEXT PRIMARY KEY,           -- haber kayıtlarındaki "forum" değeri; oluşturulduktan sonra değişmez
  data       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
);
-- Menüdeki sabit sayfaların (Ana Sayfa, Akademisyenler…) görünürlüğü ve sırası
CREATE TABLE IF NOT EXISTS menu_pages (
  key        TEXT PRIMARY KEY,
  menu_show  INTEGER NOT NULL,
  menu_order INTEGER NOT NULL
);`);

const MIGRATION = "kategoriler-2026-10";
const COUNTS = [3, 6, 9, 12, 18, 24, 0]; // 0: tümü
const SORTS = { new: "En yeni önce", old: "En eski önce", title: "Başlığa göre (A–Z)", manual: "Özel sıra (haberdeki “Sıra” alanı), sonra en yeni" };
const STYLES = { kart: "Kartlar (görselli)", liste: "Liste (tarih ve başlık)" };
// Kategori bölümlerinin eklenebileceği sayfalar (ana sayfa ayrı bir seçenektir)
const PAGES = { haberler: "Haberler", etkinlikler: "Etkinlikler", akademisyenler: "Akademisyenler", eserler: "Eserler", galeri: "Galeri", kaynaklar: "Kaynaklar", hakkinda: "Hakkında" };

const DEFAULT_ROW = {
  name: "", label: "", slug: "", parent: "", description: "", menu_show: false, menu_order: 100,
  home_show: false, count: 6, sort: "new", style: "kart", pages: [], block_eyebrow: "", block_title: "",
  seo_title: "", seo_desc: "", open_submit: false, page: "", old_slugs: [],
};

// Panel formu bu tanımla çizilir (GET /api/admin/categories).
const GROUPS = { temel: "Temel bilgiler", menu: "Menü", gosterim: "Sayfalarda gösterim", seo: "Arama motorları (SEO)", uyelik: "Üyelik" };
const FIELDS = [
  { key: "name", label: "Kategori adı", type: "text", required: true, max: 60, group: "temel" },
  { key: "label", label: "Kısa ad (kartlardaki etiket; boşsa kategori adı)", type: "text", max: 30, group: "temel" },
  { key: "slug", label: "URL bağlantısı (slug)", type: "slug", max: 60, group: "temel" },
  { key: "parent", label: "Üst kategori", type: "parent", group: "temel" },
  { key: "description", label: "Açıklama (kategori sayfasının girişinde görünür)", type: "textarea", max: 400, group: "temel" },
  { key: "menu_show", label: "Ana menüde göster", type: "bool", group: "menu" },
  { key: "menu_order", label: "Sıra (küçük sayı önce; menüde ve sayfalardaki bölümlerde)", type: "int", min: 0, max: 999, group: "menu" },
  { key: "home_show", label: "Ana sayfada göster", type: "bool", group: "gosterim" },
  { key: "pages", label: "Diğer sayfalarda göster", type: "pages", options: Object.keys(PAGES), labels: PAGES, group: "gosterim" },
  { key: "count", label: "Bölümde gösterilecek içerik sayısı", type: "choice", options: COUNTS, labels: { 0: "Tümü" }, group: "gosterim" },
  { key: "sort", label: "İçerik sıralama yöntemi", type: "choice", options: Object.keys(SORTS), labels: SORTS, group: "gosterim" },
  { key: "style", label: "Bölüm görünümü", type: "choice", options: Object.keys(STYLES), labels: STYLES, group: "gosterim" },
  { key: "block_eyebrow", label: "Bölüm üst etiketi (isteğe bağlı)", type: "text", max: 60, group: "gosterim" },
  { key: "block_title", label: "Bölüm başlığı (boşsa kategori adı)", type: "text", max: 100, group: "gosterim" },
  { key: "seo_title", label: "SEO başlığı (boşsa kategori adı)", type: "text", max: 70, group: "seo" },
  { key: "seo_desc", label: "SEO açıklaması (boşsa açıklama)", type: "textarea", max: 200, group: "seo" },
  { key: "open_submit", label: "Üyeler bu kategoride haber / duyuru önerebilir", type: "bool", group: "uyelik" },
];

class CategoryError extends Error { constructor(fields) { super("Lütfen işaretli alanları düzeltin."); this.fields = fields; } }

const defaults = () => JSON.parse(fs.readFileSync(path.join(cfg.SEED_DIR, "categories.json"), "utf8"));

const slugify = (s) => String(s || "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").replace(/ı/g, "i")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");

const byOrder = (a, b) => a.menu_order - b.menu_order || a.name.localeCompare(b.name, "tr");

// Ağaç sırasıyla tüm kategoriler: üst kategori, ardından alt kategorileri.
function list() {
  const rows = db.prepare("SELECT key, data, created_at FROM categories").all()
    .map((r) => ({ ...DEFAULT_ROW, ...JSON.parse(r.data), key: r.key, created_at: r.created_at }));
  const keys = new Set(rows.map((c) => c.key));
  for (const c of rows) if (c.parent && !keys.has(c.parent)) c.parent = "";
  const out = [];
  for (const top of rows.filter((c) => !c.parent).sort(byOrder)) out.push(top, ...rows.filter((c) => c.parent === top.key).sort(byOrder));
  return out;
}
const get = (key) => list().find((c) => c.key === key) || null;

// Haber formundaki kategori seçimi: alt kategoriler "Üst › Alt" biçiminde.
function topicChoices() {
  const cats = list(), name = Object.fromEntries(cats.map((c) => [c.key, c.name]));
  return {
    options: cats.map((c) => c.key),
    memberOptions: cats.filter((c) => c.open_submit).map((c) => c.key),
    labels: Object.fromEntries(cats.map((c) => [c.key, c.parent ? `${name[c.parent]} › ${c.name}` : c.name])),
  };
}
const labelOf = (key) => { const c = get(key); return c ? c.label || c.name : key; };

// Kategori başına yayındaki ve geri dönüşüm kutusundaki haber sayısı
function counts() {
  return Object.fromEntries(db.prepare(`SELECT json_extract(data, '$.forum') AS f, sum(deleted = 0) AS live, sum(deleted = 1) AS trash
    FROM items WHERE kind = 'topic' GROUP BY f`).all().map((r) => [r.f, { live: r.live, trash: r.trash }]));
}

function clean(input, existing) {
  input = input || {};
  const others = list().filter((c) => !existing || c.key !== existing.key);
  const out = { ...DEFAULT_ROW, ...(existing || {}) }, errors = {};
  delete out.key; delete out.created_at;
  const text = (k, max, multiline) => {
    if (!(k in input)) return;
    let s = String(input[k] ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, " ");
    s = multiline ? s.replace(/[ \t]+/g, " ").trim() : s.replace(/\s+/g, " ").trim();
    if (s.length > max) errors[k] = `En fazla ${max} karakter olabilir.`; else out[k] = s;
  };
  text("name", 60); text("label", 30); text("block_eyebrow", 60); text("block_title", 100); text("seo_title", 70);
  text("description", 400, true); text("seo_desc", 200, true);
  if (!out.name) errors.name = "Kategori adı zorunludur.";

  // Adres: sistem sayfalarında (haberler.html, etkinlikler.html) sabittir. Değişen adres eski adresten yönlendirilir.
  if (!out.page && ("slug" in input || !existing)) {
    const s = slugify(String(input.slug || "").trim() || out.name);
    if (!s) errors.slug = "Geçerli bir adres girin (harf, rakam ve tire).";
    else if (others.some((c) => c.slug === s)) errors.slug = "Bu adres başka bir kategoride kullanılıyor.";
    else {
      if (existing && existing.slug && existing.slug !== s) out.old_slugs = [...new Set([...(existing.old_slugs || []), existing.slug])];
      out.old_slugs = (out.old_slugs || []).filter((x) => x !== s);
      out.slug = s;
    }
  }
  if ("parent" in input) {
    const p = String(input.parent || "");
    const parent = p && others.find((c) => c.key === p);
    if (!p) out.parent = "";
    else if (!parent) errors.parent = "Üst kategori bulunamadı.";
    else if (parent.parent) errors.parent = "Menü iki düzeylidir: alt kategorinin altına kategori eklenemez.";
    else if (existing && others.some((c) => c.parent === existing.key)) errors.parent = "Alt kategorileri olan bir kategori başka bir kategorinin altına taşınamaz.";
    else out.parent = p;
  }
  for (const k of ["menu_show", "home_show", "open_submit"]) {
    if (k in input) out[k] = [true, "true", 1, "1", "on"].includes(input[k]);
  }
  if ("menu_order" in input) {
    const n = Number(input.menu_order);
    if (!Number.isInteger(n) || n < 0 || n > 999) errors.menu_order = "0 ile 999 arasında bir tam sayı girin."; else out.menu_order = n;
  }
  if ("count" in input) {
    const n = Number(input.count);
    if (!COUNTS.includes(n)) errors.count = "Listeden bir seçenek seçin."; else out.count = n;
  }
  if ("sort" in input) { if (!SORTS[input.sort]) errors.sort = "Listeden bir seçenek seçin."; else out.sort = input.sort; }
  if ("style" in input) { if (!STYLES[input.style]) errors.style = "Listeden bir seçenek seçin."; else out.style = input.style; }
  if ("pages" in input) {
    const arr = Array.isArray(input.pages) ? input.pages : String(input.pages || "").split(",");
    const pages = [...new Set(arr.map((s) => String(s).trim()).filter(Boolean))];
    if (pages.some((p) => !PAGES[p])) errors.pages = "Geçersiz sayfa seçimi."; else out.pages = pages;
  }
  if (Object.keys(errors).length) throw new CategoryError(errors);
  return out;
}

// Yeni sahibi olan bir adres, başka kategorinin eski adres listesinden çıkarılır (yönlendirme çakışmasın).
function releaseSlug(slug, exceptKey) {
  for (const c of list()) {
    if (c.key === exceptKey || !(c.old_slugs || []).includes(slug)) continue;
    write(c.key, { ...c, old_slugs: c.old_slugs.filter((x) => x !== slug) }, null);
  }
}

function write(key, row, userId) {
  const data = { ...row }; delete data.key; delete data.created_at;
  db.prepare(`INSERT INTO categories (key, data, updated_by) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = datetime('now'), updated_by = excluded.updated_by`).run(key, JSON.stringify(data), userId ?? null);
}

function create(input, user) {
  const row = clean(input, null);
  const used = new Set(db.prepare("SELECT key FROM categories").all().map((r) => r.key));
  let key = row.slug.slice(0, 40).replace(/-+$/, ""), i = 2;
  while (used.has(key)) key = `${row.slug.slice(0, 36)}-${i++}`;
  db.exec("BEGIN");
  try { write(key, row, user?.id); releaseSlug(row.slug, key); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  return get(key);
}

function update(key, input, user) {
  const existing = get(key);
  if (!existing) return null;
  const row = clean(input, existing);
  db.exec("BEGIN");
  try { write(key, row, user?.id); releaseSlug(row.slug, key); db.exec("COMMIT"); } catch (e) { db.exec("ROLLBACK"); throw e; }
  return get(key);
}

// Yalnızca boş kategori silinir: içinde (geri dönüşüm kutusundakiler dahil) haber ya da alt kategori varsa reddedilir.
function remove(key) {
  const c = get(key);
  if (!c) return { error: "Kategori bulunamadı.", status: 404 };
  if (c.page) return { error: "Bu kategori sitenin ana bölümlerinden biri; silinemez. Menüden gizleyebilirsiniz.", status: 400 };
  if (list().some((x) => x.parent === key)) return { error: "Önce alt kategorileri başka bir kategoriye taşıyın.", status: 400 };
  const n = counts()[key];
  if (n && n.live + n.trash > 0) return { error: `Bu kategoride ${n.live + n.trash} kayıt var; kayıtlar korunur, kategori silinemez. Menüden gizleyebilirsiniz.`, status: 400 };
  db.prepare("DELETE FROM categories WHERE key = ?").run(key);
  return { ok: true };
}

// ---------------------------------------------------------------- menü
function menuPages() {
  const stored = Object.fromEntries(db.prepare("SELECT key, menu_show, menu_order FROM menu_pages").all().map((r) => [r.key, r]));
  return defaults().pages.map((p) => (stored[p.key] ? { ...p, menu_show: !!stored[p.key].menu_show, menu_order: stored[p.key].menu_order } : p));
}

// items: [{ type: "page" | "category", key, menu_show, menu_order }] — yalnızca görünürlük ve sıra değişir.
function saveMenu(items, user) {
  if (!Array.isArray(items)) throw new CategoryError({ _: "Geçersiz menü." });
  const pages = new Set(defaults().pages.map((p) => p.key)), cats = new Map(list().map((c) => [c.key, c]));
  const errors = {};
  for (const it of items) {
    const n = Number(it?.menu_order);
    if (!Number.isInteger(n) || n < 0 || n > 999) errors[`${it?.type}:${it?.key}`] = "Sıra 0 ile 999 arasında olmalı.";
    if (it?.type === "page" ? !pages.has(it.key) : it?.type !== "category" || !cats.has(it.key)) errors[`${it?.type}:${it?.key}`] = "Bilinmeyen menü öğesi.";
  }
  if (Object.keys(errors).length) throw new CategoryError(errors);
  const show = (v) => [true, "true", 1, "1", "on"].includes(v);
  const putPage = db.prepare(`INSERT INTO menu_pages (key, menu_show, menu_order) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET menu_show = excluded.menu_show, menu_order = excluded.menu_order`);
  db.exec("BEGIN");
  try {
    for (const it of items) {
      if (it.type === "page") putPage.run(it.key, show(it.menu_show) ? 1 : 0, Number(it.menu_order));
      else write(it.key, { ...cats.get(it.key), menu_show: show(it.menu_show), menu_order: Number(it.menu_order) }, user?.id);
    }
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

// ---------------------------------------------------------------- taşıma
// İlk açılışta varsayılan kategoriler yazılır; eski "Son haberler" / "Koordinasyon" ana sayfa ayarları kategorilere aktarılır.
// Eski ayar satırları silinmez (geri dönüşte önceki sürüm aynen çalışır).
function seed() {
  return runOnce(MIGRATION, () => {
    const raw = (k) => { const r = db.prepare("SELECT value FROM settings WHERE key = ?").get(k); return r ? JSON.parse(r.value) : undefined; };
    const nearest = (n) => COUNTS.filter(Boolean).reduce((a, b) => (Math.abs(b - n) < Math.abs(a - n) ? b : a));
    const ins = db.prepare("INSERT OR IGNORE INTO categories (key, data) VALUES (?, ?)");
    const cats = defaults().categories;
    for (const c of cats) {
      const row = { ...DEFAULT_ROW, ...c };
      if (c.key === "haber") {
        if (raw("home_show_news") !== undefined) row.home_show = !!raw("home_show_news");
        if (raw("home_news_count") != null) row.count = nearest(Number(raw("home_news_count")) || 6);
      }
      if (c.key === "koordinasyon" && raw("home_show_coord") !== undefined) row.home_show = !!raw("home_show_coord");
      delete row.key;
      ins.run(c.key, JSON.stringify(row));
    }
    return cats.length;
  });
}

// Kategorisi tanımlı olmayan haberler (ör. elle eklenmiş bölüm adı) için gizli bir kategori açılır: hiçbir kayıt sahipsiz kalmaz.
function adoptOrphans() {
  const known = new Set(db.prepare("SELECT key FROM categories").all().map((r) => r.key));
  const forums = db.prepare("SELECT DISTINCT json_extract(data, '$.forum') AS f FROM items WHERE kind = 'topic'").all()
    .map((r) => r.f).filter((f) => f && !known.has(f));
  const slugs = new Set(list().map((c) => c.slug));
  for (const f of forums) {
    let slug = slugify(f) || "kategori", i = 2;
    while (slugs.has(slug)) slug = `${slugify(f) || "kategori"}-${i++}`;
    slugs.add(slug);
    write(f, { ...DEFAULT_ROW, name: f, slug, menu_order: 200 }, null);
  }
  return forums;
}

// Geri alma: kategori tablolarını kaldırır. Haber kayıtları ve eski ayarlar olduğu gibi kalır.
function rollback() {
  db.exec("DROP TABLE IF EXISTS categories; DROP TABLE IF EXISTS menu_pages;");
  db.prepare("DELETE FROM migrations WHERE name = ?").run(MIGRATION);
}

// Site üreteci için dışa aktarım (data/categories.json ile aynı biçim)
const exportData = () => ({ categories: list().map(({ created_at, ...c }) => c), pages: menuPages() });

seed();

module.exports = {
  FIELDS, GROUPS, PAGES, COUNTS, SORTS, STYLES, MIGRATION, CategoryError,
  list, get, create, update, remove, counts, topicChoices, labelOf, menuPages, saveMenu, seed, adoptOrphans, rollback, exportData, slugify,
};
