// İçerik (akademisyen, eser, haber/etkinlik) şemaları, doğrulama, kayıt ve site üreteci için dışa aktarım.
const fs = require("node:fs");
const path = require("node:path");
const sanitizeHtml = require("sanitize-html");
const { db, plain, SEED_FILES } = require("./db");

const RANKS = ["Prof. Dr.", "Doç. Dr.", "Dr. Öğr. Üyesi", "Dr.", "Arş. Gör. Dr.", "Arş. Gör.", "Öğr. Gör. Dr.", "Öğr. Gör.", "Dr. Öğrencisi", "YL. Öğrencisi"];
const GROUPS = ["Öğretim Elemanları", "Üniversite Dışı Elemanlar", "Emekliler", "Rahmetle Andıklarımız"];
const WORK_TYPES = {
  Tezler: ["Yüksek Lisans", "Doktora", "Doçentlik"],
  Kitaplar: ["Telif", "Tercüme", "Tahkik", "Derleme"],
  Makaleler: ["Telif", "Tercüme"],
  Tebliğler: ["Ulusal", "Uluslararası"],
};
const FORUMS = { haber: "Haber", etkinlik: "Etkinlik / Sempozyum", kitap: "Kitap Haberi" };
// Yalnızca yöneticinin seçebildiği eski forum bölümleri
const ADMIN_FORUMS = { ...FORUMS, "eser-tr": "Türkçe Eser Tanıtımı", "eser-ar": "Arapça Eser Tanıtımı", "eser-en": "Yabancı Dilde Eser Tanıtımı", sss: "Sık Sorulan Soru", anket: "Anket" };

// Alan tanımları: tür, zorunluluk, uzunluk ve seçenekler. Panel formları da bu tanımla çizilir (GET /api/schema).
const SCHEMAS = {
  member: [
    { key: "name", label: "Ad Soyad", type: "text", required: true, max: 120 },
    { key: "title", label: "Unvan", type: "text", suggest: RANKS, required: true, max: 60 },
    { key: "group", label: "Grup", type: "select", options: GROUPS, admin: true },
    { key: "university", label: "Üniversite / Kurum", type: "text", max: 160 },
    { key: "city", label: "Şehir", type: "text", max: 60 },
    { key: "web", label: "Kişisel web sayfası", type: "url", max: 300 },
    { key: "email", label: "E-posta (sitede görünür)", type: "email", max: 160 },
    { key: "photo", label: "Fotoğraf", type: "image" },
    { key: "bio", label: "Özgeçmiş", type: "html", max: 30000 },
  ],
  work: [
    { key: "title", label: "Başlık", type: "text", required: true, max: 400 },
    { key: "author", label: "Yazar", type: "text", required: true, max: 200 },
    { key: "category", label: "Kategori", type: "select", options: Object.keys(WORK_TYPES), required: true },
    { key: "type", label: "Tür", type: "select", options: [...new Set(Object.values(WORK_TYPES).flat())], dependsOn: "category", optionsBy: WORK_TYPES, required: true },
    { key: "year", label: "Yıl", type: "year" },
    { key: "place", label: "Basım yeri", type: "text", max: 80 },
    { key: "institution", label: "Kurum / Dergi / Yayınevi", type: "text", max: 200 },
    { key: "pages", label: "Sayfa", type: "text", max: 40 },
    { key: "contributor", label: "Danışman / Emeği geçen", type: "text", max: 200 },
    { key: "contribType", label: "Emek türü", type: "text", suggest: ["Dan.", "Edt.", "Çev.", "Tahkik"], max: 40 },
    { key: "url", label: "Tam metin adresi", type: "url", max: 600 },
    { key: "ozet", label: "Özet (Türkçe)", type: "html", max: 40000 },
    { key: "abstract", label: "Abstract (İngilizce)", type: "html", max: 40000 },
  ],
  topic: [
    { key: "title", label: "Başlık", type: "text", required: true, max: 300 },
    { key: "forum", label: "Bölüm", type: "select", options: Object.keys(ADMIN_FORUMS), memberOptions: Object.keys(FORUMS), labels: ADMIN_FORUMS, required: true },
    { key: "date", label: "Tarih", type: "date" },
    { key: "image", label: "Kapak görseli", type: "image" },
    { key: "body", label: "Metin", type: "html", required: true, max: 60000 },
  ],
};
const KINDS = Object.keys(SCHEMAS);

class ValidationError extends Error {
  constructor(fields) { super("Lütfen işaretli alanları düzeltin."); this.fields = fields; }
}

// ---------------------------------------------------------------- HTML temizleme
// Site köküne göre yollar "{ROOT}" ile saklanır; üretici her sayfa için doğru göreli yola çevirir.
function toRootPath(u) {
  u = String(u || "").trim();
  if (u.startsWith("{ROOT}")) return u;
  // kendi alan adımıza verilmiş mutlak adresleri de göreli yola çevir
  const local = u.replace(/^https?:\/\/(?:www\.)?(?:mezhep\.ihyadijital\.com|localhost(?::\d+)?)(?=\/)/i, "");
  const m = local.match(/^\/?((?:media|uploads)\/\S+|(?:eser|haber|akademisyen|galeri)\/[\w-]+\.html|[a-z]+\.html)$/i);
  return m ? "{ROOT}" + m[1] : u;
}

