// Şifre özeti (scrypt), oturum çerezi, yetki ara katmanları ve basit deneme sınırlayıcı.
const crypto = require("node:crypto");
const { db, plain } = require("./db");
const cfg = require("./config");
const P = require("./perms"); // rol tablosu ve role_key geçişi burada yüklenir

const COOKIE = "mz_oturum";
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 64, SCRYPT);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

function verifyPassword(pw, stored) {
  const [alg, salt, key] = String(stored || "").split("$");
  if (alg !== "scrypt" || !salt || !key) return false;
  const want = Buffer.from(key, "base64");
  const got = crypto.scryptSync(pw, Buffer.from(salt, "base64"), want.length, SCRYPT);
  return crypto.timingSafeEqual(want, got);
}

function passwordProblem(pw) {
  if (typeof pw !== "string" || pw.length < 10) return "Şifre en az 10 karakter olmalı.";
  if (pw.length > 200) return "Şifre çok uzun.";
  if (!/[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(pw) || !/\d/.test(pw)) return "Şifre en az bir harf ve bir rakam içermeli.";
  return null;
}

const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");

function createSession(res, userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + cfg.SESSION_DAYS * 864e5);
  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(sha(token), userId, expires.toISOString());
  db.prepare("UPDATE users SET last_login = datetime('now') WHERE id = ?").run(userId);
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: cfg.COOKIE_SECURE, expires, path: "/" });
}

function destroySession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) db.prepare("DELETE FROM sessions WHERE token = ?").run(sha(token));
  res.clearCookie(COOKIE, { path: "/" });
}

function readCookie(req, name) {
  const raw = req.headers.cookie || "";
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

const PUBLIC_USER = "id, email, name, title, university, role_key, status, member_id, must_change, created_at, last_login";

// Kullanıcı satırına rol adı ve etkin yetkileri ekler (engellenen/onaysız kullanıcının yönetim yetkisi olmaz).
function withPerms(u) {
  if (!u) return u;
  const role = P.roles().get(u.role_key);
  u.role_label = role ? role.label : "Üye";
  u.perms = u.status === "active" ? P.permsOf(u.role_key) : [];
  return u;
}

// Her isteğe req.user ekler (oturum yoksa null).
function loadUser(req, _res, next) {
  req.user = null;
  const token = readCookie(req, COOKIE);
  if (token) {
    const row = db.prepare(
      `SELECT ${PUBLIC_USER.split(", ").map((c) => "u." + c).join(", ")} FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ?`
    ).get(sha(token), new Date().toISOString());
    if (row && row.status !== "blocked") req.user = withPerms(plain(row));
  }
  next();
}

const fail = (res, code, message) => res.status(code).json({ error: message });

function requireUser(req, res, next) {
  if (!req.user) return fail(res, 401, "Bu işlem için giriş yapmalısınız.");
  next();
}

function requireActive(req, res, next) {
  if (!req.user) return fail(res, 401, "Bu işlem için giriş yapmalısınız.");
  if (req.user.status !== "active") return fail(res, 403, "Üyeliğiniz henüz yönetici tarafından onaylanmadı.");
  if (req.user.must_change) return fail(res, 403, "Devam etmeden önce şifrenizi değiştirmelisiniz.");
  next();
}

// Herhangi bir yönetim yetkisi olanlar (yönetim paneline giriş)
function requireStaff(req, res, next) {
  if (!req.user || req.user.status !== "active" || !P.isStaff(req.user)) return fail(res, 403, "Bu alan yalnızca yetkili kişilere açıktır.");
  if (req.user.must_change) return fail(res, 403, "Devam etmeden önce şifrenizi değiştirmelisiniz.");
  next();
}

// Belirtilen yetkilerden en az birini ister.
const requirePerm = (...perms) => (req, res, next) => {
  if (!perms.some((p) => P.can(req.user, p))) return fail(res, 403, "Bu işlem için yetkiniz yok.");
  next();
};

// Değişiklik yapan istekler yalnızca kendi sitemizden, özel başlıkla gelebilir (CSRF koruması).
function sameOrigin(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  const host = `${req.protocol}://${req.get("host")}`;
  if (origin && origin !== cfg.PUBLIC_ORIGIN && origin !== host) return fail(res, 403, "Geçersiz istek kaynağı.");
  if (req.get("x-mz") !== "1") return fail(res, 403, "Geçersiz istek.");
  next();
}

// Bellek içi kayan pencere sınırlayıcı (tek süreç için yeterli).
function rateLimit({ windowMs, max, key = (req) => req.ip }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, arr] of hits) if (!arr.some((t) => now - t < windowMs)) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const k = key(req), now = Date.now();
    const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return fail(res, 429, "Çok fazla deneme yapıldı. Lütfen biraz sonra tekrar deneyin.");
    arr.push(now); hits.set(k, arr); next();
  };
}

function cleanupSessions() {
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString());
}

module.exports = {
  hashPassword, verifyPassword, passwordProblem, createSession, destroySession, loadUser,
  requireUser, requireActive, requireStaff, requirePerm, withPerms, sameOrigin, rateLimit, cleanupSessions, fail, PUBLIC_USER,
};
