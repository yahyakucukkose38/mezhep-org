// Tam kontrol: site haritasındaki bütün sayfalar ve panelin bütün ekranları, telefon ve tablet profillerinde.
// Her sayfa masaüstü (1280 px) hâliyle karşılaştırılır: telefonda/tablette eksik metin, düğme, bağlantı ya da görsel
// var mı; sayfa hatası (4xx/5xx), betik hatası, yüklenemeyen dosya ve yatay taşma var mı.
// Kullanım: node test-ui/full-check.js <çıktı klasörü>
const fs = require("node:fs");
const path = require("node:path");
const pw = require("playwright");
const H = require("./harness");
const cfg = require("../src/config");

const OUT = process.argv[2] || path.join(H.TMP, "tam-kontrol");
fs.mkdirSync(OUT, { recursive: true });
const PROFILES = [
  { name: "iPhone (WebKit 390)", engine: "webkit", width: 390, height: 844, touch: true },
  { name: "Android telefon (Chromium 360)", engine: "chromium", width: 360, height: 780, touch: true },
  { name: "iPad (WebKit 820)", engine: "webkit", width: 820, height: 1180, touch: true },
  { name: "Android tablet (Chromium 1024)", engine: "chromium", width: 1024, height: 768, touch: true },
];
const DESKTOP = { name: "masaüstü", engine: "chromium", width: 1280, height: 800, touch: false };
const PARALLEL = 4;

// Sayfanın ana içeriği ve alt bilgisi: görünür metin, düğme/bağlantılar ve görseller (menü, arama penceresi gibi
// cihaza göre bilerek farklılaşan parçalar hariç).
function snapshot() {
  const vis = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const s = getComputedStyle(e); if (s.display === "none" || s.visibility === "hidden") return false; }
    const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1;
  };
  const scope = [document.querySelector("#main, #panel-main"), document.querySelector(".site-footer")].filter(Boolean);
  const words = scope.map((s) => s.innerText).join(" ").replace(/\s+/g, " ").trim();
  const label = (e) => (e.getAttribute("aria-label") || e.innerText || e.value || e.getAttribute("placeholder") || "").replace(/\s+/g, " ").trim().slice(0, 50);
  const ctrls = scope.flatMap((s) => [...s.querySelectorAll("a[href], button, input:not([type=hidden]), select, textarea, summary")])
    .filter((e) => !e.closest(".card-edit, [data-own], .lightbox, dialog")).filter(vis)
    .map((e) => e.tagName.toLowerCase() + "|" + label(e) + "|" + (e.getAttribute("href") || "").replace(/^(\.\.\/)+/, "").replace(/^\//, ""));
  const imgs = scope.flatMap((s) => [...s.querySelectorAll("img")]).filter(vis);
  return {
    title: document.title, textLen: words.length, words: [...new Set(words.toLocaleLowerCase("tr").split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 3))],
    ctrls, imgs: imgs.length, broken: imgs.filter((i) => i.complete && i.naturalWidth === 0).map((i) => i.getAttribute("src")),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  };
}

async function visit(page, url, isPanel) {
  const errs = [], failed = [];
  const onErr = (e) => errs.push(e.message.slice(0, 160));
  const onFail = (r) => { if (!/fonts\.(googleapis|gstatic)|youtube|ytimg|vimeo/.test(r.url())) failed.push(r.url().replace(/^https?:\/\/[^/]+/, "")); };
  const onResp = (r) => { if (r.status() >= 400 && !/fonts\.|youtube|ytimg|vimeo/.test(r.url()) && r.request().resourceType() !== "document") failed.push(r.status() + " " + r.url().replace(/^https?:\/\/[^/]+/, "")); };
  page.on("pageerror", onErr); page.on("requestfailed", onFail); page.on("response", onResp);
  let status = 0;
  try {
    const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 45000 });
    status = resp ? resp.status() : 0;
    if (isPanel) await page.waitForSelector("#panel-main h1, #panel-main .page-title", { timeout: 10000 }).catch(() => {});
    await page.evaluate(() => { document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in")); document.querySelectorAll("img[loading=lazy]").forEach((i) => (i.loading = "eager")); });
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(isPanel ? 400 : 120);
    const snap = await page.evaluate(snapshot);
    return { status, errs, failed, ...snap };
  } catch (e) {
    return { status, errs: [...errs, "yüklenemedi: " + e.message.split("\n")[0]], failed, textLen: 0, words: [], ctrls: [], imgs: 0, broken: [], overflow: false };
  } finally {
    page.off("pageerror", onErr); page.off("requestfailed", onFail); page.off("response", onResp);
  }
}

async function runProfile(browsers, prof, urls, session) {
  const ctx = await browsers[prof.engine].newContext({
    viewport: { width: prof.width, height: prof.height }, hasTouch: prof.touch, ...(prof.engine !== "firefox" ? { isMobile: prof.touch } : {}), storageState: session,
  });
  const out = {};
  let i = 0;
  await Promise.all(Array.from({ length: PARALLEL }, async () => {
    const page = await ctx.newPage();
    while (i < urls.length) {
      const u = urls[i++];
      out[u] = await visit(page, u, u.includes("/panel/"));
    }
    await page.close();
  }));
  await ctx.close();
  return out;
}

