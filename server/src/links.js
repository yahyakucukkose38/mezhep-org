// Bağlantılar rehberi (baglantilar.html): üniversiteler, araştırma merkezleri, dergiler, veri tabanları ve diğer internet kaynakları.
// Bağlantılar items tablosunda "link" türünde durur (geri dönüşüm kutusu, sürüm denetimi ve site üretimi diğer içeriklerle ortak).
// Kategorileri haber kategorilerinden ayrıdır ("link_categories" tablosu): iki düzey (kategori › alt kategori), sayı sınırı yok.
// Kayıt: { id, name, url, category (kategori anahtarı), sub (alt kategori anahtarı ya da ""), desc, hide_desc, logo, tags [],
//          status "aktif" | "pasif", order (özel sıra; boş = sona), added }
const { db } = require("./db");
const C = require("./content");
const CAT = require("./categories");

db.exec(`
CREATE TABLE IF NOT EXISTS link_categories (
  key        TEXT PRIMARY KEY,             -- bağlantı kaydındaki category / sub değeri; oluşturulduktan sonra değişmez
  data       TEXT NOT NULL,                -- { name, parent, order, description }
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
);
CREATE INDEX IF NOT EXISTS items_link_category ON items(json_extract(data, '$.category')) WHERE kind = 'link';
CREATE INDEX IF NOT EXISTS items_link_sub ON items(json_extract(data, '$.sub')) WHERE kind = 'link';
CREATE INDEX IF NOT EXISTS items_link_status ON items(json_extract(data, '$.status')) WHERE kind = 'link';
`);

// Panelde "Önerilen kategorileri ekle" ile tek tıkla açılabilen başlangıç kategorileri
const SUGGESTED = ["Üniversiteler ve İlahiyat Fakülteleri", "Akademik Araştırma Merkezleri", "Bilimsel Dergiler", "Kütüphaneler ve Veri Tabanları",
  "İslam Mezhepleri Tarihi Kaynakları", "Akademik Kuruluşlar", "Dijital Kaynaklar", "Ulusal ve Uluslararası Kurumlar", "Diğer Bağlantılar"];
const FALLBACK = "Diğer Bağlantılar";
const STATUS = { aktif: "Aktif", pasif: "Pasif" };
const SORTS = { az: "Ada göre (A–Z)", za: "Ada göre (Z–A)", new: "En yeni", old: "En eski", manual: "Özel sıra" };
const IMPORT_MAX_ROWS = 5000;

class LinkError extends Error {
  constructor(message, fields, status = 400, extra = {}) { super(message); this.fields = fields || undefined; this.status = status; Object.assign(this, extra); }
}

const fold = (s) => String(s ?? "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").replace(/ı/g, "i")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
// Türkçe alfabe sırası (Ç, Ğ, I/İ, Ö, Ş, Ü); büyük/küçük harf ve şapka (â, î, û) sırayı değiştirmez
const coll = new Intl.Collator("tr", { sensitivity: "base", numeric: true });
const byName = (a, b) => coll.compare(a.name || "", b.name || "") || a.id - b.id;
const SORTER = {
  az: byName, za: (a, b) => byName(b, a), new: (a, b) => b.id - a.id, old: (a, b) => a.id - b.id,
  manual: (a, b) => (a.order ?? 1e9) - (b.order ?? 1e9) || byName(a, b),
};

// ---------------------------------------------------------------- kategoriler
const catOrder = (a, b) => a.order - b.order || coll.compare(a.name, b.name);

// Ağaç sırasıyla: üst kategori, ardından alt kategorileri
function cats() {
  const rows = db.prepare("SELECT key, data FROM link_categories").all()
    .map((r) => ({ name: "", parent: "", order: 100, description: "", ...JSON.parse(r.data), key: r.key }));
  const keys = new Set(rows.map((c) => c.key));
  for (const c of rows) if (c.parent && !keys.has(c.parent)) c.parent = "";
  const out = [];
  for (const top of rows.filter((c) => !c.parent).sort(catOrder)) out.push(top, ...rows.filter((c) => c.parent === top.key).sort(catOrder));
  return out;
}
const catGet = (key) => (key ? cats().find((c) => c.key === key) || null : null);

function writeCat(key, row, userId) {
  const data = { name: row.name, parent: row.parent || "", order: row.order, description: row.description || "" };
  db.prepare(`INSERT INTO link_categories (key, data, updated_by) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET data = excluded.data, updated_at = datetime('now'), updated_by = excluded.updated_by`).run(key, JSON.stringify(data), userId ?? null);
}

