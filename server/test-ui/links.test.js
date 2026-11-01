// Bağlantılar rehberi arayüzü: ziyaretçi sayfasında arama ve kategori süzgeci (telefon, tablet, masaüstü),
// panelde ekleme (adres tamamlama, mükerrer uyarısı, taslak), toplu işlem, silme ve geri alma, kategori ve içe aktarma.
const test = require("node:test");
const assert = require("node:assert/strict");
const pw = require("playwright");
const H = require("./harness");

let base, session;
const browsers = {};
test.before(async () => {
  base = await H.start();
  for (const e of ["chromium", "webkit", "firefox"]) browsers[e] = await pw[e].launch();
  const c = await browsers.chromium.newContext();
  await H.login(c);
  session = await c.storageState();
  await c.close();
});
test.after(async () => {
  for (const b of Object.values(browsers)) await b.close();
  H.stop();
});
const context = (engine, vp, login = true) => browsers[engine].newContext({
  viewport: { width: vp.width, height: vp.height }, hasTouch: !!vp.touch, ...(vp.touch && engine !== "firefox" ? { isMobile: true } : {}), ...(login ? { storageState: session } : {}),
});
// Her ekran temiz yüklenir: aynı belgede yalnızca # değişirse eski ekranın başlığı yeni form çizilmeden görünür
async function open(page, url) {
  await page.goto("about:blank");
  await page.goto(base + url, { waitUntil: "networkidle" });
  if (url.includes("/panel/")) await page.waitForSelector("#panel-main .page-title", { timeout: 8000 });
}
const visible = (page) => page.locator("[data-links] li[data-f]:visible");

test("ziyaretçi sayfası: arama (Türkçe karakter duyarsız), temizleme, sonuç yok mesajı ve kategori süzgeci; telefon, tablet, masaüstü", async () => {
  for (const [engine, vp] of [["chromium", { width: 1280, height: 800 }], ["firefox", { width: 1024, height: 768 }], ["webkit", { width: 390, height: 844, touch: true }], ["chromium", { width: 768, height: 1024, touch: true }]]) {
    const ctx = await context(engine, vp, false);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await open(page, "/baglantilar.html");
    const all = await visible(page).count();
    assert.equal(all, 8, `${engine} ${vp.width}: bütün bağlantılar`);
    assert.match(await page.locator("[data-lk-info]").innerText(), /^8 bağlantı/);
    const m = await page.evaluate(H.measure, !!vp.touch);
    assert.equal(m.overflow, false, `${engine} ${vp.width}: yatay taşma ${m.offscreen.join(" | ")}`);
    if (vp.touch) assert.deepEqual(m.small.filter((s) => /lk-|select|input/.test(s)), [], "dokunma hedefleri");
    // arama: büyük harf ve Türkçe karakter farkı önemsiz
    await page.locator("[data-lk-q]").fill("KELAM ARASTIRMALARI");
    await page.waitForFunction(() => document.querySelectorAll("[data-links] li[data-f]:not([hidden])").length === 1);
    assert.equal(await visible(page).locator(".lk-name").innerText(), "KADER");
    assert.ok(await page.locator("[data-lk-clear]").isVisible());
    assert.ok(!(await page.locator('[data-lk-sec="kaynaklar"]').isVisible()), "boş kalan kategori gizlenir");
    await page.locator("[data-lk-clear]").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-links] li[data-f]:not([hidden])").length === 8);
    // sonuç yok
    await page.locator("[data-lk-q]").fill("bulunmayan kelime");
    await page.locator("[data-lk-empty]").waitFor({ state: "visible" });
    await page.locator("[data-lk-reset]").click();
    await page.waitForFunction(() => document.querySelectorAll("[data-links] li[data-f]:not([hidden])").length === 8);
    // kategori: masaüstünde yan panel, telefon ve tablette açılır menü
    const side = page.locator(".lk-side");
    if (vp.width > 900) {
      assert.ok(await side.isVisible());
      assert.ok(!(await page.locator("[data-lk-cat]").isVisible()));
      await side.locator('[data-lk-pick="dergiler"]').click();
      assert.equal(await side.locator('[data-lk-pick="dergiler"]').getAttribute("aria-pressed"), "true");
    } else {
      assert.ok(!(await side.isVisible()));
      await page.locator("[data-lk-cat]").selectOption("dergiler");
    }
    await page.waitForFunction(() => document.querySelectorAll("[data-links] li[data-f]:not([hidden])").length === 2);
    assert.match(page.url(), /#dergiler$/, "kategori adresle paylaşılabilir");
    assert.deepEqual(await visible(page).locator(".lk-name").allInnerTexts(), ["e-Makalat", "KADER"], "Türkçe A–Z");
    // adresle açılış
    await open(page, "/baglantilar.html#kisisel-siteler");
    await page.waitForFunction(() => document.querySelectorAll("[data-links] li[data-f]:not([hidden])").length === 4);
    // dış bağlantı yeni sekmede, güvenli
    const a = page.locator('a.lk-row[href="https://dergipark.org.tr/tr/pub/kader"]');
    await open(page, "/baglantilar.html");
    assert.equal(await a.getAttribute("target"), "_blank");
    assert.equal(await a.getAttribute("rel"), "noopener noreferrer");
    await ctx.route("https://dergipark.org.tr/**", (r) => r.fulfill({ body: "ok" }));
    const [popup] = await Promise.all([ctx.waitForEvent("page"), a.click()]);
    assert.equal(new URL(popup.url()).host, "dergipark.org.tr");
    await popup.close();
    // klavye: arama kutusunda Esc temizler
    await page.locator("[data-lk-q]").fill("kader");
    await page.locator("[data-lk-q]").press("Escape");
    await page.waitForFunction(() => document.querySelectorAll("[data-links] li[data-f]:not([hidden])").length === 8);
    assert.deepEqual(errs, [], engine);
    await ctx.close();
  }
});

