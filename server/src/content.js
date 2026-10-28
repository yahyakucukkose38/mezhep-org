// İçerik (akademisyen, eser, haber/etkinlik) şemaları, doğrulama, kayıt ve site üreteci için dışa aktarım.
const fs = require("node:fs");
const path = require("node:path");
const sanitizeHtml = require("sanitize-html");
const { db, plain, SEED_FILES } = require("./db");
const CAT = require("./categories");

const RANKS = ["Prof. Dr.", "Doç. Dr.", "Dr. Öğr. Üyesi", "Dr.", "Arş. Gör. Dr.", "Arş. Gör.", "Öğr. Gör. Dr.", "Öğr. Gör.", "Dr. Öğrencisi", "YL. Öğrencisi"];
const GROUPS = ["Öğretim Elemanları", "Üniversite Dışı Elemanlar", "Emekliler", "Rahmetle Andıklarımız"];
const WORK_TYPES = {
  Tezler: ["Yüksek Lisans", "Doktora", "Doçentlik"],
  Kitaplar: ["Telif", "Tercüme", "Tahkik", "Derleme"],
  Makaleler: ["Telif", "Tercüme"],
  Tebliğler: ["Ulusal", "Uluslararası"],
};

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
    // Kategoriler panelden yönetilir (categories.js): seçenekler her istekte veritabanından okunur.
    // Üyeler yalnızca "Üyeler bu kategoride önerebilir" işaretli kategorileri seçebilir.
    { key: "forum", label: "Kategori", type: "select", get options() { return CAT.topicChoices().options; },
      get memberOptions() { return CAT.topicChoices().memberOptions; }, get labels() { return CAT.topicChoices().labels; }, required: true },
    { key: "date", label: "Tarih", type: "date" },
    { key: "order", label: "Sıra (isteğe bağlı; kategori “özel sıra” ile sıralanıyorsa küçük sayı önce gelir)", type: "int", min: 1, max: 9999, admin: true },
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