const SANITIZE = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "a", "img", "ul", "ol", "li", "h2", "h3", "h4", "blockquote",
    "table", "thead", "tbody", "tr", "td", "th", "sup", "sub"],
  allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt", "loading"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: false,
  transformTags: {
    b: "strong", i: "em", h1: "h2", div: "p",
    a: (tag, attribs) => {
      const href = toRootPath(attribs.href);
      const ext = /^https?:/i.test(href);
      return { tagName: "a", attribs: ext ? { href, target: "_blank", rel: "noopener" } : { href } };
    },
    img: (tag, attribs) => ({ tagName: "img", attribs: { src: toRootPath(attribs.src), alt: attribs.alt || "", loading: "lazy" } }),
  },
  exclusiveFilter: (frame) => frame.tag === "img" && !/^(\{ROOT\}(media|uploads)\/|https:\/\/)/.test(frame.attribs.src || ""),
};

function cleanHtml(html) {
  let h = sanitizeHtml(String(html || ""), SANITIZE).replace(/ /g, " ").trim();
  h = h.replace(/<p>\s*(<br\s*\/?>\s*)*<\/p>/g, "").replace(/(<br\s*\/?>\s*){3,}/g, "<br><br>");
  return htmlText(h) || /<img/.test(h) ? h : "";
}

