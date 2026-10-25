// Panelden yönetilen site ayarları. Tanımlar, varsayılanlar ve doğrulama burada; değerler "settings" tablosunda.
// Site üreteci (scripts/build.py) ayarları dışa aktarılan settings.json'dan okur.
const { db } = require("./db");

db.exec(`CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by INTEGER
)`);

// perm: alanı değiştirmek için gereken yetki. public: tarayıcıya açık (asistan metinleri vb.).
const GROUPS = [
  { key: "genel", label: "Genel", perm: "site.ayar", fields: [
    { key: "site_name", label: "Site adı", type: "text", def: "Mezhep.Org", max: 60 },
    { key: "site_tagline", label: "Alt başlık (logonun yanında)", type: "text", def: "İslam Mezhepleri Tarihi", max: 80 },
    { key: "site_description", label: "Arama motorları için site açıklaması", type: "textarea", max: 300,
      def: "İlahiyat ve İslami İlimler Fakülteleri İslam Mezhepleri Tarihi Anabilim Dalı Koordinasyon Sitesi: akademisyenler, tezler, kitaplar, makaleler, haberler ve etkinlikler." },
    { key: "footer_about", label: "Alt bilgi tanıtım metni", type: "textarea", max: 300,
      def: "İlahiyat ve İslami İlimler Fakülteleri İslam Mezhepleri Tarihi Anabilim Dalı Koordinasyon Sitesi. 2006'dan beri alanın akademik hafızası." },
    { key: "footer_note", label: "Alt bilgi imza satırı", type: "text", def: "Ahmet İshak DEMİR adına", max: 120 },
    { key: "contact_person", label: "İletişim: yönetici", type: "text", def: "Prof. Dr. Ahmet İshak DEMİR", max: 120 },
    { key: "contact_institution", label: "İletişim: kurum", type: "text", def: "Recep Tayyip Erdoğan Üniversitesi İlahiyat Fakültesi", max: 160 },
    { key: "contact_email", label: "İletişim: e-posta (sitede görünür)", type: "email", def: "", max: 160 },
    { key: "facebook_url", label: "Facebook adresi", type: "url", def: "https://www.facebook.com/Mezhep.Org/", max: 300 },
    { key: "youtube_url", label: "YouTube kanalı adresi", type: "url", def: "https://www.youtube.com/@mezheporg", max: 300 },
    { key: "x_url", label: "X (Twitter) adresi", type: "url", def: "https://x.com/MezhepOrg", max: 300 },
  ] },
  { key: "duyuru", label: "Duyuru şeridi", perm: "site.ayar", fields: [
    { key: "banner_enabled", label: "Sitenin üstünde duyuru şeridi göster", type: "bool", def: false },
    { key: "banner_text", label: "Duyuru metni", type: "text", def: "", max: 220 },
    { key: "banner_link", label: "Bağlantı (isteğe bağlı)", type: "url", def: "", max: 300 },
    { key: "banner_style", label: "Görünüm", type: "select", def: "bilgi", options: ["bilgi", "uyari", "onemli"],
      labels: { bilgi: "Bilgi (lacivert)", uyari: "Uyarı (altın)", onemli: "Önemli (kırmızı)" } },
  ] },
  // Haber ve kategori bölümleri (Son haberler, Koordinasyon toplantıları…) Kategoriler ve menü ekranından yönetilir.
  { key: "anasayfa", label: "Ana sayfa", perm: "site.ayar", note: "Haber ve kategori bölümleri (Son haberler, Koordinasyon toplantıları vb.), kaç içerik gösterileceği ve sıraları Kategoriler ve menü ekranından yönetilir.", fields: [
    { key: "home_eyebrow", label: "Üst etiket", type: "text", def: "İslam Mezhepleri Tarihi Anabilim Dalı", max: 80 },
    { key: "home_title", label: "Başlık (vurgulanacak kısmı *yıldız* içine alın)", type: "text", def: "Mezhepler tarihi çalışmalarının *ortak hafızası*", max: 120 },
    { key: "home_lead", label: "Giriş metni", type: "textarea", max: 400,
      def: "Türkiye'deki İlahiyat ve İslami İlimler fakültelerinin İslam Mezhepleri Tarihi akademisyenlerini, tezlerini, kitaplarını ve makalelerini tek çatı altında, özetleriyle birlikte derliyoruz." },
    { key: "home_quote", label: "Alıntı", type: "textarea", def: "Gelişmesi ve zenginleşmesi için İslam Mezhepleri ile ilgilenen herkesin katkılarını bekliyoruz.", max: 300 },
    { key: "home_quote_sign", label: "Alıntı imzası", type: "text", def: "Ahmet İshak DEMİR", max: 120 },
    { key: "home_show_youtube", label: "YouTube kanalı bölümünü göster", type: "bool", def: true },
    { key: "home_show_videos", label: "Video modülünü göster (Prof. Dr. Ahmet İshak Demir videoları)", type: "bool", def: false },
    { key: "videos_eyebrow", label: "Video modülü: üst etiket", type: "text", def: "Prof. Dr. Ahmet İshak Demir", max: 80 },
    { key: "videos_title", label: "Video modülü: başlık", type: "text", def: "Konuşmalar ve videolar", max: 100 },
    { key: "videos_playlists", label: "Video modülü: YouTube oynatma listesi kimlikleri (her satıra bir tane, PL… ile başlar; 6 saatte bir güncellenir)", type: "lines", max: 4,
      pattern: /^PL[\w-]{10,40}$/, patternMsg: "Her satır PL ile başlayan bir YouTube oynatma listesi kimliği olmalı.",
      def: ["PL2dGbrxqbayq3xI8tzCdfaF2SmIYw-sut", "PL2dGbrxqbayr22qpI3k0MAjPYjHV6NRHX"] },
    { key: "videos_more_url", label: "Video modülü: \"Tüm videolar\" bağlantısı", type: "url", def: "https://www.ahmetishak.com/galeri/videolar/", max: 300 },
    { key: "videos_channel_url", label: "Video modülü: abone olunacak kanal", type: "url", def: "https://www.youtube.com/@mezheporg", max: 300 },
    { key: "home_show_works", label: "Öne çıkan eserler bölümünü göster", type: "bool", def: true },
    { key: "home_show_members", label: "Yeni eklenen akademisyenler bölümünü göster", type: "bool", def: true },
  ] },
  { key: "galeri", label: "Galeri", perm: "site.ayar", fields: [
    { key: "gallery_show_videos", label: "Galeride Videolar sekmesini göster", type: "bool", def: true },
    { key: "gallery_channel", label: "Videoların alınacağı YouTube kanal kimliği (UC… ile başlar; 6 saatte bir güncellenir)", type: "text", max: 40,
      pattern: /^UC[\w-]{22}$/, patternMsg: "Kanal kimliği UC ile başlayan 24 karakter olmalı (YouTube kanal sayfası → Paylaş → Kanal kimliğini kopyala).",
      def: "UCGFN07whsFRvjvB7TzK-bKg" },
  ] },
  { key: "uyelik", label: "Üyelik ve katkılar", perm: "site.ayar", public: true, fields: [
    { key: "registration_open", label: "Yeni üye kaydı açık", type: "bool", def: true },
    { key: "submissions_open", label: "Üyeler eser, haber ve profil önerisi gönderebilir", type: "bool", def: true },
    { key: "comments_enabled", label: "Yorumlar açık", type: "bool", def: true },
    { key: "comments_require_approval", label: "Yorumlar yönetici onayından sonra yayınlansın", type: "bool", def: true },
  ] },
  { key: "asistan", label: "Asistanlar", perm: "ai.ayar", public: true, fields: [
    { key: "ai_enabled", label: "Akaid Asistanı açık", type: "bool", def: true },
    { key: "ai_welcome", label: "Karşılama metni", type: "textarea", max: 600,
      def: "Selâmün aleyküm! Ehl-i Sünnet (Mâtürîdî ve Eş'arî) itikadına dair sorularınızı arşivdeki kaynaklara dayanarak yanıtlıyorum." },
    { key: "ai_suggestions", label: "Önerilen sorular (her satıra bir soru)", type: "lines", max: 6,
      def: ["Hudûs delili nedir?", "Mâtürîdî ile Eş'arî arasındaki farklar nelerdir?", "Kesb nazariyesi nedir?", "Allah'ın varlığının delilleri nelerdir?"] },
    { key: "ai_hanefi_enabled", label: "Hanefî Fıkhı Asistanı açık", type: "bool", def: true },
    { key: "ai_hanefi_welcome", label: "Hanefî asistanı karşılama metni", type: "textarea", max: 600,
      def: "Hoş geldiniz. Sorularınızı hangi üslupla cevaplamamı istersiniz?" },
    { key: "ai_hanefi_suggestions", label: "Hanefî asistanı önerilen sorular (her satıra bir soru)", type: "lines", max: 6,
      def: ["Mest üzerine mesh süresi ne kadardır?", "Abdesti bozan şeyler nelerdir?", "Kadın ziynet altınına zekât düşer mi?", "Yolculukta namaz nasıl kısaltılır?"] },
    { key: "ai_daily_requests", label: "Kişi başı günlük soru sınırı (boş: sunucu varsayılanı)", type: "number", def: null, min: 0, max: 1000, optional: true },
    { key: "ai_monthly_budget", label: "Aylık bütçe tavanı, USD (boş: sunucu varsayılanı)", type: "number", def: null, min: 0, max: 10000, step: 0.5, optional: true },
  ] },
];
const FIELDS = Object.fromEntries(GROUPS.flatMap((g) => g.fields.map((f) => [f.key, { ...f, group: g.key, perm: g.perm, public: !!g.public }])));

