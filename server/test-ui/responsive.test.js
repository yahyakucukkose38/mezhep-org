// Responsive arayüz testleri (Playwright): Chromium, Firefox ve WebKit (Safari motoru); telefon, tablet, dizüstü ve geniş ekran.
// Çalıştırma: npm run test:ui   (MZ_UI_SHOTS=<klasör> verilirse her cihazda ekran görüntüsü kaydedilir)
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const pw = require("playwright");
const H = require("./harness");

const SHOTS = process.env.MZ_UI_SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
// Firefox ve WebKit'te temsilî ölçüler; Chromium'da bütün aralıklar
const ENGINES = { chromium: H.VIEWPORTS, firefox: H.VIEWPORTS.filter((v) => [320, 768, 1024, 1920].includes(v.width)), webkit: H.VIEWPORTS.filter((v) => [375, 768, 1024, 1280].includes(v.width)) };
// Gerçek cihaz profilleri (kullanıcı aracısı, piksel yoğunluğu, dokunmatik)
const DEVICES = [["webkit", "iPhone 14"], ["webkit", "iPhone SE"], ["webkit", "iPad Mini"], ["webkit", "iPad Mini landscape"], ["chromium", "Pixel 7"], ["chromium", "Galaxy Tab S4"]];

let base, session;
const browsers = {};
test.before(async () => {
  base = await H.start();
  for (const e of Object.keys(ENGINES)) browsers[e] = await pw[e].launch();
  // tek oturum açılır ve bütün tarayıcılarda paylaşılır (giriş denemesi sınırına takılmamak için)
  const c = await browsers.chromium.newContext();
  await H.login(c);
  session = await c.storageState();
  await c.close();
});
test.after(async () => {
  for (const b of Object.values(browsers)) await b.close();
  H.stop();
});

async function context(engine, vp, opts = {}) {
  const device = opts.device ? { ...opts.device } : { viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch && engine !== "firefox" };
  if (engine === "firefox") delete device.isMobile;
  return browsers[engine].newContext({ ...device, ...(opts.login !== false ? { storageState: session } : {}) });
}
async function open(page, url) {
  await page.goto(base + url, { waitUntil: "networkidle" });
  if (url.includes("/panel/")) await page.waitForSelector("#panel-main h1, #panel-main .page-title", { timeout: 8000 });
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in")));
}
const safe = (s) => s.replace(/[^\w-]+/g, "_");

// ---------------------------------------------------------------- taşma ve hata
for (const [engine, vps] of Object.entries(ENGINES)) {
  test(`${engine}: hiçbir sayfada yatay kaydırma, ekran dışına taşan öğe ya da betik hatası yok (${vps.map((v) => v.width).join(", ")} px)`, async () => {
    const problems = [];
    for (const vp of vps) {
      const ctx = await context(engine, vp);
      const page = await ctx.newPage();
      const errs = [];
      page.on("pageerror", (e) => errs.push(e.message));
      for (const pg of [...H.pages(), ...H.PANEL]) {
        errs.length = 0;
        await open(page, pg.url);
        const m = await page.evaluate(H.measure, false);
        if (m.overflow || m.offscreenN) problems.push(`${pg.name} @${vp.width}: ${m.scrollW}/${m.vw} ${m.offscreen.slice(0, 2).join(" | ")}`);
        if (errs.length) problems.push(`${pg.name} @${vp.width}: JS ${errs.join("; ")}`);
        if (SHOTS && ["ana-sayfa", "haber", "kategori", "haberler", "panel-haber-duzenle", "panel-kategoriler", "panel-kayitlar"].includes(pg.name)) {
          await page.screenshot({ path: path.join(SHOTS, `${engine}--${vp.name}--${pg.name}.png`) });
        }
      }
      await ctx.close();
    }
    assert.deepEqual(problems, []);
  });
}

// ---------------------------------------------------------------- gerçek cihaz profilleri
test("cihaz profilleri (iPhone, iPad, Pixel, Galaxy Tab): ana sayfa, haber, kategori ve panel taşmasız; menü çalışır", async () => {
  const problems = [];
  for (const [engine, name] of DEVICES) {
    const ctx = await context(engine, null, { device: pw.devices[name] });
    const page = await ctx.newPage();
    for (const url of ["/index.html", H.pages().find((p) => p.name === "haber").url, "/kategori/koordinasyon.html", "/panel/#/yonetim/icerik/topic"]) {
      await open(page, url);
      const m = await page.evaluate(H.measure, false);
      if (m.overflow) problems.push(`${name} ${url}: ${m.scrollW}/${m.vw}`);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `cihaz--${safe(name)}--${safe(url.split("/").pop() || "panel")}.png`) });
      const btn = await page.$(url.includes("/panel/") ? ".panel-menu-btn" : ".menu-btn");
      if (btn && await btn.isVisible()) {
        await btn.tap();
        const opened = await page.waitForFunction(() => document.body.classList.contains("menu-open") || document.body.classList.contains("side-open"), null, { timeout: 2000 }).catch(() => null);
        if (!opened) problems.push(`${name} ${url}: menü açılmadı`);
        await page.keyboard.press("Escape");
      }
    }
    await ctx.close();
  }
  assert.deepEqual(problems, []);
});

