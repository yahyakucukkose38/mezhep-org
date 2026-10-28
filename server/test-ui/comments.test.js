// Yorum editörü arayüz testleri (Playwright): biçimlendirme, bağlantı, görsel yükleme (küçültme dahil), video, önizleme,
// gönderme, sayfa yenilenince biçimin korunması, düzenleme, eski yorumlar, yapıştırmada zararlı içerik ve telefon/tablet.
// Çalıştırma: cd server && node --test test-ui/comments.test.js
const test = require("node:test");
const assert = require("node:assert/strict");
const pw = require("playwright");
const H = require("./harness");
const { db } = require("../src/db");

const WORK = "/eser/656.html";
let base, browsers = {}, session;
test.before(async () => {
  base = await H.start();
  browsers.chromium = await pw.chromium.launch();
  browsers.webkit = await pw.webkit.launch();
  const c = await browsers.chromium.newContext();
  await H.login(c);
  session = await c.storageState();
  await c.close();
});
test.after(async () => { for (const b of Object.values(browsers)) await b.close(); H.stop(); });

async function openPage(engine, opts = {}) {
  const ctx = await browsers[engine].newContext({ ...(opts.device || { viewport: { width: 1280, height: 900 } }), storageState: session });
  const page = await ctx.newPage();
  const errors = [], dialogs = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => { dialogs.push(d.message()); d.dismiss(); });
  await page.goto(base + (opts.url || WORK), { waitUntil: "networkidle" });
  await page.locator("[data-comment-form] .ce-area").waitFor({ timeout: 10000 });
  return { ctx, page, errors, dialogs };
}
const form = (page, sel) => page.locator("[data-comment-form] " + sel);
const tool = (page, cmd) => form(page, `[data-cmd="${cmd}"]`);
// Tarayıcıda büyük bir görsel üretir (küçültme yolunu denemek için)
const bigPng = (page) => page.evaluate(() => {
  const c = document.createElement("canvas"); c.width = 3000; c.height = 2000;
  const g = c.getContext("2d");
  for (let i = 0; i < 400; i++) { g.fillStyle = `hsl(${i * 37 % 360} 70% 50%)`; g.fillRect((i * 97) % 3000, (i * 53) % 2000, 180, 140); }
  return c.toDataURL("image/png").split(",")[1];
});

