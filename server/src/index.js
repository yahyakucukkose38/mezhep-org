// Mezhep.Org sunucusu: üretilmiş statik site + üye/yönetim paneli (/panel) + API (/api).
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const express = require("express");
const cfg = require("./config");
const { db, seedIfEmpty, log } = require("./db");
const A = require("./auth"); // rol tabloları (perms.js) da buradan yüklenir
require("./site-settings");
const rebuild = require("./rebuild");
const { api } = require("./api");
const videos = require("./videos");
const SS = require("./site-settings");

// Site sayfalarındaki tek satır içi betik (tema seçimi; scripts/build.py THEME_SCRIPT ile aynı olmalı).
const THEME_SCRIPT = 'document.documentElement.className="js";try{var t=localStorage.getItem("mz-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}';
const THEME_HASH = crypto.createHash("sha256").update(THEME_SCRIPT).digest("base64");

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'sha256-${THEME_HASH}'`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: https:",
  "connect-src 'self'",
  // ana sayfa video modülü: YouTube'un çerezsiz oynatıcısı
  "frame-src https://www.youtube-nocookie.com",
  "frame-ancestors 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

function ensureAdmin() {
  if (db.prepare("SELECT 1 FROM users WHERE role_key = 'super' LIMIT 1").get()) return;
  const email = (process.env.MZ_ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email) {
    console.warn("[kurulum] Yönetici hesabı yok. MZ_ADMIN_EMAIL ayarlayın ya da `npm run yonetici -- olustur <e-posta> \"Ad Soyad\"` çalıştırın.");
    return;
  }
  const temp = crypto.randomBytes(9).toString("base64url") + "7";
  db.prepare("INSERT INTO users (email, name, password_hash, role, role_key, status, must_change) VALUES (?, ?, ?, 'admin', 'super', 'active', 1)")
    .run(email, process.env.MZ_ADMIN_NAME || "Site Yöneticisi", A.hashPassword(temp));
  fs.mkdirSync(cfg.SECRET_DIR, { recursive: true, mode: 0o700 });
  const file = path.join(cfg.SECRET_DIR, "ilk-yonetici.txt");
  fs.writeFileSync(file, `E-posta: ${email}\nGeçici şifre: ${temp}\nİlk girişte şifrenizi değiştirin, ardından bu dosyayı silin.\n`, { mode: 0o600 });
  log(null, "ilk-yonetici", email);
  console.log(`[kurulum] İlk yönetici oluşturuldu (${email}). Geçici şifre: ${file}`);
}

function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", cfg.TRUST_PROXY);

  app.use((req, res, next) => {
    res.set({
      "Content-Security-Policy": CSP,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    });
    next();
  });

  app.use("/api", express.json({ limit: "1mb" }), A.loadUser, A.sameOrigin, (req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  }, api);

  const panelDir = path.join(__dirname, "..", "panel");
  app.use("/panel", express.static(panelDir, { index: "index.html", maxAge: "5m" }));
  app.get(/^\/panel(\/.*)?$/, (_req, res) => res.sendFile(path.join(panelDir, "index.html")));

  // Üretilmiş site önce (search-index.js de oradadır), sonra kaynak varlıklar, eski medya ve yüklemeler.
  app.use(express.static(cfg.SITE_DIR, { extensions: ["html"], maxAge: "2m" }));
  app.use("/assets", express.static(cfg.ASSETS_DIR, { maxAge: "1h" }));
  app.use("/media", express.static(cfg.MEDIA_DIR, { maxAge: "30d", immutable: true }));
  app.use("/uploads", express.static(cfg.UPLOAD_DIR, { maxAge: "30d", immutable: true }));

  app.use((req, res) => {
    const notFound = path.join(cfg.SITE_DIR, "404.html");
    res.status(404);
    fs.existsSync(notFound) ? res.sendFile(notFound) : res.type("text/plain").send("Sayfa bulunamadı.");
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    console.error(err);
    if (req.path.startsWith("/api")) return res.status(500).json({ error: "Beklenmeyen bir hata oluştu." });
    res.status(500).type("text/plain").send("Beklenmeyen bir hata oluştu.");
  });
  return app;
}

if (require.main === module) {
  for (const d of [cfg.UPLOAD_DIR, cfg.SITE_DIR]) fs.mkdirSync(d, { recursive: true });
  if (seedIfEmpty()) console.log("[kurulum] İçerik data/*.json dosyalarından veritabanına aktarıldı.");
  ensureAdmin();
  A.cleanupSessions();
  setInterval(A.cleanupSessions, 6 * 3600e3).unref();
  // Sunucu her açılışta siteyi güncel veriyle (ve dinamik özelliklerle) yeniden üretir.
  rebuild.run();
  // Video listelerini açılışta ve 6 saatte bir yenile; değiştiyse siteyi yeniden üret.
  const refreshVideos = () => videos.refresh(SS.get("videos_playlists"))
    .then((changed) => changed && rebuild.schedule("video listesi güncellendi"))
    .catch((e) => console.error("[video]", e.message));
  setTimeout(refreshVideos, 15000).unref();
  setInterval(refreshVideos, 6 * 3600e3).unref();
  createApp().listen(cfg.PORT, () => console.log(`[sunucu] http://localhost:${cfg.PORT} (veri: ${cfg.DATA_DIR})`));
}

module.exports = { createApp, THEME_SCRIPT };
