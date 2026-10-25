// Responsive denetim: her sayfayı her ekran ölçüsünde açar, sorunları ve ekran görüntülerini kaydeder.
// Kullanım: node test-ui/audit.js <çıktı klasörü> [chromium|firefox|webkit] [--shots]
const fs = require("node:fs");
const path = require("node:path");
const pw = require("playwright");
const H = require("./harness");

const OUT = process.argv[2] || path.join(H.TMP, "denetim");
const ENGINE = process.argv[3] && !process.argv[3].startsWith("--") ? process.argv[3] : "chromium";
const SHOTS = process.argv.includes("--shots");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const base = await H.start();
  const browser = await pw[ENGINE].launch();
  const report = [];
  try {
    for (const vp of H.VIEWPORTS) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, hasTouch: vp.touch, isMobile: vp.touch && ENGINE !== "firefox", deviceScaleFactor: 1 });
      await H.login(ctx);
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      for (const pg of [...H.pages(), ...H.PANEL]) {
        errors.length = 0;
        await page.goto(base + pg.url, { waitUntil: "networkidle" });
        await page.waitForTimeout(pg.url.includes("/panel/") ? 500 : 150);
        await page.evaluate(() => document.querySelectorAll(".reveal").forEach((e) => e.classList.add("in")));
        const m = await page.evaluate(H.measure, vp.touch);
        if (SHOTS) await page.screenshot({ path: path.join(OUT, `${pg.name}--${vp.name}.png`), fullPage: false });
        const row = { page: pg.name, vp: vp.name, width: vp.width, ...m, jsErrors: [...errors] };
        // mobil menü: açılır mı, arka plan kayar mı, odak menüye geçer mi, Esc kapatır mı
        const btn = pg.url.includes("/panel/") ? await page.$(".panel-menu-btn") : await page.$(".menu-btn");
        if (btn && await btn.isVisible()) {
          await btn.click(); await page.waitForTimeout(350);
          row.menu = await page.evaluate(() => {
            const nav = document.querySelector(location.pathname.startsWith("/panel") ? ".panel-nav" : ".nav");
            const r = nav && nav.getBoundingClientRect();
            return { open: !!r && r.height > 50 && getComputedStyle(nav).opacity !== "0", bodyLocked: getComputedStyle(document.body).overflow === "hidden" || getComputedStyle(document.documentElement).overflow === "hidden",
              focusInside: !!nav && nav.contains(document.activeElement), fitsScreen: !!r && r.bottom <= innerHeight + 1 || (nav && nav.scrollHeight > nav.clientHeight) };
          });
          await page.keyboard.press("Escape"); await page.waitForTimeout(300);
          row.menu.escCloses = await page.evaluate(() => !document.body.classList.contains("menu-open") && !document.body.classList.contains("side-open"));
        }
        report.push(row);
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
    H.stop();
  }
  fs.writeFileSync(path.join(OUT, `rapor-${ENGINE}.json`), JSON.stringify(report, null, 1));
  const bad = report.filter((r) => r.overflow || r.offscreenN || r.jsErrors.length);
  console.log(`${ENGINE}: ${report.length} ölçüm · taşma ${report.filter((r) => r.overflow).length} · ekran dışı öğe ${report.filter((r) => r.offscreenN).length} · küçük dokunma hedefi (sayfa) ${report.filter((r) => r.smallN).length} · JS hatası ${report.filter((r) => r.jsErrors.length).length}`);
  for (const r of bad.slice(0, 60)) console.log(`  ${r.page} @${r.width}: taşma=${r.overflow} (${r.scrollW}/${r.vw}) ${r.offscreen.slice(0, 3).join(" | ")} ${r.jsErrors.join(";")}`);
})().catch((e) => { console.error(e); process.exit(1); });