const htmlText = (h) => sanitizeHtml(String(h || ""), { allowedTags: [], allowedAttributes: {} })
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- doğrulama
const trDate = (d = new Date()) => `${d.getDate()}.${String(d.getMonth() + 1).padStart(2, "0")}.${d.getFullYear()}`;
const trTime = (d = new Date()) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// Gelen alanları şemaya göre temizler. "partial" iken yalnızca gönderilen alanlar döner (düzeltme önerileri için).
function normalize(kind, input, { partial = false, isAdmin = false } = {}) {
  const schema = SCHEMAS[kind];
  if (!schema) throw new ValidationError({ _: "Bilinmeyen içerik türü." });
  const out = {}, errors = {};
  for (const f of schema) {
    if (!(f.key in (input || {}))) {
      if (!partial && f.required) errors[f.key] = `${f.label} zorunludur.`;
      continue;
    }
    if (f.admin && !isAdmin) continue;
    let v = input[f.key];
    v = v == null ? "" : v;
    switch (f.type) {
      case "html": v = cleanHtml(v); break;
      case "year": {
        v = String(v).trim();
        if (v === "") { v = null; break; }
        if (!/^\d{4}$/.test(v) || +v < 600 || +v > new Date().getFullYear() + 1) { errors[f.key] = "Geçerli bir yıl girin."; continue; }
        v = +v; break;
      }
      case "date": {
        v = String(v).trim();
        const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (iso) v = `${+iso[3]}.${iso[2]}.${iso[1]}`;
        if (v && !/^\d{1,2}\.\d{1,2}\.\d{4}$/.test(v)) { errors[f.key] = "Tarih GG.AA.YYYY biçiminde olmalı."; continue; }
        break;
      }
      case "url": {
        v = String(v).trim();
        if (v && !/^https?:\/\/[^\s"'<>]+\.[^\s"'<>]+$/i.test(v)) { errors[f.key] = "Adres http:// veya https:// ile başlamalı."; continue; }
        break;
      }
      case "email": {
        v = String(v).trim();
        if (v && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v)) { errors[f.key] = "Geçerli bir e-posta girin."; continue; }
        break;
      }
      case "image": {
        v = String(v).trim().replace(/^\{ROOT\}/, "").replace(/^\//, "");
        if (v && !/^(media|uploads)\/[\w./-]+\.(jpe?g|png|webp|gif)$/i.test(v)) { errors[f.key] = "Geçersiz görsel."; continue; }
        break;
      }
      case "select": {
        v = String(v).trim();
        const allowed = !isAdmin && f.memberOptions ? f.memberOptions : f.options;
        if (v && !allowed.includes(v)) { errors[f.key] = "Listeden bir seçenek seçin."; continue; }
        break;
      }
      default: v = String(v).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
    }
    if (f.max && typeof v === "string" && v.length > f.max) { errors[f.key] = `${f.label} en fazla ${f.max} karakter olabilir.`; continue; }
    if (f.required && (v === "" || v == null)) { errors[f.key] = `${f.label} zorunludur.`; continue; }
    out[f.key] = v;
  }
  if (kind === "work" && out.category && out.type && !WORK_TYPES[out.category].includes(out.type)) {
    errors.type = `${out.category} için geçerli bir tür seçin.`;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

function rankOf(title) {
  const t = String(title || "");
  if (/^Prof/i.test(t)) return "Prof. Dr.";
  if (/^Doç/i.test(t)) return "Doç. Dr.";
  if (/Öğr(\.|etim)\s*Üyesi|Yrd\.\s*Doç/i.test(t)) return "Dr. Öğr. Üyesi";
  if (/^Arş/i.test(t)) return "Arş. Gör.";
  if (/^Dr\b/i.test(t)) return "Dr.";
  return t;
}

// ---------------------------------------------------------------- okuma / yazma
function getItem(kind, id) {
  const row = db.prepare("SELECT data FROM items WHERE kind = ? AND id = ? AND deleted = 0").get(kind, id);
  return row ? JSON.parse(row.data) : null;
}

function listItems(kind) {
  return db.prepare("SELECT data FROM items WHERE kind = ? AND deleted = 0").all(kind).map((r) => JSON.parse(r.data));
}

function nextId(kind) {
  return (db.prepare("SELECT max(id) AS m FROM items WHERE kind = ?").get(kind).m || 0) + 1;
}

// Temizlenmiş alanları mevcut kayda işler ve türetilmiş alanları (özet, kapak, gönderiler) günceller.
function applyFields(kind, existing, fields, user) {
  const item = { ...(existing || {}) };
  if (kind === "topic") {
    const { body, ...rest } = fields;
    Object.assign(item, rest);
    item.posts = Array.isArray(item.posts) ? item.posts.map((p) => ({ ...p })) : [];
    if (body !== undefined) {
      if (item.posts.length) item.posts[0].html = body;
      else item.posts.push({ author: user?.name || "", date: item.date || trDate(), time: trTime(), html: body });
    }
    item.date = item.date || trDate();
    if (item.posts[0]) item.posts[0].date = item.date;
    item.author = item.author || item.posts[0]?.author || user?.name || "";
    if ("image" in fields) item.image = fields.image ? "{ROOT}" + fields.image : "";
    if (!item.image && item.posts[0]) {
      const m = item.posts[0].html.match(/<img src="([^"]+)"/);
      item.image = m ? m[1] : "";
    }
    item.summary = htmlText(item.posts[0]?.html).slice(0, 260);
  } else if (kind === "work") {
    Object.assign(item, fields);
    for (const k of ["place", "institution", "pages", "contributor", "contribType", "url", "ozet", "abstract", "added"]) item[k] ??= "";
    item.year ??= null;
    item.hits ??= 0;
    item.added ||= trDate();
  } else if (kind === "member") {
    Object.assign(item, fields);
    item.group ||= "Öğretim Elemanları";
    // build.py öğretim elemanlarını unvan kategorisine (rank), diğerlerini gruba göre süzer
    item.rank = item.group === "Öğretim Elemanları" ? rankOf(item.title) : item.rank || item.group;
    for (const k of ["university", "city", "bio", "photo", "web", "email"]) item[k] ??= "";
    item.hits ??= 0;
    item.added ||= trDate();
  }
  return item;
}

function saveItem(kind, id, item, userId) {
  if (id == null) id = nextId(kind);
  item.id = id;
  db.prepare(
    `INSERT INTO items (kind, id, data, updated_at, updated_by) VALUES (?, ?, ?, datetime('now'), ?)
     ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, deleted = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(kind, id, JSON.stringify(item), userId ?? null);
  return item;
}

function deleteItem(kind, id, userId) {
  return db.prepare("UPDATE items SET deleted = 1, updated_at = datetime('now'), updated_by = ? WHERE kind = ? AND id = ?").run(userId ?? null, kind, id).changes > 0;
}

// Panel formu için kaydı şema alanlarına indirger (konu metni = ilk gönderi).
function formValues(kind, item) {
  if (!item) return {};
  const v = {};
  for (const f of SCHEMAS[kind]) v[f.key] = item[f.key] ?? "";
  if (kind === "topic") {
    v.body = item.posts?.[0]?.html || "";
    v.image = String(item.image || "").replace(/^\{ROOT\}/, "");
  }
  return v;
}

// Site üreteci (scripts/build.py) için data/*.json dosyalarını yazar.
function exportAll(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const write = (name, obj) => {
    const tmp = path.join(dir, name + ".json.tmp");
    fs.writeFileSync(tmp, JSON.stringify(obj));
    fs.renameSync(tmp, path.join(dir, name + ".json"));
  };
  for (const [kind, file] of Object.entries(SEED_FILES)) {
    let rows = listItems(kind);
    if (kind === "member") rows.sort((a, b) => a.name.localeCompare(b.name, "tr"));
    else if (kind === "topic") rows.sort((a, b) => b.id - a.id);
    else rows.sort((a, b) => a.id - b.id);
    write(file, rows);
  }
  write("pages", getItem("page", 1) || { welcome: "", policy: "" });
}

module.exports = {
  SCHEMAS, KINDS, RANKS, GROUPS, WORK_TYPES, FORUMS, ValidationError, normalize, cleanHtml, htmlText,
  getItem, listItems, applyFields, saveItem, deleteItem, formValues, exportAll, trDate, plain,
};