// ---------------------------------------------------------------- video gömme
// Yalnızca güvenli sağlayıcı listesindeki oynatıcılar: YouTube (çerezsiz alan adı; Shorts dahil) ve Vimeo.
// Kullanıcının yapıştırdığı bağlantı ya da gömme kodu ne olursa olsun, kimlik çıkarılıp standart adres yeniden kurulur.
const VIDEO_HOSTS = ["www.youtube-nocookie.com", "player.vimeo.com"];
function parseVideo(url) {
  const u = String(url || "").trim().replace(/&amp;/g, "&");
  let m = u.match(/^(?:https?:)?\/\/(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i);
  if (m) return { provider: "youtube", id: m[1], short: /\/shorts\//i.test(u) };
  m = u.match(/^(?:https?:)?\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,20}))?(?:[/?#]|$)/i);
  if (m) {
    const h = m[2] || (u.match(/[?&]h=([0-9a-f]{6,20})/i) || [])[1] || "";
    return { provider: "vimeo", id: m[1], hash: h };
  }
  return null;
}
const videoSrc = (v) => (v.provider === "youtube" ? `https://www.youtube-nocookie.com/embed/${v.id}?rel=0` : `https://player.vimeo.com/video/${v.id}${v.hash ? "?h=" + v.hash : ""}`);
const CANON_VIDEO = /^https:\/\/(?:www\.youtube-nocookie\.com\/embed\/[\w-]{11}\?rel=0|player\.vimeo\.com\/video\/\d{6,12}(?:\?h=[0-9a-f]{6,20})?)$/;
function videoFigure(v, half) {
  const cls = ["media-video", v.short ? "short" : "", half ? "half" : ""].filter(Boolean).join(" ");
  return `<figure class="${cls}"><iframe src="${videoSrc(v)}" title="${v.provider === "youtube" ? "YouTube" : "Vimeo"} videosu" loading="lazy" ` +
    `allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></figure>`;
}
const decodeEnt = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&");
// Metindeki gömme kodları (düz metin olarak yapıştırılmış olanlar dahil) standart video bloğuna çevrilir;
// desteklenmeyen sağlayıcıların iframe'leri tamamen atılır.
function embedVideos(html) {
  return String(html || "")
    .replace(/&lt;iframe\b[\s\S]*?&lt;\/iframe&gt;/gi, (code) => `</p>${decodeEnt(code)}<p>`)
    .replace(/<figure\b([^>]*)>\s*(<iframe\b[^>]*>[\s\S]*?<\/iframe>)\s*<\/figure>|<iframe\b[^>]*>[\s\S]*?(?:<\/iframe>|$)/gi, (all, figAttrs, inner) => {
      const src = ((inner || all).match(/\bsrc\s*=\s*["']([^"']+)["']/i) || [])[1];
      const v = parseVideo(src);
      return v ? videoFigure(v, /\bhalf\b/.test(figAttrs || "")) : "";
    });
}

const SANITIZE = {
  allowedTags: ["p", "br", "strong", "b", "em", "i", "u", "a", "img", "ul", "ol", "li", "h2", "h3", "h4", "blockquote",
    "table", "thead", "tbody", "tr", "td", "th", "sup", "sub", "figure", "iframe"],
  allowedAttributes: {
    a: ["href", "target", "rel"], img: ["src", "alt", "loading", "class"], figure: ["class"],
    iframe: ["src", "title", "loading", "allow", "allowfullscreen", "referrerpolicy"],
  },
  // görsel ve videolar "yarım genişlik" ile yan yana dizilebilir
  allowedClasses: { figure: ["media-video", "short", "half"], img: ["half"] },
  allowedIframeHostnames: VIDEO_HOSTS,
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
    img: (tag, attribs) => ({ tagName: "img", attribs: { src: toRootPath(attribs.src), alt: attribs.alt || "", loading: "lazy", ...(/\bhalf\b/.test(attribs.class || "") ? { class: "half" } : {}) } }),
  },
  exclusiveFilter: (frame) => (frame.tag === "img" && !/^(\{ROOT\}(media|uploads)\/|https:\/\/)/.test(frame.attribs.src || "")) ||
    (frame.tag === "iframe" && !CANON_VIDEO.test(frame.attribs.src || "")),
};

function cleanHtml(html) {
  let h = sanitizeHtml(embedVideos(html), SANITIZE).replace(/ /g, " ").trim();
  h = h.replace(/<p>\s*(<br\s*\/?>\s*)*<\/p>/g, "").replace(/(<br\s*\/?>\s*){3,}/g, "<br><br>");
  h = h.replace(/<figure class="media-video[^"]*">\s*<\/figure>/g, "");
  return htmlText(h) || /<(img|iframe)\b/.test(h) ? h : "";
}

const htmlText = (h) => sanitizeHtml(String(h || ""), { allowedTags: [], allowedAttributes: {} })
  .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- yorumlar
// Üye yorumları içerik metinlerinden daha dar bir izin listesiyle temizlenir: tablo ve sınıf yok; görseller yalnızca
// sitenin yükleme klasöründen (dış adreslerden izleme pikseli ya da sıcak bağlantı gelmesin), videolar yalnızca
// VIDEO_HOSTS oynatıcılarından; dış bağlantılar "nofollow ugc" ile işaretlenir.
const COMMENT_IMG = /^\/uploads\/\d{4}-\d{2}\/[0-9a-f]{24}\.(?:jpg|png|webp)$/;
// http(s), mailto ya da site içi yol ("//" ve "/\" ile başlayan adresler tarayıcıda başka siteye gider; kabul edilmez)
const COMMENT_HREF = /^(?:https?:\/\/[^\s<>"]+|mailto:[^\s<>"]+|\/(?![/\\])[^\s<>"]*)$/i;
const COMMENT_SANITIZE = {
  allowedTags: ["p", "br", "strong", "em", "u", "a", "h2", "h3", "ul", "ol", "li", "blockquote", "img", "figure", "iframe"],
  allowedAttributes: {
    a: ["href", "target", "rel"], img: ["src", "alt", "loading"], figure: ["class"],
    iframe: ["src", "title", "loading", "allow", "allowfullscreen", "referrerpolicy"],
  },
  allowedClasses: { figure: ["media-video", "short"] },
  allowedIframeHostnames: VIDEO_HOSTS,
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  allowProtocolRelative: false,
  transformTags: {
    b: "strong", i: "em", h1: "h2", h4: "h3", h5: "h3", h6: "h3", div: "p",
    // geçersiz adresli bağlantı adressiz kalır, cleanCommentHtml onu düz metne indirir
    // (etiket adını değiştirmek sanitize-html'de kapanış etiketlerini karıştırıyor)
    a: (tag, attribs) => {
      const href = String(attribs.href || "").trim();
      if (!COMMENT_HREF.test(href)) return { tagName: "a", attribs: {} };
      return { tagName: "a", attribs: /^https?:/i.test(href) ? { href, target: "_blank", rel: "nofollow ugc noopener noreferrer" } : { href } };
    },
    img: (tag, attribs) => ({
      tagName: "img",
      attribs: { src: String(attribs.src || "").replace(/^https?:\/\/(?:www\.)?(?:mezhep\.(?:net|org)|mezhep\.ihyadijital\.com|localhost(?::\d+)?|127\.0\.0\.1(?::\d+)?)(?=\/)/i, ""), alt: String(attribs.alt || "").slice(0, 200), loading: "lazy" },
    }),
  },
  // video kutusu yalnızca tek bir izinli oynatıcı taşıyabilir (içine metin ya da başka öğe konamaz)
  exclusiveFilter: (frame) => (frame.tag === "img" && !COMMENT_IMG.test(frame.attribs.src || "")) ||
    (frame.tag === "iframe" && !CANON_VIDEO.test(frame.attribs.src || "")) ||
    (frame.tag === "figure" && (frame.text.trim() !== "" || !(frame.mediaChildren || []).includes("iframe"))),
};
const COMMENT_LIMITS = { text: 3000, html: 40000, images: 6, videos: 3 };

function cleanCommentHtml(html) {
  let h = sanitizeHtml(embedVideos(String(html || "").slice(0, COMMENT_LIMITS.html * 3)), COMMENT_SANITIZE).trim();
  h = h.replace(/<a>([\s\S]*?)<\/a>/g, "$1").replace(/<p>\s*(<br\s*\/?>\s*)*<\/p>/g, "").replace(/(<br\s*\/?>\s*){3,}/g, "<br><br>");
  return htmlText(h) || /<(img|iframe)\b/.test(h) ? h : "";
}

// Yorum girdisi: yeni editör HTML gönderir (format "html"); eski istemcilerden düz metin gelebilir (format "text").
// Hata durumunda { error } döner; aksi halde kaydedilecek { body, format }.
function commentInput(raw, format) {
  if (format !== "html") {
    const body = String(raw || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
    if (body.length < 3) return { error: "Yorum çok kısa." };
    if (body.length > COMMENT_LIMITS.text) return { error: `Yorum en fazla ${COMMENT_LIMITS.text} karakter olabilir.` };
    return { body, format: "text" };
  }
  const html = cleanCommentHtml(raw);
  const text = htmlText(html).length;
  const images = (html.match(/<img\b/g) || []).length, videos = (html.match(/<iframe\b/g) || []).length;
  if (text < 3 && !images && !videos) return { error: "Yorum çok kısa." };
  if (text > COMMENT_LIMITS.text) return { error: `Yorum en fazla ${COMMENT_LIMITS.text} karakter olabilir.` };
  if (images > COMMENT_LIMITS.images) return { error: `Bir yoruma en fazla ${COMMENT_LIMITS.images} görsel eklenebilir.` };
  if (videos > COMMENT_LIMITS.videos) return { error: `Bir yoruma en fazla ${COMMENT_LIMITS.videos} video eklenebilir.` };
  if (html.length > COMMENT_LIMITS.html) return { error: "Yorum çok uzun." };
  return { body: html, format: "html" };
}

// Gösterim: HTML yorumlar her okumada yeniden temizlenir (kurallar sıkılaşırsa eski kayıtlar da uyar);
// eski düz metin yorumlar paragraflara bölünür.
const escText = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function commentHtml(body, format) {
  if (format === "html") return cleanCommentHtml(body);
  return String(body || "").split(/\n{2,}/).map((p) => "<p>" + escText(p).replace(/\n/g, "<br>") + "</p>").join("");
}

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
      case "int": {
        v = String(v).trim();
        if (v === "") { v = null; break; }
        if (!/^\d{1,6}$/.test(v) || +v < f.min || +v > f.max) { errors[f.key] = `${f.min} ile ${f.max} arasında bir tam sayı girin.`; continue; }
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

// Sürüm damgası (milisaniyeli son güncelleme): düzenleme ekranı açıkken kayıt başkası tarafından değiştirildiyse
// kaydetme reddedilir; böylece kimse farkında olmadan başkasının değişikliğinin üzerine yazmaz.
function itemVersion(kind, id) {
  const row = db.prepare("SELECT updated_at FROM items WHERE kind = ? AND id = ? AND deleted = 0").get(kind, id);
  return row ? row.updated_at : null;
}

// Haber metinlerinde "&lt;iframe…" olarak (düz yazı) kalmış gömme kodlarını güvenli oynatıcıya çevirir.
// Kayıt sahibi/güncelleyen bilgisi korunur; dönen dizi değiştirilen kayıtlardır ("topic:306").
function fixEmbedCodes() {
  const rows = db.prepare("SELECT kind, id, data FROM items WHERE deleted = 0 AND kind = 'topic' AND data LIKE '%&lt;iframe%'").all();
  const done = [];
  for (const r of rows) {
    const item = JSON.parse(r.data);
    const posts = (item.posts || []).map((p) => ({ ...p, html: /&lt;iframe/i.test(p.html || "") ? cleanHtml(p.html) : p.html }));
    if (posts.every((p, i) => p.html === item.posts[i].html)) continue;
    item.posts = posts;
    item.summary = htmlText(posts[0]?.html).slice(0, 260);
    db.prepare("UPDATE items SET data = ? WHERE kind = ? AND id = ?").run(JSON.stringify(item), r.kind, r.id);
    done.push(`${r.kind}:${r.id}`);
  }
  return done;
}

// Eski "Etkinlik / Sempozyum" bölümündeki kayıtları başlığa göre Sempozyum ve Koordinasyon'a ayırır (bir kez çalışır).
const foldTr = (s) => String(s || "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
function eventKind(title) {
  const t = foldTr(title);
  if (/koordinasyon|istisare|calistay|sivas toplantisi/.test(t)) return "koordinasyon";
  if (/sempoz|\bsemp\b|symposium|kongre/.test(t)) return "sempozyum";
  return "etkinlik";
}
function splitEventForums() {
  const done = [];
  for (const r of db.prepare("SELECT id, data FROM items WHERE kind = 'topic' AND json_extract(data, '$.forum') = 'etkinlik'").all()) {
    const item = JSON.parse(r.data), k = eventKind(item.title);
    if (k === "etkinlik") continue;
    item.forum = k;
    db.prepare("UPDATE items SET data = ? WHERE kind = 'topic' AND id = ?").run(JSON.stringify(item), r.id);
    done.push(`${r.id}→${k}`);
  }
  return done;
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

// createdBy yalnızca yeni kayıtta yazılır (kaydı ekleyen kişi; sahiplik kuralında kullanılır).
function saveItem(kind, id, item, userId, createdBy = userId) {
  if (id == null) id = nextId(kind);
  item.id = id;
  db.prepare(
    `INSERT INTO items (kind, id, data, updated_at, updated_by, created_by) VALUES (?, ?, ?, strftime('%Y-%m-%d %H:%M:%f', 'now'), ?, ?)
     ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, deleted = 0, updated_at = excluded.updated_at, updated_by = excluded.updated_by`
  ).run(kind, id, JSON.stringify(item), userId ?? null, createdBy ?? null);
  return item;
}

const foldName = (s) => String(s || "").replace(/İ/g, "i").replace(/I/g, "ı").toLocaleLowerCase("tr").replace(/ı/g, "i")
  .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

// Kullanıcı bu kaydın sahibi mi? Profil: hesaba bağlı akademisyen kaydı.
// Eser: kaydı kendisi eklemiş ya da bağlı olduğu akademisyen eserin yazarı.
function ownsItem(user, kind, id) {
  if (!user) return false;
  if (kind === "member") return user.member_id != null && user.member_id === id;
  if (kind !== "work") return false;
  const row = db.prepare("SELECT data, created_by FROM items WHERE kind = 'work' AND id = ? AND deleted = 0").get(id);
  if (!row) return false;
  if (row.created_by === user.id) return true;
  const me = user.member_id != null ? getItem("member", user.member_id) : null;
  if (!me) return false;
  const author = ` ${foldName(JSON.parse(row.data).author)} `, name = foldName(me.name);
  return name.length > 4 && author.includes(` ${name} `);
}

// Kullanıcının düzenleyebildiği kendi kayıtları (profil + eserler)
function ownItems(user) {
  const out = [];
  if (user.member_id != null) {
    const m = getItem("member", user.member_id);
    if (m) out.push({ kind: "member", id: m.id, title: m.name, sub: "Akademik profiliniz" });
  }
  const me = user.member_id != null ? getItem("member", user.member_id) : null;
  const name = me ? foldName(me.name) : null;
  for (const r of db.prepare("SELECT id, data, created_by FROM items WHERE kind = 'work' AND deleted = 0").all()) {
    const w = JSON.parse(r.data);
    const mine = r.created_by === user.id || (name && name.length > 4 && ` ${foldName(w.author)} `.includes(` ${name} `));
    if (mine) out.push({ kind: "work", id: r.id, title: w.title, sub: [w.author, w.year, w.type].filter(Boolean).join(" · "), added: r.created_by === user.id });
  }
  return out;
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
  CAT.adoptOrphans(); // kategorisi tanımlı olmayan haber kalmasın
  write("categories", CAT.exportData()); // kategoriler, kategori sayfaları ve menü
  write("pages", getItem("page", 1) || { welcome: "", policy: "" });
  write("settings", require("./site-settings").all()); // site üreteci için panel ayarları
  write("videos", require("./videos").load()); // ana sayfa video modülü
}

module.exports = {
  SCHEMAS, KINDS, RANKS, GROUPS, WORK_TYPES, ValidationError, normalize, cleanHtml, htmlText, commentInput, commentHtml, COMMENT_LIMITS,
  getItem, itemVersion, listItems, applyFields, parseVideo, videoFigure, fixEmbedCodes, splitEventForums, eventKind, saveItem, deleteItem, ownsItem, ownItems, formValues, exportAll, trDate, plain,
};
