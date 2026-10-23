// Ortam değişkenlerinden okunan ayarlar. Yerelde hepsinin makul bir varsayılanı vardır;
// sunucuda deploy/.env doldurur (bkz. deploy/.env.example).
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = process.env.MZ_DATA_DIR || path.join(ROOT, ".yerel");

module.exports = {
  ROOT,
  PORT: Number(process.env.PORT) || 3000,
  // SQLite veritabanı, yüklenen dosyalar, dışa aktarılan JSON ve üretilen site burada durur (sunucuda Docker birimi).
  DATA_DIR,
  DB_FILE: path.join(DATA_DIR, "mezhep.db"),
  UPLOAD_DIR: path.join(DATA_DIR, "uploads"),
  EXPORT_DIR: path.join(DATA_DIR, "json"),
  SITE_DIR: path.join(DATA_DIR, "site"),
  SECRET_DIR: path.join(DATA_DIR, "gizli"),
  // İlk çalıştırmada içerik buradaki JSON dosyalarından veritabanına aktarılır.
  SEED_DIR: process.env.MZ_SEED_DIR || path.join(ROOT, "data"),
  ASSETS_DIR: path.join(ROOT, "assets"),
  MEDIA_DIR: path.join(ROOT, "media"),
  BUILD_SCRIPT: path.join(ROOT, "scripts", "build.py"),
  PYTHON: process.env.PYTHON || (process.platform === "win32" ? "python" : "python3"),
  PUBLIC_ORIGIN: (process.env.PUBLIC_ORIGIN || "http://localhost:3000").replace(/\/$/, ""),
  COOKIE_SECURE: process.env.COOKIE_SECURE === "true",
  // nginx arkasında istemci IP'si X-Forwarded-For'dan okunur.
  TRUST_PROXY: process.env.TRUST_PROXY || "loopback, uniquelocal",
  SESSION_DAYS: 30,
};