// ---------------------------------------------------------------- mobil menü
for (const engine of Object.keys(ENGINES)) {
  test(`${engine}: telefonda menü açılır, arka plan kilitlenir, odak menüde kalır; Esc, dışarı dokunma ve bağlantı kapatır`, async () => {
    const ctx = await context(engine, H.VIEWPORTS[1], { login: false });
    const page = await ctx.newPage();
    await open(page, "/haberler.html");
    const btn = page.locator(".menu-btn");
    await btn.click();
    await page.waitForTimeout(300);
    let st = await page.evaluate(() => ({ open: document.body.classList.contains("menu-open"), lock: getComputedStyle(document.documentElement).overflow, exp: document.querySelector(".menu-btn").getAttribute("aria-expanded"),
      focus: !!document.activeElement.closest(".nav"), vis: getComputedStyle(document.querySelector(".nav")).visibility }));
    assert.deepEqual(st, { open: true, lock: "hidden", exp: "true", focus: true, vis: "visible" });
    // Tab menünün sonundan menü düğmesine döner (odak menü dışına kaçmaz)
    const n = await page.locator(".nav a").count();
    for (let i = 0; i < n + 1; i++) await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(() => !!document.activeElement.closest(".nav, .menu-btn")), "odak menüde kalır");
    await page.keyboard.press("Escape");
    st = await page.evaluate(() => ({ open: document.body.classList.contains("menu-open"), focusBtn: document.activeElement.classList.contains("menu-btn"), vis: getComputedStyle(document.querySelector(".nav")).visibility }));
    assert.equal(st.open, false); assert.equal(st.focusBtn, true);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector(".nav")).visibility), "hidden", "kapalı menü klavyeyle odaklanmaz");
    // dışarı dokununca kapanır
    await btn.click(); await page.waitForTimeout(250);
    await page.mouse.click(10, 760);
    assert.equal(await page.evaluate(() => document.body.classList.contains("menu-open")), false);
    // alt kategori bağlantısı görünür ve doğru sayfayı açar
    await btn.click(); await page.waitForTimeout(250);
    await page.locator('.nav-sub a[href$="kategori/koordinasyon.html"]').click();
    await page.waitForURL(/kategori\/koordinasyon\.html$/);
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).overflow), "visible", "yeni sayfada kilit kalmaz");
    await ctx.close();
  });
}

test("masaüstü: alt menü düğmeyle açılır, Esc ile kapanır; tablet yatayda aynı menü alt alta görünür", async () => {
  const ctx = await context("chromium", H.VIEWPORTS[6], { login: false });
  const page = await ctx.newPage();
  await open(page, "/index.html");
  await page.locator(".nav-sub-btn").click();
  // açılış 0,18 sn'lik yumuşak geçişle olur
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".nav-sub")).visibility === "visible", null, { timeout: 2000 });
  assert.equal(await page.locator(".nav-sub-btn").getAttribute("aria-expanded"), "true");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".nav-sub-btn").getAttribute("aria-expanded"), "false");
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.locator(".menu-btn").click(); await page.waitForTimeout(300);
  assert.ok(await page.locator('.nav-sub a[href$="kategori/sempozyumlar.html"]').isVisible(), "tablette alt kategori görünür");
  await ctx.close();
});

