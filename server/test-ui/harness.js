// Arayüz testleri için ortak düzenek: geçici veriyle sunucuyu açar, siteyi üretir, yönetici hesabı oluşturur
// ve sayfa / ekran ölçüsü listelerini sağlar. Hem responsive.test.js hem de denetim betiği (audit.js) kullanır.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mezhep-ui-"));
process.env.MZ_DATA_DIR = TMP;
process.env.PUBLIC_ORIGIN = "http://127.0.0.1";

const { createApp } = require("../src/index");
const { db, seedIfEmpty } = require("../src/db");
const A = require("../src/auth");
const C = require("../src/content");
const rebuild = require("../src/rebuild");
rebuild.schedule = () => {};

const ADMIN = { email: "ui@t.local", password: "ArayuzDeneme123" };

// Cihaz sınıfları (istenen aralıkların temsilcileri)
const VIEWPORTS = [
  { name: "telefon-kucuk", width: 320, height: 640, touch: true },
  { name: "telefon", width: 375, height: 812, touch: true },
  { name: "telefon-buyuk", width: 430, height: 932, touch: true },
  { name: "telefon-yatay", width: 740, height: 360, touch: true },
  { name: "tablet-dikey", width: 768, height: 1024, touch: true },
  { name: "tablet-yatay", width: 1024, height: 768, touch: true },
  { name: "dizustu", width: 1280, height: 800, touch: false },
  { name: "genis", width: 1920, height: 1080, touch: false },
];

let server, base;
async function start() {
  seedIfEmpty();
  db.prepare("INSERT INTO users (email, name, password_hash, role_key, status) VALUES (?, 'Arayüz Deneme', ?, 'super', 'active')")
    .run(ADMIN.email, A.hashPassword(ADMIN.password));
  await rebuild.run();
  if (!rebuild.state.ok) throw new Error("site üretilemedi:\n" + rebuild.state.log);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  return base;
}
function stop() {
  server && server.close();
  db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
}

// Denetlenen sayfalar: her sayfa türünden bir örnek (en uzun haber, özetli bir eser, fotoğraflı bir akademisyen…)
function pages() {
  const topics = C.listItems("topic"), works = C.listItems("work"), members = C.listItems("member"), albums = C.listItems("album");
  const longest = topics.slice().sort((a, b) => JSON.stringify(b.posts).length - JSON.stringify(a.posts).length)[0];
  const work = works.find((w) => w.ozet && w.abstract) || works[0];
  const member = members.find((m) => m.photo && m.bio) || members[0];
  const album = albums[0];
  return [
    { name: "ana-sayfa", url: "/index.html" },
    { name: "akademisyenler", url: "/akademisyenler.html" },
    { name: "akademisyen", url: `/akademisyen/${member.id}.html` },
    { name: "eserler", url: "/eserler.html" },
    { name: "eser", url: `/eser/${work.id}.html` },
    { name: "haberler", url: "/haberler.html" },
    { name: "haber", url: `/haber/${longest.id}.html` },
    { name: "etkinlikler", url: "/etkinlikler.html" },
    { name: "kategori", url: "/kategori/koordinasyon.html" },
    { name: "galeri", url: "/galeri.html" },
    { name: "album", url: `/galeri/${album.cid}-${album.sid}.html` },
    { name: "kaynaklar", url: "/kaynaklar.html" },
    { name: "hakkinda", url: "/hakkinda.html" },
    { name: "bulunamadi", url: "/olmayan-sayfa" },
  ];
}
const PANEL = [
  { name: "panel-ozet", url: "/panel/#/yonetim" },
  { name: "panel-haberler", url: "/panel/#/yonetim/icerik/topic" },
  { name: "panel-haber-duzenle", url: "/panel/#/yonetim/icerik/topic/265" },
  { name: "panel-haber-yeni", url: "/panel/#/yonetim/icerik/topic/yeni" },
  { name: "panel-kategoriler", url: "/panel/#/yonetim/kategoriler" },
  { name: "panel-kategori", url: "/panel/#/yonetim/kategoriler/koordinasyon" },
  { name: "panel-menu", url: "/panel/#/yonetim/kategoriler/menu" },
  { name: "panel-ayarlar", url: "/panel/#/yonetim/ayarlar" },
  { name: "panel-uyeler", url: "/panel/#/yonetim/uyeler" },
  { name: "panel-kayitlar", url: "/panel/#/yonetim/kayitlar" },
  { name: "panel-yapay-zeka", url: "/panel/#/yonetim/yapay-zeka" },
  { name: "panel-oneri", url: "/panel/#/oneri/topic" },
];

// Tarayıcıda çalışan ölçüm: yatay taşma, ekran dışına taşan öğeler, küçük dokunma hedefleri ve küçük yazılar.
function measure(touch) {
  const vw = document.documentElement.clientWidth;
  const vis = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0; };
  const label = (el) => (el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.classList.length ? "." + [...el.classList].slice(0, 2).join(".") : "")) +
    (el.textContent ? " «" + el.textContent.trim().replace(/\s+/g, " ").slice(0, 30) + "»" : "");
  // kaydırılabilir kutuların (tablo sarmalayıcı, sekme şeritleri) içindekiler sayılmaz
  const inScroller = (el) => { for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === "auto" || o === "scroll" || o === "hidden") return true; } return false; };
  const offscreen = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!vis(el) || inScroller(el)) continue;
    const s = getComputedStyle(el);
    if (s.position === "fixed" && (el.closest(".nav, .cmdk, .lightbox, .vid-modal, .ai-box, dialog") || s.opacity === "0")) continue;
    const r = el.getBoundingClientRect();
    if (r.right > vw + 1 || r.left < -1) offscreen.push(label(el) + ` [${Math.round(r.left)}…${Math.round(r.right)}]`);
  }
  const small = [];
  if (touch) {
    for (const el of document.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, [role=tab], summary")) {
      if (!vis(el) || el.closest(".prose, p, li, dd, .crumbs, .cmdk, nav.nav:not(.open), .footer-bottom") && el.tagName === "A") continue;
      const r = el.getBoundingClientRect();
      const t = el.type === "checkbox" || el.type === "radio" ? el.closest("label") || el : el;
      const tr = t.getBoundingClientRect();
      if (Math.min(tr.height, tr.width) < 40) small.push(label(el) + ` ${Math.round(tr.width)}×${Math.round(tr.height)}`);
    }
  }
  const tinyText = [];
  for (const el of document.body.querySelectorAll("*")) {
    if (!vis(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const fs = parseFloat(getComputedStyle(el).fontSize);
    if (fs < 12) tinyText.push(label(el) + " " + fs + "px");
  }
  const imgs = [...document.querySelectorAll("img")].filter((i) => !i.getAttribute("width") && !i.closest(".avatar")).length;
  return {
    scrollW: document.documentElement.scrollWidth, vw, overflow: document.documentElement.scrollWidth > vw + 1,
    offscreen: [...new Set(offscreen)].slice(0, 8), offscreenN: offscreen.length,
    small: [...new Set(small)].slice(0, 10), smallN: small.length, tinyText: [...new Set(tinyText)].slice(0, 6), tinyN: tinyText.length, imgsNoSize: imgs,
  };
}

async function login(context) {
  const r = await context.request.post(base + "/api/auth/login", { headers: { "x-mz": "1" }, data: ADMIN });
  if (!r.ok()) throw new Error("giriş başarısız " + r.status());
}

module.exports = { start, stop, pages, PANEL, VIEWPORTS, measure, login, ADMIN, TMP };