test("panel: yeni bağlantı (https tamamlama, sayaç, mükerrer uyarısı, taslak), listede toplu pasif yapma, silme ve geri alma", async () => {
  const C = require("../src/content");
  for (const [engine, vp] of [["chromium", { width: 1280, height: 800 }], ["webkit", { width: 390, height: 844, touch: true }]]) {
    const ctx = await context(engine, vp);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await open(page, "/panel/#/yonetim/baglantilar/yeni");
    // içerik türü seçimi: Haber / Yazı / Bağlantı
    assert.deepEqual(await page.locator(".type-switch a").allInnerTexts(), ["Haber", "Yazı", "Bağlantı"]);
    const name = `Arayüz Kaynağı ${engine}`;
    await page.locator('[name="name"]').fill(name);
    await page.locator('[name="url"]').fill(`arayuz-${engine}.example.org`);
    await page.locator('[name="url"]').blur();
    assert.equal(await page.locator('[name="url"]').inputValue(), `https://arayuz-${engine}.example.org`);
    await page.locator('[name="category"]').selectOption({ label: "Dergiler" });
    assert.ok((await page.locator('[name="sub"] option').allInnerTexts()).includes("Yurt İçi Hakemli Dergiler"), "alt kategori seçenekleri kategoriye göre");
    await page.locator('[name="desc"]').fill("x".repeat(320));
    assert.match(await page.locator("[data-count]").innerText(), /320 \/ 300/);
    await page.locator('[name="desc"]').fill("Arayüz testinde eklenen kaynak");
    const m = await page.evaluate(H.measure, !!vp.touch);
    assert.equal(m.overflow, false, `${engine}: form taşmıyor ${m.offscreen.join(" | ")}`);
    await page.locator("form button[type=submit]").click();
    await page.waitForURL(/#\/yonetim\/baglantilar\/\d+$/);
    const id = +page.url().split("/").pop();
    const saved = C.getItem("link", id);
    assert.equal(saved.url, `https://arayuz-${engine}.example.org`);
    assert.equal(saved.status, "aktif");
    // aynı adresle ikinci kayıt: önce uyarı (form açıkken) ve onay penceresi; taslak olarak kaydedilir
    await open(page, "/panel/#/yonetim/baglantilar/yeni");
    await page.locator('[name="name"]').fill(name + " (ikinci)");
    await page.locator('[name="url"]').fill(`https://www.arayuz-${engine}.example.org/`);
    await page.locator('[name="url"]').blur();
    await page.locator("[data-dup]").filter({ hasText: name }).waitFor();
    await page.locator('[name="category"]').selectOption({ label: "Dergiler" });
    await page.locator("[data-draft]").click();
    await page.locator("dialog [data-yes]").click();
    await page.waitForURL(/#\/yonetim\/baglantilar\/\d+$/);
    const id2 = +page.url().split("/").pop();
    assert.notEqual(id2, id);
    assert.equal(C.getItem("link", id2).status, "pasif", "taslak = pasif");
    // tehlikeli adres anında işaretlenir ve kaydedilmez
    await open(page, "/panel/#/yonetim/baglantilar/yeni");
    await page.locator('[name="url"]').fill("javascript:alert(1)");
    await page.locator('[name="url"]').blur();
    await page.locator('[data-field="url"] .err').filter({ hasText: "http://" }).waitFor();
    // liste: arama, toplu pasif yapma
    await open(page, "/panel/#/yonetim/baglantilar");
    await page.locator("[data-q]").fill("Arayüz Kaynağı " + engine);
    await page.waitForFunction(() => document.querySelectorAll("[data-sel]").length === 2);
    await page.locator("[data-all]").check();
    await page.locator("[data-bulk]").waitFor({ state: "visible" });
    assert.match(await page.locator("[data-bulk-n]").innerText(), /2 bağlantı seçili/);
    await page.locator("[data-bulk-off]").click();
    await page.waitForFunction(([a, b]) => Promise.all([a, b].map((x) => fetch("/api/admin/links/" + x).then((r) => r.json()))).then((j) => j.every((x) => x.item.status === "pasif")), [id, id2]);
    const lm = await page.evaluate(H.measure, !!vp.touch);
    assert.equal(lm.overflow, false, `${engine}: liste taşmıyor ${lm.offscreen.join(" | ")}`);
    // silme ve geri alma
    await page.locator(`[data-del="${id2}"]`).click();
    await page.locator("dialog [data-ok]").click();
    await page.locator(".toast [data-undo]").click();
    await page.waitForFunction((x) => fetch("/api/admin/links/" + x).then((r) => r.ok), id2);
    assert.ok(C.getItem("link", id2), "geri alındı");
    assert.deepEqual(errs, [], engine);
    await ctx.close();
  }
});

test("panel: kategori ekleme ve önerilen kategoriler, CSV içe aktarma (ön izleme → onay), görünüm ayarı sitede uygulanır", async () => {
  const C = require("../src/content"), L = require("../src/links"), rebuild = require("../src/rebuild");
  const ctx = await context("chromium", { width: 1280, height: 800 });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await open(page, "/panel/#/yonetim/baglantilar/kategoriler");
  await page.locator("[data-suggest]").click();
  await page.locator(".p-item .t").filter({ hasText: "Bilimsel Dergiler" }).waitFor();
  await page.locator("#lc-name").fill("Arayüz Kategorisi");
  await page.locator(".cat-new button[type=submit]").click();
  await page.locator(".p-item .t").filter({ hasText: "Arayüz Kategorisi" }).waitFor();
  assert.ok(L.cats().some((c) => c.name === "Arayüz Kategorisi"));
  // içe aktarma
  await open(page, "/panel/#/yonetim/baglantilar/toplu");
  const csv = "Bağlantı adı;URL;Açıklama;Kategori;Alt kategori;Durum\nİçe Aktarılan Bir;https://ice1.example.org;Bir;Arayüz Kategorisi;;Aktif\nİçe Aktarılan İki;ice2.example.org;;Arayüz Kategorisi;Alt Bölüm;Aktif\nBozuk;javascript:x;;Arayüz Kategorisi;;Aktif\nKADER;https://dergipark.org.tr/tr/pub/kader;;Dergiler;;Aktif";
  await page.locator("[data-file]").setInputFiles({ name: "liste.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.locator("[data-preview] .notice").filter({ hasText: "4 satır okundu" }).waitFor();
  assert.match(await page.locator("[data-preview] .notice").first().innerText(), /2 eklenecek, 1 zaten kayıtlı, 1 hatalı/);
  assert.equal(await page.locator("[data-commit]").innerText(), "2 kaydı onayla ve içe aktar");
  await page.locator("[data-commit]").click();
  await page.locator("dialog [data-ok]").click();
  await page.locator("[data-report]").filter({ hasText: "2 bağlantı eklendi, 1 atlandı, 0 hatalı" }).waitFor();
  assert.ok(C.listItems("link").some((l) => l.name === "İçe Aktarılan İki" && l.url === "https://ice2.example.org"));
  // eski kategoriden aktarma bölümü: bu veritabanında "Bağlantılar" haber kategorisi yok → seçim kutusu gösterilir
  await page.locator("[data-legacy] #lg-cat").waitFor();
  // görünüm ayarları: açıklamaları gizle
  await open(page, "/panel/#/yonetim/baglantilar/gorunum");
  await page.locator('[name="links_show_desc"]').uncheck();
  await page.locator("form button[type=submit]").click();
  await page.locator(".toast").filter({ hasText: "Kaydedildi" }).waitFor();
  await rebuild.run();
  await open(page, "/baglantilar.html");
  assert.equal(await page.locator(".lk-desc").count(), 0, "açıklamalar gizli");
  assert.ok(await page.locator(".lk-name").filter({ hasText: "İçe Aktarılan Bir" }).count());
  assert.deepEqual(errs, []);
  await ctx.close();
});