// ---------------------------------------------------------------- dokunma hedefleri
test("dokunmatik ekranlarda başlık düğmeleri, filtreler, form alanları ve panel düğmeleri en az 44 px", async () => {
  const small = [];
  for (const vp of [H.VIEWPORTS[0], H.VIEWPORTS[4]]) {
    const ctx = await context("chromium", vp);
    const page = await ctx.newPage();
    for (const [url, sel] of [["/eserler.html", ".header-actions .icon-btn, .search-trigger, .acc-btn, .chip, .toolbar .select, .toolbar .input"],
      ["/panel/#/yonetim/icerik/topic/265", ".panel-menu-btn, .field input[type=text], .field select, .editor-bar button, .form-actions .btn"],
      ["/panel/#/yonetim/kategoriler/koordinasyon", ".check, .field select, .form-actions .btn"]]) {
      await open(page, url);
      for (const r of await page.$$eval(sel, (els) => els.filter((e) => e.offsetParent).map((e) => { const b = e.getBoundingClientRect(); return [e.className || e.tagName, Math.round(b.width), Math.round(b.height)]; }))) {
        if (Math.min(r[1], r[2]) < 44) small.push(`${url} @${vp.width}: ${r.join(" ")}`);
      }
    }
    await ctx.close();
  }
  assert.deepEqual(small, []);
});

// ---------------------------------------------------------------- panel çekmecesi ve telefondan yayın
test("telefonda panel: menü çekmecesi açılır/kapanır; tablolar kart olur; haber telefondan yayımlanır ve kategorisinde listelenir", async () => {
  const ctx = await context("webkit", H.VIEWPORTS[1]);
  const page = await ctx.newPage();
  await open(page, "/panel/#/yonetim/kayitlar");
  assert.equal(await page.locator(".panel-nav").evaluate((el) => getComputedStyle(el).visibility), "hidden");
  await page.locator(".panel-menu-btn").tap();
  await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => document.body.classList.contains("side-open") && getComputedStyle(document.documentElement).overflow === "hidden"));
  await page.locator('.panel-nav a[href="#/yonetim/icerik/topic"]').tap();
  await page.waitForSelector("text=Haber ve etkinlikler");
  assert.equal(await page.evaluate(() => document.body.classList.contains("side-open")), false, "bağlantı seçilince kapanır");
  // tablo kartları: her hücrede sütun adı
  await open(page, "/panel/#/yonetim/kayitlar");
  await page.waitForSelector(".p-table td[data-label]");
  assert.equal(await page.locator(".p-table thead").evaluate((el) => getComputedStyle(el).display), "none");

  // telefondan yeni haber: başlık, kategori, metin → kaydet
  await open(page, "/panel/#/yonetim/icerik/topic/yeni");
  await page.waitForSelector('[name="title"]');
  await page.locator('[name="title"]').fill("Telefondan eklenen koordinasyon duyurusu");
  await page.locator('[name="forum"]').selectOption("koordinasyon");
  await page.locator(".editor-area").tap();
  await page.keyboard.type("Telefondan yazılan duyuru metni.");
  await page.locator('button[type="submit"]').tap();
  await page.waitForURL(/icerik\/topic\/\d+$/);
  const id = +page.url().match(/(\d+)$/)[1];
  const C = require("../src/content");
  const t = C.getItem("topic", id);
  assert.equal(t.forum, "koordinasyon");
  assert.match(t.posts[0].html, /Telefondan yazılan duyuru metni/);
  // site yeniden üretilince kategori sayfasının başında
  const rebuild = require("../src/rebuild");
  await rebuild.run();
  await open(page, "/kategori/koordinasyon.html");
  assert.match(await page.locator("[data-list] .news-card h3").first().textContent(), /Telefondan eklenen/);
  await ctx.close();
});

// ---------------------------------------------------------------- kategori ve liste içerikleri eksiksiz
test("telefonda bütün içeriklere erişilir: Haberler'de 'Daha fazla göster' ile 212+ haber, kategori sayfasında tüm içerik, filtre ve sıralama birlikte çalışır", async () => {
  const ctx = await context("chromium", H.VIEWPORTS[0], { login: false });
  const page = await ctx.newPage();
  await open(page, "/haberler.html");
  const total = await page.evaluate(() => JSON.parse(document.getElementById("page-data").textContent).length);
  for (let i = 0; i < 40 && await page.locator("[data-more]").isVisible(); i++) await page.locator("[data-more]").click();
  assert.equal(await page.locator("[data-more]").isVisible(), false, "hepsi yüklenince düğme gizlenir");
  assert.equal(await page.locator("[data-list] .news-card").count(), total);
  await open(page, "/kategori/koordinasyon.html");
  const n = await page.evaluate(() => JSON.parse(document.getElementById("page-data").textContent).length);
  assert.equal(await page.locator("[data-list] .news-card").count(), n);
  await page.locator("[data-sort]").selectOption("old");
  await page.locator("[data-filter-select=year]").selectOption("2014");
  const titles = await page.locator("[data-list] .news-card h3").allTextContents();
  assert.ok(titles.length >= 1 && titles.every((x) => /2014|Sivas/i.test(x)), titles.join(" | "));
  await ctx.close();
});