(async () => {
  const base = await H.start();
  const sitemap = fs.readFileSync(path.join(cfg.SITE_DIR, "sitemap.xml"), "utf8");
  const pages = [...sitemap.matchAll(/<loc>https:\/\/mezhep\.net\/([^<]*)<\/loc>/g)].map((m) => "/" + decodeURIComponent(m[1]));
  // panelin bütün ekranları (yönetici, akademisyen ve üye ekranları)
  const C = require("../src/content");
  const t = C.listItems("topic")[0].id, w = C.listItems("work")[0].id, m = C.listItems("member")[0].id;
  const panel = ["#/", "#/hesap", "#/sifre", "#/gonderilerim", "#/profil", "#/eserlerim", "#/oneri/work", "#/oneri/topic", "#/oneri/member", `#/sahiplen/${m}`,
    "#/yonetim", "#/yonetim/onaylar", "#/yonetim/onaylar/approved", "#/yonetim/onaylar/rejected", "#/yonetim/uyeler", "#/yonetim/uyeler/pending", "#/yonetim/uyeler/yetkili",
    "#/yonetim/roller", "#/yonetim/yorumlar", "#/yonetim/yorumlar/visible", "#/yonetim/icerik/member", "#/yonetim/icerik/work", "#/yonetim/icerik/topic",
    `#/yonetim/icerik/member/${m}`, `#/yonetim/icerik/work/${w}`, `#/yonetim/icerik/topic/${t}`, "#/yonetim/icerik/topic/yeni", "#/yonetim/icerik/work/yeni",
    "#/yonetim/icerik/topic?kat=koordinasyon", "#/yonetim/kategoriler", "#/yonetim/kategoriler/koordinasyon", "#/yonetim/kategoriler/yeni", "#/yonetim/kategoriler/menu",
    "#/yonetim/cop", "#/yonetim/ayarlar/genel", "#/yonetim/ayarlar/duyuru", "#/yonetim/ayarlar/anasayfa", "#/yonetim/ayarlar/galeri", "#/yonetim/ayarlar/uyelik",
    "#/yonetim/ayarlar/asistan", "#/yonetim/kayitlar", "#/yonetim/paylasimlar", "#/yonetim/paylasimlar/365", "#/yonetim/site", "#/yonetim/yapay-zeka"].map((h) => "/panel/" + h);
  const urls = [...pages, ...panel].map((u) => base + u);
  console.log(`${pages.length} site sayfası + ${panel.length} panel ekranı, ${PROFILES.length} cihaz profili + masaüstü karşılaştırması`);

  const browsers = { chromium: await pw.chromium.launch(), webkit: await pw.webkit.launch() };
  const c0 = await browsers.chromium.newContext(); await H.login(c0); const session = await c0.storageState(); await c0.close();
  const t0 = Date.now();
  const desk = await runProfile(browsers, DESKTOP, urls, session);
  console.log(`masaüstü tamam (${Math.round((Date.now() - t0) / 1000)} sn)`);
  const report = { pages: pages.length, panel: panel.length, profiles: {} };
  for (const prof of PROFILES) {
    const t1 = Date.now();
    const res = await runProfile(browsers, prof, urls, session);
    const problems = [];
    for (const u of urls) {
      const d = desk[u], r = res[u], short = u.replace(base, "");
      if (r.status >= 400 || r.status === 0) problems.push({ u: short, tur: "sayfa açılmadı", ayrinti: String(r.status) });
      if (r.errs.length) problems.push({ u: short, tur: "betik hatası", ayrinti: r.errs.join(" | ") });
      if (r.failed.length) problems.push({ u: short, tur: "yüklenemeyen dosya", ayrinti: [...new Set(r.failed)].slice(0, 4).join(" | ") });
      if (r.broken.length) problems.push({ u: short, tur: "kırık görsel", ayrinti: r.broken.slice(0, 3).join(" | ") });
      if (r.overflow) problems.push({ u: short, tur: "yatay taşma", ayrinti: "" });
      // masaüstüne göre eksikler
      const cnt = (a) => a.reduce((o, k) => ((o[k] = (o[k] || 0) + 1), o), {});
      const cd = cnt(d.ctrls), cr = cnt(r.ctrls);
      const missingCtrl = Object.keys(cd).filter((k) => (cr[k] || 0) < cd[k]);
      if (missingCtrl.length) problems.push({ u: short, tur: "eksik düğme/bağlantı", ayrinti: missingCtrl.slice(0, 5).join(" ; ") });
      const rw = new Set(r.words), missingWords = d.words.filter((x) => !rw.has(x));
      if (missingWords.length > 2 || r.textLen < d.textLen * 0.97) problems.push({ u: short, tur: "eksik metin", ayrinti: `${r.textLen}/${d.textLen} karakter; eksik: ${missingWords.slice(0, 8).join(", ")}` });
      if (r.imgs < d.imgs) problems.push({ u: short, tur: "eksik görsel", ayrinti: `${r.imgs}/${d.imgs}` });
    }
    report.profiles[prof.name] = { seconds: Math.round((Date.now() - t1) / 1000), checked: urls.length, problems };
    console.log(`${prof.name}: ${urls.length} sayfa · sorun ${problems.length} (${Math.round((Date.now() - t1) / 1000)} sn)`);
    const byType = problems.reduce((o, p) => ((o[p.tur] = (o[p.tur] || 0) + 1), o), {});
    if (problems.length) console.log("   ", JSON.stringify(byType));
  }
  const deskProblems = urls.filter((u) => desk[u].errs.length || desk[u].status >= 400 || desk[u].broken.length).map((u) => u.replace(base, ""));
  report.desktopProblems = deskProblems;
  fs.writeFileSync(path.join(OUT, "tam-kontrol.json"), JSON.stringify(report, null, 1));
  console.log(`masaüstünde de sorunlu sayfa: ${deskProblems.length}`);
  for (const b of Object.values(browsers)) await b.close();
  H.stop();
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