function newKey(name) {
  const used = new Set(db.prepare("SELECT key FROM link_categories").all().map((r) => r.key));
  const base = CAT.slugify(name).slice(0, 40).replace(/-+$/, "") || "kategori";
  let key = base, i = 2;
  while (used.has(key)) key = `${base.slice(0, 36)}-${i++}`;
  return key;
}

const nextOrder = (all, parent) => Math.max(0, ...all.filter((c) => (c.parent || "") === parent).map((c) => c.order)) + 10;

function cleanCat(input, existing) {
  input = input || {};
  const all = cats(), errors = {};
  const out = { name: existing?.name || "", parent: existing?.parent || "", order: existing?.order ?? null, description: existing?.description || "" };
  if ("name" in input || !existing) {
    const n = String(input.name ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
    if (!n) errors.name = "Kategori adı zorunludur.";
    else if (n.length > 80) errors.name = "En fazla 80 karakter olabilir.";
    else out.name = n;
  }
  if ("description" in input) {
    const d = String(input.description ?? "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
    if (d.length > 300) errors.description = "En fazla 300 karakter olabilir."; else out.description = d;
  }
  if ("parent" in input) {
    const p = String(input.parent || "");
    const parent = p && all.find((c) => c.key === p);
    if (!p) out.parent = "";
    else if (!parent || (existing && p === existing.key)) errors.parent = "Üst kategori bulunamadı.";
    else if (parent.parent) errors.parent = "Kategoriler iki düzeylidir: alt kategorinin altına kategori eklenemez.";
    else if (existing && all.some((c) => c.parent === existing.key)) errors.parent = "Alt kategorileri olan bir kategori başka bir kategorinin altına taşınamaz.";
    else out.parent = p;
  }
  if ("order" in input && input.order !== "" && input.order != null) {
    const n = Number(input.order);
    if (!Number.isInteger(n) || n < 0 || n > 9999) errors.order = "0 ile 9999 arasında bir tam sayı girin."; else out.order = n;
  }
  if (!errors.name && all.some((c) => c.key !== existing?.key && (c.parent || "") === out.parent && fold(c.name) === fold(out.name))) {
    errors.name = out.parent ? "Bu kategoride aynı adlı bir alt kategori var." : "Aynı adlı bir kategori var.";
  }
  if (Object.keys(errors).length) throw new LinkError("Lütfen işaretli alanları düzeltin.", errors);
  if (out.order == null || (existing && out.parent !== existing.parent && !("order" in input))) out.order = nextOrder(all.filter((c) => c.key !== existing?.key), out.parent);
  return out;
}

// Bağlantıların kategori / alt kategori alanını kategori ağacına uydurur (alt kategori taşındığında ya da üst düzeye alındığında).
function relink(key, userId) {
  const c = catGet(key);
  if (!c) return;
  const rows = db.prepare(`SELECT id, data FROM items WHERE kind = 'link' AND (json_extract(data, '$.category') = ? OR json_extract(data, '$.sub') = ?)`).all(key, key);
  for (const r of rows) {
    const it = JSON.parse(r.data);
    if (c.parent) { it.category = c.parent; it.sub = key; } else if (it.sub === key) { it.category = key; it.sub = ""; } else continue;
    db.prepare("UPDATE items SET data = ?, updated_by = coalesce(?, updated_by) WHERE kind = 'link' AND id = ?").run(JSON.stringify(it), userId ?? null, r.id);
  }
}

const tx = (fn) => { db.exec("BEGIN"); try { const out = fn(); db.exec("COMMIT"); return out; } catch (e) { db.exec("ROLLBACK"); throw e; } };

function createCat(input, user) {
  const row = cleanCat(input, null), key = newKey(row.name);
  writeCat(key, row, user?.id);
  return catGet(key);
}

function updateCat(key, input, user) {
  const existing = catGet(key);
  if (!existing) throw new LinkError("Kategori bulunamadı.", null, 404);
  const row = cleanCat(input, existing);
  return tx(() => {
    writeCat(key, row, user?.id);
    if (row.parent !== existing.parent) relink(key, user?.id);
    return catGet(key);
  });
}

// Kategori silinirken bağlantıları silinmez: içinde (geri dönüşüm kutusundakiler dahil) bağlantı varsa taşınacağı kategori seçilmelidir.
function removeCat(key, moveTo, user) {
  const c = catGet(key);
  if (!c) throw new LinkError("Kategori bulunamadı.", null, 404);
  if (cats().some((x) => x.parent === key)) throw new LinkError("Bu kategorinin alt kategorileri var. Önce alt kategorileri silin ya da başka bir kategorinin altına taşıyın.");
  const rows = db.prepare(`SELECT id, data FROM items WHERE kind = 'link' AND (json_extract(data, '$.category') = ? OR json_extract(data, '$.sub') = ?)`).all(key, key);
  let target = null;
  if (rows.length) {
    if (!moveTo) throw new LinkError(`Bu kategoride ${rows.length} bağlantı var. Bağlantılar silinmez; önce taşınacakları kategoriyi seçin.`, { move_to: "Taşınacak kategoriyi seçin." }, 409, { count: rows.length });
    target = catGet(moveTo);
    if (!target || target.key === key) throw new LinkError("Taşınacak kategori bulunamadı.", { move_to: "Başka bir kategori seçin." });
  }
  return tx(() => {
    for (const r of rows) {
      const it = JSON.parse(r.data);
      if (target.parent) { it.category = target.parent; it.sub = target.key; } else { it.category = target.key; it.sub = ""; }
      db.prepare("UPDATE items SET data = ?, updated_by = ? WHERE kind = 'link' AND id = ?").run(JSON.stringify(it), user?.id ?? null, r.id);
    }
    db.prepare("DELETE FROM link_categories WHERE key = ?").run(key);
    return { moved: rows.length, to: target ? target.key : null };
  });
}

// items: [{ key, order }] — yalnızca sıra değişir (aynı düzeydeki kategoriler arasında)
function reorderCats(items, user) {
  if (!Array.isArray(items)) throw new LinkError("Geçersiz sıralama.");
  const known = new Map(cats().map((c) => [c.key, c]));
  for (const it of items) {
    const n = Number(it?.order);
    if (!known.has(it?.key) || !Number.isInteger(n) || n < 0 || n > 9999) throw new LinkError("Geçersiz sıralama.");
  }
  tx(() => { for (const it of items) writeCat(it.key, { ...known.get(it.key), order: Number(it.order) }, user?.id); });
  return cats();
}

function findOrCreateCat(name, parent, userId) {
  name = String(name || "").replace(/\s+/g, " ").trim().slice(0, 80) || FALLBACK;
  const all = cats();
  const found = all.find((c) => (c.parent || "") === (parent || "") && fold(c.name) === fold(name));
  if (found) return found;
  const key = newKey(name);
  writeCat(key, { name, parent: parent || "", order: nextOrder(all, parent || ""), description: "" }, userId);
  return { key, name, parent: parent || "" };
}

// Önerilen başlangıç kategorilerinden eksik olanlar açılır (var olanlara dokunulmaz)
function addSuggested(user) {
  const tops = new Set(cats().filter((c) => !c.parent).map((c) => fold(c.name)));
  const missing = SUGGESTED.filter((n) => !tops.has(fold(n)));
  tx(() => { for (const n of missing) findOrCreateCat(n, "", user?.id); });
  return missing;
}

// Panel formu ve doğrulama için seçenekler: alt kategoriler "Üst › Alt" biçiminde etiketlenir
function choices() {
  const all = cats(), name = Object.fromEntries(all.map((c) => [c.key, c.name]));
  return {
    options: all.filter((c) => !c.parent).map((c) => c.key),
    subOptions: all.filter((c) => c.parent).map((c) => c.key),
    labels: Object.fromEntries(all.map((c) => [c.key, c.parent ? `${name[c.parent]} › ${c.name}` : c.name])),
    parentOf: Object.fromEntries(all.filter((c) => c.parent).map((c) => [c.key, c.parent])),
  };
}

// Kategori başına bağlantı sayısı (kategori satırı alt kategorilerdekileri de sayar): yayında / pasif / geri dönüşüm kutusunda
function counts() {
  const out = {};
  const add = (k, f) => { if (!k) return; out[k] ??= { live: 0, active: 0, trash: 0 }; out[k][f]++; };
  for (const r of db.prepare(`SELECT json_extract(data, '$.category') AS c, json_extract(data, '$.sub') AS s, json_extract(data, '$.status') AS st, deleted
    FROM items WHERE kind = 'link'`).all()) {
    for (const k of new Set([r.c, r.s])) {
      if (r.deleted) add(k, "trash"); else { add(k, "live"); if (r.st !== "pasif") add(k, "active"); }
    }
  }
  return out;
}

// Eski biçimdeki bağlantıları (kategori ve alt kategori adı metin olarak) kategori anahtarına bağlar; eksik alanları tamamlar.
// İlk açılışta var olan bağlantılar böyle taşınır; sonraki çağrılarda yapılacak iş yoksa hiçbir şey yazmaz.
function adopt() {
  const stale = db.prepare(`SELECT id, data FROM items WHERE kind = 'link' AND (
      json_extract(data, '$.status') IS NULL
      OR coalesce(json_extract(data, '$.category'), '') NOT IN (SELECT key FROM link_categories)
      OR (coalesce(json_extract(data, '$.sub'), '') <> '' AND json_extract(data, '$.sub') NOT IN (SELECT key FROM link_categories)))
    ORDER BY id`).all();
  if (!stale.length) return [];
  return tx(() => stale.map((r) => {
    const it = JSON.parse(r.data), all = new Map(cats().map((c) => [c.key, c]));
    let top = all.get(it.category), sub = null;
    if (top && top.parent) { sub = top; top = all.get(top.parent); }
    if (!top) top = findOrCreateCat(it.category, "", null);
    if (!sub && it.sub) {
      const s = all.get(it.sub);
      sub = s && s.parent === top.key ? s : findOrCreateCat(s ? s.name : it.sub, top.key, null);
    }
    it.category = top.key;
    it.sub = sub ? sub.key : "";
    it.status = it.status === "pasif" ? "pasif" : "aktif";
    if (!Array.isArray(it.tags)) it.tags = [];
    it.hide_desc = !!it.hide_desc;
    for (const k of ["url", "desc", "logo"]) it[k] ??= "";
    it.order ??= null;
    db.prepare("UPDATE items SET data = ? WHERE kind = 'link' AND id = ?").run(JSON.stringify(it), r.id);
    return "link:" + r.id;
  }));
}

// ---------------------------------------------------------------- bağlantılar
// Mükerrer denetimi için adres anahtarı: şema, "www.", sondaki "/" ve varsayılan port önemsiz
function urlKey(u) {
  try {
    const x = new URL(String(u || "").trim());
    if (!/^https?:$/.test(x.protocol)) return "";
    const p = x.pathname.replace(/\/index\.(html?|php|aspx?)$/i, "").replace(/\/+$/, "");
    return x.hostname.toLowerCase().replace(/^www\./, "") + (x.port ? ":" + x.port : "") + p.toLowerCase() + x.search;
  } catch { return ""; }
}

// Aynı adres ya da aynı ad (büyük/küçük harf ve Türkçe karakter farkı gözetilmez)
function duplicates({ name, url }, exceptId, pool) {
  const k = urlKey(url), n = fold(name);
  return (pool || C.listItems("link")).filter((l) => l.id !== exceptId && ((k && urlKey(l.url) === k) || (n && fold(l.name) === n)))
    .map((l) => ({ id: l.id, name: l.name, url: l.url || "", reason: k && urlKey(l.url) === k ? "url" : "name" }));
}

// Kategori ve alt kategori anahtar ya da adla verilebilir (içe aktarma, eski istemciler): anahtara çevrilir
function resolveInput(data, base) {
  const all = cats(), out = { ...data };
  if ("category" in out) {
    const v = String(out.category ?? "").trim();
    const c = all.find((x) => x.key === v) || all.find((x) => !x.parent && fold(x.name) === fold(v));
    if (c && c.parent) { out.category = c.parent; if (!out.sub) out.sub = c.key; } else if (c) out.category = c.key;
  }
  if (out.sub) {
    const v = String(out.sub).trim(), parent = out.category ?? base?.category;
    const s = all.find((x) => x.parent && x.key === v) || all.find((x) => x.parent === parent && fold(x.name) === fold(v));
    if (s) out.sub = s.key;
  }
  return out;
}

const view = (l, labels) => ({
  id: l.id, name: l.name, url: l.url || "", desc: l.desc || "", category: l.category, sub: l.sub || "",
  category_label: labels[l.sub] || labels[l.category] || l.category, status: l.status || "aktif", order: l.order ?? null,
  tags: l.tags || [], logo: l.logo || "", hide_desc: !!l.hide_desc, added: l.added || "",
});

function getLink(id) {
  const l = C.getItem("link", id);
  return l ? { ...view(l, choices().labels), version: C.itemVersion("link", id) } : null;
}

// Kaydet: yeni kayıtta bütün alanlar, düzenlemede yalnızca gönderilenler işlenir. Aynı adres ya da ad varsa
// allowDuplicate verilmedikçe 409 (duplicates listesiyle) döner; panel yöneticiye sorup yeniden gönderir.
function save(user, id, input, { allowDuplicate = false } = {}) {
  const existing = id == null ? null : C.getItem("link", id);
  if (id != null && !existing) throw new LinkError("Bulunamadı.", null, 404);
  const fields = C.normalize("link", resolveInput(input || {}, existing), { isAdmin: true, partial: !!existing });
  const item = C.applyFields("link", existing, fields, user);
  const ch = choices();
  // kategori değişti ve alt kategori gönderilmediyse eski alt kategori düşer
  if (existing && "category" in fields && !("sub" in fields) && item.sub && ch.parentOf[item.sub] !== item.category) item.sub = "";
  if (item.sub && ch.parentOf[item.sub] !== item.category) throw new C.ValidationError({ sub: "Alt kategori seçilen kategoriye ait değil." });
  if (!allowDuplicate && (!existing || "url" in fields || "name" in fields)) {
    const d = duplicates(item, existing ? id : null);
    if (d.length) {
      throw new LinkError(d[0].reason === "url" ? "Bu adres zaten kayıtlı." : "Aynı adlı bir bağlantı zaten var.", null, 409, { duplicates: d });
    }
  }
  return C.saveItem("link", existing ? id : null, item, user?.id);
}

// Panel listesi: kategori ve durum veritabanında (dizinli) süzülür; arama, Türkçe sıralama ve sayfalama sunucuda yapılır.
function query({ q = "", cat = "", status = "", sort = "az", offset = 0, limit = 50 } = {}) {
  const where = ["kind = 'link'", "deleted = 0"], args = [];
  const c = catGet(String(cat || ""));
  if (c) { where.push(c.parent ? "json_extract(data, '$.sub') = ?" : "json_extract(data, '$.category') = ?"); args.push(c.key); }
  if (STATUS[status]) { where.push("json_extract(data, '$.status') = ?"); args.push(status); }
  let rows = db.prepare(`SELECT data FROM items WHERE ${where.join(" AND ")}`).all(...args).map((r) => JSON.parse(r.data));
  const words = fold(q).split(" ").filter(Boolean);
  if (words.length) {
    rows = rows.filter((l) => {
      const t = fold([l.name, l.desc, l.url, (l.tags || []).join(" "), "#" + l.id].join(" "));
      return words.every((w) => t.includes(w));
    });
  }
  rows.sort(SORTER[sort] || SORTER.az);
  offset = Math.max(0, Number.parseInt(offset, 10) || 0);
  limit = Math.min(200, Math.max(1, Number.parseInt(limit, 10) || 50));
  const labels = choices().labels;
  return { total: rows.length, offset, limit, items: rows.slice(offset, offset + limit).map((l) => view(l, labels)) };
}

// Toplu işlem: kategori değiştirme ya da aktif / pasif yapma (silme API'de, silme yetkisiyle ayrıca yapılır)
function bulk(user, ids, action, value) {
  ids = [...new Set((Array.isArray(ids) ? ids : []).map(Number).filter(Number.isInteger))].slice(0, 2000);
  if (!ids.length) throw new LinkError("Önce bağlantı seçin.");
  let apply;
  if (action === "status") {
    if (!STATUS[value]) throw new LinkError("Geçersiz durum.");
    apply = (it) => { it.status = value; };
  } else if (action === "category") {
    const c = catGet(String(value || ""));
    if (!c) throw new LinkError("Taşınacak kategoriyi seçin.");
    apply = (it) => { if (c.parent) { it.category = c.parent; it.sub = c.key; } else { it.category = c.key; it.sub = ""; } };
  } else throw new LinkError("Bilinmeyen toplu işlem.");
  return tx(() => {
    let n = 0;
    for (const id of ids) {
      const it = C.getItem("link", id);
      if (!it) continue;
      apply(it);
      C.saveItem("link", id, it, user?.id);
      n++;
    }
    return n;
  });
}

// ---------------------------------------------------------------- içe / dışa aktarma
const EXPORT_HEAD = ["No", "Bağlantı adı", "URL", "Açıklama", "Kategori", "Alt kategori", "Durum", "Etiketler", "Sıra"];
function exportRows() {
  const all = new Map(cats().map((c) => [c.key, c]));
  return C.listItems("link").sort((a, b) => {
    const ca = all.get(a.category), cb = all.get(b.category);
    return (ca?.order ?? 1e9) - (cb?.order ?? 1e9) || coll.compare(ca?.name || "", cb?.name || "") || byName(a, b);
  }).map((l) => [l.id, l.name, l.url || "", l.desc || "", all.get(l.category)?.name || l.category, l.sub ? all.get(l.sub)?.name || l.sub : "",
    STATUS[l.status] || "Aktif", (l.tags || []).join(", "), l.order ?? ""]);
}

// Başlık satırındaki sütun adları (büyük/küçük harf ve Türkçe karakter farkı önemsiz)
const HEADERS = {
  name: ["bağlantı adı", "bağlantı", "ad", "adı", "isim", "name", "başlık", "site adı", "kaynak adı"],
  url: ["url", "adres", "internet adresi", "web adresi", "link", "web", "site"],
  desc: ["açıklama", "kısa açıklama", "description", "tanım"],
  category: ["kategori", "category"],
  sub: ["alt kategori", "altkategori", "subcategory", "alt başlık"],
  status: ["durum", "yayın durumu", "status"],
  tags: ["etiketler", "etiket", "tags"],
  order: ["sıra", "özel sıra", "öncelik", "sıralama önceliği", "order"],
};
const statusOf = (v) => {
  const s = fold(v);
  if (!s || ["aktif", "active", "yayinda", "evet", "1", "acik"].includes(s)) return "aktif";
  if (["pasif", "passive", "inactive", "taslak", "draft", "hayir", "0", "kapali", "gizli"].includes(s)) return "pasif";
  return null;
};

// rows: [{ line, name, url, desc, category, sub, status, tags, order }] (metin). Her satır doğrulanır, mükerrerler ve açılacak yeni kategoriler işaretlenir.
function checkRows(rows) {
  const all = cats(), pool = C.listItems("link");
  const byUrl = new Map(), byNm = new Map();
  for (const l of pool) { const k = urlKey(l.url); if (k && !byUrl.has(k)) byUrl.set(k, l); const n = fold(l.name); if (n && !byNm.has(n)) byNm.set(n, l); }
  const seenUrl = new Map(), newCats = new Set();
  return rows.map((r) => {
    const errors = [];
    const catName = String(r.category || "").trim() || FALLBACK, subName = String(r.sub || "").trim();
    const top = all.find((c) => !c.parent && (c.key === catName || fold(c.name) === fold(catName)));
    const sub = subName ? all.find((c) => top && c.parent === top.key && (c.key === subName || fold(c.name) === fold(subName))) : null;
    if (catName.length > 80 || subName.length > 80) errors.push("Kategori adı en fazla 80 karakter olabilir.");
    const status = statusOf(r.status);
    if (!status) errors.push("Durum “Aktif” ya da “Pasif” olmalı.");
    let data = {};
    try {
      data = C.normalize("link", { name: r.name ?? "", url: r.url ?? "", desc: r.desc ?? "", tags: r.tags ?? "", order: r.order ?? "" }, { isAdmin: true, partial: true });
    } catch (e) {
      if (!(e instanceof C.ValidationError)) throw e;
      errors.push(...Object.values(e.fields));
    }
    const k = data.url ? urlKey(data.url) : "";
    const dup = (k && byUrl.get(k)) || (data.name && byNm.get(fold(data.name))) || null;
    const twin = k ? seenUrl.get(k) : null;
    if (twin) errors.push(`${twin}. satırla aynı adres.`);
    if (k && !twin) seenUrl.set(k, r.line);
    if (!top) newCats.add(catName);
    if (subName && !sub) newCats.add(`${top ? top.name : catName} › ${subName}`);
    return {
      line: r.line, errors,
      duplicate: dup ? { id: dup.id, name: dup.name, url: dup.url || "", reason: k && urlKey(dup.url) === k ? "url" : "name" } : null,
      data: { name: data.name ?? String(r.name || ""), url: data.url ?? String(r.url || ""), desc: data.desc ?? "", tags: data.tags || [], order: data.order ?? null,
        status: status || "aktif", category: top ? top.name : catName, sub: sub ? sub.name : subName },
      new_category: !top, new_sub: !!subName && !sub,
    };
  }).map((x) => ({ ...x, ok: !x.errors.length }));
}

// Dosyadan okunan tablo (ilk satır başlık) → satırlar
function tableRows(table) {
  if (!Array.isArray(table) || !table.length) throw new LinkError("Dosya boş ya da okunamadı.");
  const head = table[0].map((h) => fold(String(h || "").replace(/[*:]/g, "")));
  const col = {};
  for (const [k, names] of Object.entries(HEADERS)) {
    const i = head.findIndex((h) => names.some((n) => fold(n) === h));
    if (i > -1) col[k] = i;
  }
  if (col.name == null || col.url == null) throw new LinkError("İlk satırda en az “Bağlantı adı” ve “URL” sütun başlıkları bulunmalı.");
  const rows = [];
  table.slice(1).forEach((r, i) => {
    if (!r.some((c) => String(c ?? "").trim())) return;
    const get = (k) => (col[k] == null ? "" : String(r[col[k]] ?? "").replace(/^'(?=[=+\-@])/, "").trim());
    rows.push({ line: i + 2, name: get("name"), url: get("url"), desc: get("desc"), category: get("category"), sub: get("sub"), status: get("status"), tags: get("tags"), order: get("order") });
  });
  if (!rows.length) throw new LinkError("Dosyada başlık satırından sonra kayıt bulunamadı.");
  if (rows.length > IMPORT_MAX_ROWS) throw new LinkError(`Bir seferde en fazla ${IMPORT_MAX_ROWS} satır içe aktarılabilir; dosyayı bölün.`);
  return rows;
}

function importPreview(table) {
  const rows = checkRows(tableRows(table));
  return {
    rows,
    summary: {
      total: rows.length, ok: rows.filter((r) => r.ok && !r.duplicate).length, invalid: rows.filter((r) => !r.ok).length,
      duplicates: rows.filter((r) => r.ok && r.duplicate).length,
      new_categories: [...new Set(rows.filter((r) => r.ok).flatMap((r) => [r.new_category ? r.data.category : null, r.new_sub ? `${r.data.category} › ${r.data.sub}` : null]).filter(Boolean))],
    },
  };
}

// Önizlemeden sonra yönetici onayıyla kayıt: satırlar sunucuda yeniden doğrulanır; mükerrerler istenirse atlanır.
function importCommit(user, rows, { skipDuplicates = true } = {}) {
  if (!Array.isArray(rows) || !rows.length) throw new LinkError("İçe aktarılacak satır yok.");
  if (rows.length > IMPORT_MAX_ROWS) throw new LinkError(`Bir seferde en fazla ${IMPORT_MAX_ROWS} satır içe aktarılabilir.`);
  const clean = rows.map((r, i) => ({
    line: Number.isInteger(r?.line) ? r.line : i + 2,
    ...Object.fromEntries(["name", "url", "desc", "category", "sub", "status", "order"].map((k) => [k, String(r?.[k] ?? "").slice(0, 2000)])),
    tags: Array.isArray(r?.tags) ? r.tags.join(",") : String(r?.tags ?? ""),
  }));
  const checked = checkRows(clean);
  const report = { created: 0, skipped: 0, failed: 0, ids: [], problems: [], new_categories: [] };
  tx(() => {
    for (const r of checked) {
      if (!r.ok) { report.failed++; report.problems.push({ line: r.line, error: r.errors.join(" ") }); continue; }
      if (r.duplicate && skipDuplicates) { report.skipped++; report.problems.push({ line: r.line, error: `Atlandı: zaten kayıtlı (#${r.duplicate.id} ${r.duplicate.name}).` }); continue; }
      const before = new Set(cats().map((c) => c.key));
      const top = findOrCreateCat(r.data.category, "", user?.id);
      const sub = r.data.sub ? findOrCreateCat(r.data.sub, top.key, user?.id) : null;
      for (const c of cats()) if (!before.has(c.key)) report.new_categories.push(c.parent ? `${top.name} › ${c.name}` : c.name);
      const item = C.applyFields("link", null, { ...r.data, category: top.key, sub: sub ? sub.key : "" }, user);
      report.ids.push(C.saveItem("link", null, item, user?.id).id);
      report.created++;
    }
  });
  return report;
}

// ---------------------------------------------------------------- eski "Bağlantılar" haber kategorisinden aktarım
// Bağlantılar daha önce bir haber kategorisi olarak açılmıştı. Oradaki haberler yöneticinin seçimi ve onayıyla bağlantı
// kaydına dönüştürülür; haber kaydı silinmez (yalnızca "aktarıldı" işareti alır, sayfası yerinde kalır).
function legacyRoot() {
  const c = CAT.list().find((x) => !x.page && (x.slug === "baglantilar" || fold(x.name) === "baglantilar"));
  return c ? c.key : "";
}
function firstUrl(html) {
  const href = String(html || "").match(/href="(https?:\/\/[^"]+)"/i);
  if (href) return href[1].replace(/&amp;/g, "&");
  const t = C.htmlText(html).match(/https?:\/\/[^\s<>"]+|\bwww\.[\w-]+(\.[\w-]+)+[^\s<>"]*/i);
  return t ? (t[0].startsWith("http") ? t[0] : "https://" + t[0]) : "";
}
function legacyList(catKey) {
  const key = catKey || legacyRoot(), root = key ? CAT.get(key) : null;
  const haber = CAT.list().filter((c) => !c.page).map((c) => ({ key: c.key, name: c.parent ? `${CAT.get(c.parent)?.name} › ${c.name}` : c.name, redirect: c.redirect || "" }));
  if (!root) return { category: null, categories: haber, items: [] };
  const keys = [root.key, ...CAT.list().filter((x) => x.parent === root.key).map((x) => x.key)];
  const linkCats = cats();
  const items = C.listItems("topic").filter((t) => keys.includes(t.forum)).sort((a, b) => a.id - b.id).map((t) => {
    const html = t.posts?.[0]?.html || "", url = firstUrl(html), text = C.htmlText(html);
    const forum = CAT.get(t.forum);
    const suggest = !forum || forum.key === root.key ? FALLBACK : forum.name;
    const match = linkCats.find((c) => !c.parent && fold(c.name) === fold(suggest));
    const moved = t.moved_to_link && C.getItem("link", t.moved_to_link) ? t.moved_to_link : null;
    return {
      id: t.id, title: t.title, url, desc: fold(text) === fold(url.replace(/^https?:\/\//, "")) || fold(text) === fold(url) ? "" : text.slice(0, 300),
      forum: t.forum, forum_name: forum ? forum.name : t.forum, date: t.date || "", suggest, suggest_key: match ? match.key : "",
      moved_to: moved, duplicate: duplicates({ name: t.title, url })[0] || null,
    };
  });
  return { category: { key: root.key, name: root.name, redirect: root.redirect || "", children: keys.slice(1) }, categories: haber, items };
}

// items: [{ id, target }] — target: bağlantı kategorisi anahtarı ya da "new:Ad". redirect: eski kategori sayfası rehbere yönlendirilsin mi.
function legacyTransfer(user, { category, items, redirect } = {}) {
  const list = legacyList(category);
  if (!list.category) throw new LinkError("Aktarılacak haber kategorisi bulunamadı.", null, 404);
  const byId = new Map(list.items.map((x) => [x.id, x]));
  const report = { created: [], skipped: [], redirected: [] };
  tx(() => {
    for (const sel of Array.isArray(items) ? items : []) {
      const src = byId.get(Number(sel?.id));
      if (!src) { report.skipped.push({ id: sel?.id, error: "Bu kategoride böyle bir haber yok." }); continue; }
      if (src.moved_to) { report.skipped.push({ id: src.id, error: `Daha önce aktarıldı (bağlantı #${src.moved_to}).` }); continue; }
      const url = String(sel.url ?? src.url).trim();
      if (!url) { report.skipped.push({ id: src.id, error: "Metinde internet adresi bulunamadı; bağlantıyı elle ekleyin." }); continue; }
      const t = String(sel.target || "");
      const c = t.startsWith("new:") ? findOrCreateCat(t.slice(4), "", user?.id) : catGet(t) || findOrCreateCat(src.suggest, "", user?.id);
      const cat = c.parent ? { category: c.parent, sub: c.key } : { category: c.key, sub: "" };
      let link;
      try {
        link = save(user, null, { name: src.title, url, desc: src.desc, ...cat, status: "aktif" }, { allowDuplicate: true });
      } catch (e) {
        if (!(e instanceof C.ValidationError)) throw e;
        report.skipped.push({ id: src.id, error: Object.values(e.fields).join(" ") });
        continue;
      }
      const topic = C.getItem("topic", src.id);
      topic.moved_to_link = link.id; // haber silinmez; yeniden aktarılmasın diye işaretlenir
      db.prepare("UPDATE items SET data = ? WHERE kind = 'topic' AND id = ?").run(JSON.stringify(topic), src.id);
      report.created.push({ topic: src.id, link: link.id, name: link.name });
    }
    if (redirect) report.redirected = CAT.setRedirect(list.category.key, "baglantilar.html", user);
  });
  return report;
}

// Site üreteci için (data/link_categories.json)
const exportCategories = () => cats().map(({ key, name, parent, order, description }) => ({ key, name, parent, order, description }));

module.exports = {
  SUGGESTED, STATUS, SORTS, LinkError, EXPORT_HEAD, fold, urlKey,
  cats, catGet, createCat, updateCat, removeCat, reorderCats, addSuggested, choices, counts, adopt,
  duplicates, getLink, save, query, bulk, exportRows, tableRows, importPreview, importCommit,
  legacyList, legacyTransfer, exportCategories,
};