test("masaüstü: biçimlendirme, bağlantı, görsel, video, önizleme, gönderme ve yenilemede korunma", async () => {
  const { ctx, page, errors, dialogs } = await openPage("chromium");
  const area = form(page, ".ce-area");
  // araç çubuğu: bütün araçlar Türkçe açıklamalı
  const labels = await form(page, ".ce-bar button").evaluateAll((bs) => bs.map((b) => b.getAttribute("aria-label")));
  assert.deepEqual(labels, ["Kalın", "İtalik", "Büyük başlık", "Küçük başlık", "Madde işaretli liste", "Numaralı liste", "Alıntı", "Bağlantı ekle",
    "Görsel ekle (bilgisayar ya da telefondan)", "Video ekle (YouTube / Vimeo)", "Geri al", "İleri al", "Biçimi temizle"]);

  await area.click();
  await tool(page, "h2").click();
  await page.keyboard.type("Değerlendirme");
  await page.keyboard.press("Enter");
  await tool(page, "bold").click();
  await page.keyboard.type("kalın");
  await tool(page, "bold").click();
  await page.keyboard.type(" ve ");
  await page.keyboard.press("Control+i");
  await page.keyboard.type("italik");
  await page.keyboard.press("Control+i");
  await page.keyboard.type(" metin. ");
  // Ctrl+K: bağlantı formu
  await page.keyboard.press("Control+k");
  await form(page, ".ce-pop [data-url]").fill("https://ornek.org/kaynak");
  await form(page, ".ce-pop [data-text]").fill("kaynak");
  await form(page, ".ce-pop [data-ok]").click();
  await page.keyboard.press("Enter");
  await tool(page, "ul").click();
  await page.keyboard.type("madde bir");
  await page.keyboard.press("Enter");
  await page.keyboard.type("madde iki");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await tool(page, "quote").click();
  await page.keyboard.type("Alıntılanan söz");
  assert.equal(await tool(page, "quote").getAttribute("aria-pressed"), "true");

  // geri al / ileri al
  await page.keyboard.type("X");
  await tool(page, "undo").click();
  assert.ok(!(await area.innerText()).includes("sözX"));
  await tool(page, "redo").click();
  assert.ok((await area.innerText()).includes("sözX"));
  await tool(page, "undo").click();

  // geçersiz bağlantı reddedilir
  await tool(page, "link").click();
  await form(page, ".ce-pop [data-url]").fill("javascript:alert(1)");
  await form(page, ".ce-pop [data-ok]").click();
  assert.equal(await form(page, ".ce-pop [data-err]").isVisible(), true);
  await form(page, ".ce-pop [data-x]").click();

  // büyük görsel: tarayıcıda küçültülüp ilerlemeyle yüklenir
  const b64 = await bigPng(page);
  await form(page, 'input[type="file"]').setInputFiles({ name: "buyuk.png", mimeType: "image/png", buffer: Buffer.from(b64, "base64") });
  const img = form(page, ".ce-area img");
  await img.waitFor({ timeout: 15000 });
  const src = await img.getAttribute("src");
  assert.match(src, /^\/uploads\/\d{4}-\d{2}\/[0-9a-f]{24}\.(webp|jpg)$/);
  const dims = await img.evaluate((i) => i.decode().then(() => [i.naturalWidth, i.naturalHeight]));
  assert.ok(dims[0] <= 1920 && dims[1] <= 1920, "küçültüldü: " + dims);
  // desteklenmeyen dosya türü
  await form(page, 'input[type="file"]').setInputFiles({ name: "a.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
  assert.match(await form(page, ".ce-note").innerText(), /JPG, PNG ya da WebP/);

  // video: bağlantı → önizleme → ekle
  await tool(page, "video").click();
  await form(page, ".ce-pop [data-url]").fill("https://youtu.be/dQw4w9WgXcQ");
  await form(page, ".ce-pop [data-prev] iframe").waitFor();
  await form(page, ".ce-pop [data-ok]").click();
  await form(page, ".ce-area figure.media-video").waitFor();
  // görsele dokununca değiştir/kaldır araçları
  await img.click();
  assert.equal(await form(page, ".ce-media").isVisible(), true);
  await form(page, '.ce-media [data-m="x"]').click();

  // önizleme
  await form(page, ".ce-prev-btn").click();
  const pv = form(page, ".ce-preview .prose");
  assert.equal(await pv.locator("h2").innerText(), "Değerlendirme");
  assert.equal(await pv.locator("iframe").count(), 1);
  assert.match(await form(page, ".ce-count").innerText(), /^\d+ \/ 3000$/);

  // gönder
  await form(page, 'button[type="submit"]').click();
  await form(page, ".comment-msg").filter({ hasText: "yayınlandı" }).waitFor();
  assert.equal(await form(page, ".ce-area").innerText().then((t) => t.trim()), "", "gönderince editör boşalır");

  const check = async (p) => {
    const c = p.locator(".comment").filter({ hasText: "Alıntılanan söz" }).last();
    await c.waitFor();
    const body = c.locator(".comment-body");
    assert.equal(await body.locator("h2").innerText(), "Değerlendirme");
    assert.equal(await body.locator("strong").first().innerText(), "kalın");
    assert.equal(await body.locator("em").first().innerText(), "italik");
    assert.equal(await body.locator('a[href="https://ornek.org/kaynak"]').getAttribute("rel"), "nofollow ugc noopener noreferrer");
    assert.equal(await body.locator("ul li").count(), 2);
    assert.equal(await body.locator("blockquote").innerText(), "Alıntılanan söz");
    assert.equal(await body.locator("img").getAttribute("src"), src);
    assert.match(await body.locator("figure.media-video iframe").getAttribute("src"), /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
    return c;
  };
  await check(page);
  await page.reload({ waitUntil: "networkidle" });
  const c = await check(page);

  // düzenleme: eski içerik editöre gelir, kaydedilince güncellenir
  await c.locator(".comment-edit").click();
  const ed = c.locator(".comment-editing .ce-area");
  await ed.waitFor();
  assert.equal(await ed.locator("h2").innerText(), "Değerlendirme");
  await ed.locator("blockquote").click();
  await page.keyboard.press("End");
  await page.keyboard.type(" (düzeltildi)");
  await c.locator("[data-save]").click();
  const c2 = page.locator(".comment").filter({ hasText: "(düzeltildi)" });
  await c2.waitFor();
  assert.equal(await c2.locator(".comment-edited").innerText(), "düzenlendi");
  assert.equal(await c2.locator(".comment-body h2").innerText(), "Değerlendirme", "düzenlemede diğer biçimler korunur");

  assert.deepEqual(errors, []);
  assert.deepEqual(dialogs, []);
  await ctx.close();
});

test("yapıştırılan zararlı HTML çalışmaz; eski düz metin yorumlar görünür", async () => {
  db.prepare("INSERT INTO comments (target, user_id, body, status) VALUES ('work:656', 1, ?, 'visible')").run("Eski düz metin yorum <b>etiketli</b>\n\nikinci paragraf");
  const { ctx, page, errors, dialogs } = await openPage("chromium");
  const old = page.locator(".comment").filter({ hasText: "Eski düz metin yorum" });
  await old.waitFor();
  assert.equal(await old.locator(".comment-body p").count(), 2);
  assert.ok((await old.locator(".comment-body").innerText()).includes("<b>etiketli</b>"), "eski yorumdaki etiket metin olarak görünür");

  const area = form(page, ".ce-area");
  await area.click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData("text/html", '<img src=x onerror="alert(1)"><b>kalın</b>');
    dt.setData("text/plain", 'Yapıştırılan <img src=x onerror="alert(1)"> metin');
    document.querySelector("[data-comment-form] .ce-area").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  assert.equal(await area.locator("img").count(), 0);
  assert.ok((await area.innerText()).includes('<img src=x onerror="alert(1)">'));
  // tek başına YouTube bağlantısı yapıştırılınca videoya dönüştürme önerilir
  await page.keyboard.press("Enter");
  await page.evaluate(() => {
    const dt = new DataTransfer(); dt.setData("text/plain", "https://www.youtube.com/watch?v=dQw4w9WgXcQ");
    document.querySelector("[data-comment-form] .ce-area").dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await form(page, ".ce-note [data-i='0']").click();
  await form(page, ".ce-area figure.media-video").waitFor();
  await form(page, 'button[type="submit"]').click();
  const c = page.locator(".comment").filter({ hasText: "Yapıştırılan" });
  await c.waitFor();
  assert.equal(await c.locator(".comment-body img").count(), 0);
  assert.equal(await c.locator(".comment-body iframe").count(), 1);
  await page.waitForTimeout(300);
  assert.deepEqual(dialogs, [], "hiçbir betik çalışmadı");
  assert.deepEqual(errors, []);
  await ctx.close();
});

for (const [engine, name] of [["chromium", "Pixel 7"], ["webkit", "iPhone SE"], ["webkit", "iPad Mini"]]) {
  test(`${name} (${engine}): editör ekrana sığar, dokunma hedefleri yeterli, yorum gönderilir`, async () => {
    const { ctx, page, errors } = await openPage(engine, { device: pw.devices[name] });
    await form(page, ".ce").scrollIntoViewIfNeeded();
    const m = await page.evaluate(H.measure, true);
    assert.equal(m.overflow, false, `yatay taşma ${m.scrollW}/${m.vw}`);
    const off = m.offscreen.filter((s) => /ce-|comment/.test(s));
    assert.deepEqual(off, []);
    const small = m.small.filter((s) => /ce-|comment|data-cmd/.test(s));
    assert.deepEqual(small, [], "küçük dokunma hedefi");
    const box = await form(page, ".ce-bar").boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= m.vw + 1);
    await form(page, ".ce-area").tap();
    await tool(page, "bold").tap();
    await page.keyboard.type("Telefondan kalın");
    await form(page, 'button[type="submit"]').tap();
    const c = page.locator(".comment").filter({ hasText: "Telefondan kalın" }).last();
    await c.waitFor();
    assert.equal(await c.locator(".comment-body strong").count(), 1);
    // yorumdaki görsel ve video ekrana sığar
    const wide = await page.evaluate(() => [...document.querySelectorAll(".comment-body img, .comment-body iframe")].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).length);
    assert.equal(wide, 0);
    assert.deepEqual(errors, []);
    await ctx.close();
  });
}