let cache = null;
function all() {
  if (cache) return cache;
  const stored = Object.fromEntries(db.prepare("SELECT key, value FROM settings").all().map((r) => [r.key, JSON.parse(r.value)]));
  cache = Object.fromEntries(Object.entries(FIELDS).map(([k, f]) => [k, k in stored ? stored[k] : f.def]));
  return cache;
}
const get = (key) => all()[key];

class SettingsError extends Error { constructor(fields) { super("Lütfen işaretli alanları düzeltin."); this.fields = fields; } }

function clean(f, v) {
  switch (f.type) {
    case "bool": return v === true || v === "true" || v === 1 || v === "1";
    case "number": {
      if ((v === "" || v == null) && f.optional) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < f.min || n > f.max) throw `${f.min} ile ${f.max} arasında bir sayı girin.`;
      return f.step ? Math.round(n / f.step) * f.step : Math.round(n);
    }
    case "select": if (!f.options.includes(v)) throw "Listeden bir seçenek seçin."; return v;
    case "lines": {
      const arr = (Array.isArray(v) ? v : String(v || "").split("\n")).map((s) => String(s).replace(/\s+/g, " ").trim()).filter(Boolean);
      if (arr.length > f.max) throw `En fazla ${f.max} satır girin.`;
      if (arr.some((s) => s.length > 140)) throw "Her satır en fazla 140 karakter olabilir.";
      if (f.pattern && arr.some((s) => !f.pattern.test(s))) throw f.patternMsg;
      return arr;
    }
    default: {
      const s = String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim();
      if (f.max && s.length > f.max) throw `En fazla ${f.max} karakter olabilir.`;
      if (f.type === "url" && s && !/^https?:\/\/[^\s"'<>]+\.[^\s"'<>]+$/i.test(s)) throw "Adres http:// ya da https:// ile başlamalı.";
      if (f.type === "email" && s && !/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(s)) throw "Geçerli bir e-posta girin.";
      if (f.pattern && s && !f.pattern.test(s)) throw f.patternMsg;
      return f.type === "textarea" ? s : s.replace(/\s+/g, " ");
    }
  }
}

// Yalnızca kullanıcının yetkisi olan gruplardaki alanlar kaydedilir; diğerleri yok sayılmaz, hata verir.
function save(values, user, canPerm) {
  const errors = {}, changes = {};
  for (const [k, v] of Object.entries(values || {})) {
    const f = FIELDS[k];
    if (!f) continue;
    if (!canPerm(f.perm)) { errors[k] = "Bu ayarı değiştirme yetkiniz yok."; continue; }
    try { changes[k] = clean(f, v); } catch (msg) { errors[k] = String(msg); }
  }
  if (Object.keys(errors).length) throw new SettingsError(errors);
  const up = db.prepare(`INSERT INTO settings (key, value, updated_by) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now'), updated_by = excluded.updated_by`);
  for (const [k, v] of Object.entries(changes)) up.run(k, JSON.stringify(v), user?.id ?? null);
  cache = null;
  return changes;
}

const publicValues = () => Object.fromEntries(Object.entries(all()).filter(([k]) => FIELDS[k].public && !/^ai_(daily|monthly)/.test(k)));

module.exports = { GROUPS, FIELDS, all, get, save, publicValues, SettingsError };