test("paylaşım çubuğu: yalnızca simge, tek satır, eş boy; fareyle bilgi balonu; dokunmatikte 44 px, sayfa kaymaz", async () => {
  const LABELS = ["Diğer uygulamalarla paylaş", "WhatsApp'ta Paylaş", "Facebook'ta Paylaş", "X'te Paylaş", "Telegram'da Paylaş", "LinkedIn'de Paylaş", "E-posta ile Paylaş", "Bağlantıyı Kopyala"];
  const cases = [["chromium", { width: 1280, height: 800, touch: false }], ["chromium", { width: 1024, height: 768, touch: false }], ["firefox", { width: 1024, height: 768, touch: false }],
    ["webkit", { width: 768, height: 1024, touch: true }], ["chromium", { width: 375, height: 812, touch: true }], ["webkit", { width: 320, height: 640, touch: true }]];
  for (const [engine, vp] of cases) {
    const ctx = await context(engine, vp, { login: false });
    await ctx.addInitScript(() => { navigator.share = () => Promise.resolve(); }); // "genel paylaş" düğmesi görünsün
    const page = await ctx.newPage();
    await open(page, "/haber/265.html");
    const m = await page.locator(".share").first().evaluate((box) => {
      const bs = [...box.querySelectorAll(".share-btn")].filter((b) => b.offsetParent);
      return { n: bs.length, text: bs.map((b) => b.textContent.trim()).join(""), labels: bs.map((b) => b.getAttribute("aria-label")),
        rows: new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size, sizes: [...new Set(bs.map((b) => b.offsetWidth + "x" + b.offsetHeight))],
        gaps: [...new Set(bs.slice(1).map((b, i) => Math.round(b.getBoundingClientRect().left - bs[i].getBoundingClientRect().right)))],
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    const tag = `${engine} ${vp.width}px`;
    assert.equal(m.n, 8, tag);
    assert.equal(m.text, "", tag + ": görünen yazı yok");
    assert.deepEqual(m.labels, LABELS, tag);
    assert.equal(m.rows, 1, tag + ": tek satır");
    assert.deepEqual(m.sizes, [vp.touch ? "44x44" : "40x40"], tag);
    assert.deepEqual(m.gaps, [8], tag);
    assert.ok(m.pageOverflow <= 0, tag + ": sayfa yatay kaymaz");
    if (!vp.touch) {
      const wa = page.locator(".share .is-whatsapp").first();
      await wa.hover();
      await page.waitForTimeout(250);
      assert.deepEqual(await wa.evaluate((b) => { const s = getComputedStyle(b, "::after"); return [s.content, s.opacity]; }), ['"WhatsApp\'ta Paylaş"', "1"], tag + ": bilgi balonu");
      await page.locator(".share .is-facebook").first().focus();
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute("aria-label")), "Facebook'ta Paylaş", tag + ": klavye odağı");
    }
    await ctx.close();
  }
  // paylaşım adresleri korunur; Kopyala "Bağlantı kopyalandı" der
  const ctx = await browsers.chromium.newContext({ viewport: { width: 1280, height: 800 }, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage();
  await open(page, "/haber/265.html");
  const hrefs = await page.locator(".share a[data-share]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  ["https://wa.me/?text=", "https://www.facebook.com/sharer/sharer.php?u=", "https://x.com/intent/tweet?text=", "https://t.me/share/url?url=", "https://www.linkedin.com/sharing/share-offsite/?url="]
    .forEach((p, i) => assert.ok(hrefs[i].startsWith(p), hrefs[i]));
  assert.ok(hrefs.at(-1).startsWith("mailto:?subject="));
  await page.locator(".share .is-copy").first().click();
  await page.locator(".share-status").filter({ hasText: "Bağlantı kopyalandı" }).waitFor();
  assert.match(await page.evaluate(() => navigator.clipboard.readText()), /\/haber\/265\.html$/);
  await ctx.close();
});

test("panel: yeni galeri albümü (çoklu yükleme, küçültme, sıralama, açıklama), Hakkında ve Kaynaklar düzenlenir", async () => {
  const C = require("../src/content");
  for (const [engine, vp] of [["chromium", { width: 1280, height: 800, touch: false }], ["webkit", { width: 390, height: 844, touch: true }]]) {
    const ctx = await context(engine, vp);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await open(page, "/panel/#/yonetim/icerik/album/yeni");
    const ev = `Arayüz Deneme ${engine}`;
    await page.locator('[name="event"]').fill(ev);
    await page.locator('[name="name"]').fill("Açılış");
    // biri tarayıcıda üretilmiş büyük (3200×2400) fotoğraf: yüklemeden önce küçültülür
    const big = await page.evaluate(() => { const c = document.createElement("canvas"); c.width = 3200; c.height = 2400; const g = c.getContext("2d");
      for (let i = 0; i < 300; i++) { g.fillStyle = `hsl(${i * 47 % 360} 60% 50%)`; g.fillRect((i * 131) % 3200, (i * 71) % 2400, 220, 160); } return c.toDataURL("image/png").split(",")[1]; });
    const small = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0a50000000049454e44ae426082", "hex");
    await page.locator(".gallery-field input[type=file]").setInputFiles([{ name: "buyuk.png", mimeType: "image/png", buffer: Buffer.from(big, "base64") }, { name: "kucuk.png", mimeType: "image/png", buffer: small }]);
    await page.locator("[data-gf-status]").filter({ hasText: "2 fotoğraf eklendi" }).waitFor({ timeout: 20000 });
    assert.equal(await page.locator(".gf-item").count(), 2);
    // ikinci fotoğrafı öne al, açıklama yaz
    await page.locator('.gf-item[data-i="1"] [data-m="-1"]').click();
    await page.locator('.gf-item[data-i="0"] input').fill("Kürsüdeki konuşmacılar");
    const m = await page.evaluate(H.measure, vp.touch);
    assert.equal(m.overflow, false, `${engine}: yatay taşma`);
    await page.locator("form button[type=submit]").click();
    await page.waitForURL(/#\/yonetim\/icerik\/album\/\d+$/);
    const id = +page.url().split("/").pop();
    const al = C.getItem("album", id);
    assert.equal(al.event, ev);
    assert.equal(al.photos.length, 2);
    assert.equal(al.photos[0].title, "Kürsüdeki konuşmacılar");
    assert.match(al.photos[1].src, /^uploads\/\d{4}-\d{2}\/[0-9a-f]{24}\.(webp|jpg)$/, "büyük fotoğraf küçültülerek yüklendi");
    assert.equal(await page.locator("[data-back]").getAttribute("href"), `/galeri/${al.cid}-${al.sid}.html`);
    // düzenleme ekranında fotoğrafı kaldırıp kaydetme
    await page.locator(".gf-item").first().waitFor();
    await page.locator('.gf-item[data-i="0"] [data-x]').click();
    await page.locator("form button[type=submit]").click();
    await page.waitForFunction((i) => fetch("/api/items/album/" + i).then((r) => r.json()).then((j) => j.values.photos.length === 1), id);
    assert.deepEqual(errs, [], engine);
    await ctx.close();
  }
  // Hakkında: mevcut metin editörde; değişiklik kaydedilir. Menüde yeni bölümler.
  const ctx = await context("chromium", { width: 1280, height: 800, touch: false });
  const page = await ctx.newPage();
  await open(page, "/panel/#/yonetim/icerik/page");
  const nav = await page.locator("nav a").allTextContents();
  for (const t of ["Galeri albümleri", "Bağlantı yönetimi", "Kaynaklar: dosyalar", "Hakkında sayfası"]) assert.ok(nav.some((x) => x.includes(t)), t);
  const area = page.locator('[data-editor="about_html"] .editor-area');
  assert.ok((await area.innerText()).includes("Mezhepler Tarihi"));
  assert.equal(await page.locator("[data-del]").count(), 0, "Hakkında silinemez");
  await page.locator('[name="about_lead"]').fill("Arayüz testinden giriş cümlesi.");
  await page.locator("form button[type=submit]").click();
  await page.waitForFunction(() => fetch("/api/items/page/1").then((r) => r.json()).then((j) => j.values.about_lead === "Arayüz testinden giriş cümlesi."));
  // bağlantı ekleme (eski "icerik/link" adresi Bağlantı Yönetimi'ne gider)
  await open(page, "/panel/#/yonetim/icerik/link/yeni");
  await page.waitForURL(/#\/yonetim\/baglantilar\/yeni$/);
  await page.locator('[name="name"]').fill("Arayüz Dergisi");
  await page.locator('[name="url"]').fill("https://ornek.org/dergi");
  await page.locator('[name="category"]').selectOption({ label: "Dergiler" });
  await page.locator("form button[type=submit]").click();
  await page.waitForURL(/#\/yonetim\/baglantilar\/\d+$/);
  assert.equal(C.getItem("link", +page.url().split("/").pop()).url, "https://ornek.org/dergi");
  await ctx.close();
});
