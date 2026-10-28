// /api altındaki tüm uç noktalar.
const express = require("express");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const multer = require("multer");
const cfg = require("./config");
const { db, log, plain } = require("./db");
const A = require("./auth");
const C = require("./content");
const rebuild = require("./rebuild");
const ai = require("./ai/service");
const P = require("./perms");
const SS = require("./site-settings");
const CAT = require("./categories");

const api = express.Router();
const ok = (res, data = {}) => res.json(data);
const bad = (res, message, fields) => res.status(400).json({ error: message, fields });
const int = (v) => (/^\d{1,9}$/.test(String(v)) ? Number(v) : null);

// Hataları tek yerde JSON'a çevirir (doğrulama hataları alan alan döner).
const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res, next); } catch (e) {
    if (e instanceof C.ValidationError) return bad(res, e.message, e.fields);
    next(e);
  }
};

const userRow = (id) => A.withPerms(plain(db.prepare(`SELECT ${A.PUBLIC_USER} FROM users WHERE id = ?`).get(id)));

// ================================================================ genel
api.get("/health", (_req, res) => ok(res, { ok: true }));

api.get("/schema", (_req, res) => ok(res, { schemas: C.SCHEMAS, ranks: C.RANKS, groups: C.GROUPS, workTypes: C.WORK_TYPES, forums: CAT.topicChoices().labels }));

api.get("/me", (req, res) => {
  if (!req.user) return ok(res, { user: null });
  const out = { user: req.user };
  if (P.isStaff(req.user)) out.pending = pendingCounts(req.user);
  return ok(res, out);
});

// Tarayıcının ihtiyaç duyduğu herkese açık ayarlar (kayıt/yorum açık mı, asistan metinleri)
api.get("/site-settings", (_req, res) => ok(res, SS.publicValues()));

api.get("/lookup/members", (req, res) => {
  const q = String(req.query.q || "").toLocaleLowerCase("tr").trim();
  const rows = C.listItems("member")
    .filter((m) => !q || `${m.name} ${m.university}`.toLocaleLowerCase("tr").includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, "tr")).slice(0, 25)
    .map((m) => ({ id: m.id, name: m.name, title: m.title, university: m.university }));
  ok(res, { items: rows });
});

// ================================================================ paylaşım tıklamaları
const SHARE_PLATFORMS = ["whatsapp", "facebook", "x", "telegram", "linkedin", "pinterest", "eposta", "kopyala", "sistem"];
const SHARE_TARGET = /^(topic|work|member):(\d{1,9})$|^album:(\d{1,4})-(\d{1,4})$/;
// Paylaşılan içerik: başlık ve sayfa adresi (rapor ve doğrulama için); yayında olmayan kayıtlar sayılmaz.
function shareTarget(target) {
  const m = SHARE_TARGET.exec(String(target || ""));
  if (!m) return null;
  if (m[1]) {
    const it = C.getItem(m[1], +m[2]);
    if (!it) return null;
    const dir = { topic: "haber", work: "eser", member: "akademisyen" }[m[1]];
    return { title: it.title || it.name, url: `/${dir}/${+m[2]}.html`, kind: m[1] };
  }
  const al = C.getItem("album", +m[3] * 1000 + +m[4]);
  return al ? { title: [al.event, al.name].filter(Boolean).join(" — ") || "Albüm", url: `/galeri/${+m[3]}-${+m[4]}.html`, kind: "album" } : null;
}
api.post("/share", A.rateLimit({ windowMs: 10 * 60e3, max: 60 }), (req, res) => {
  const target = String(req.body?.target || ""), platform = String(req.body?.platform || "");
  if (!SHARE_PLATFORMS.includes(platform) || !shareTarget(target)) return A.fail(res, 400, "Geçersiz paylaşım kaydı.");
  db.prepare(`INSERT INTO share_clicks (day, target, platform, n) VALUES (?, ?, ?, 1)
              ON CONFLICT(day, target, platform) DO UPDATE SET n = n + 1`).run(ai.istanbulDay(), target, platform);
  res.status(204).end();
});

// Site üretim durumu (yalnızca zaman ve sonuç; günlük metni yok): düzenleme ekranı "Sitede yayında" bildirimini buna göre verir.
api.get("/site/build", (_req, res) => {
  const s = rebuild.state;
  ok(res, { running: s.running, queued: s.queued, lastEnd: s.lastEnd, ok: s.ok });
});

// Panel formlarını doldurmak için (sitede zaten herkese açık olan veri).
api.get("/items/:kind/:id", (req, res) => {
  const { kind } = req.params, id = int(req.params.id);
  if (!C.KINDS.includes(kind) || id == null) return A.fail(res, 404, "Bulunamadı.");
  const item = C.getItem(kind, id);
  if (!item) return A.fail(res, 404, "Bulunamadı.");
  ok(res, { id, values: C.formValues(kind, item), label: item.name || item.title, version: C.itemVersion(kind, id) });
});

// Düzenleme ekranı açıldıktan sonra kayıt başkası tarafından değiştirildiyse 409 (üzerine yazma koruması).
// Sürüm gönderilmeyen eski istemciler için denetim atlanır.
function staleEdit(req, res, kind, id) {
  const sent = req.body?.version;
  if (sent == null || sent === C.itemVersion(kind, id)) return false;
  A.fail(res, 409, "Bu kayıt siz düzenlerken başka biri tarafından değiştirildi. Değişikliklerinizi kaybetmemek için metni kopyalayın, sayfayı yenileyip yeniden deneyin.");
  return true;
}

// ================================================================ hesap
const authLimit = A.rateLimit({ windowMs: 15 * 60e3, max: 12 });

api.post("/auth/register", authLimit, wrap((req, res) => {
  const b = req.body || {};
  if (b.website) return ok(res, { user: null }); // bot tuzağı
  if (!SS.get("registration_open")) return A.fail(res, 403, "Yeni üye kaydı şu anda kapalı.");
  const fields = {};
  const name = String(b.name || "").replace(/\s+/g, " ").trim();
  const email = String(b.email || "").trim().toLowerCase();
  if (name.length < 5 || name.length > 120 || !/\s/.test(name)) fields.name = "Adınızı ve soyadınızı yazın.";
  if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(email) || email.length > 160) fields.email = "Geçerli bir e-posta girin.";
  const pw = A.passwordProblem(b.password);
  if (pw) fields.password = pw;
  if (!b.accept) fields.accept = "Kullanım koşullarını kabul etmelisiniz.";
  const memberId = b.member_id ? int(b.member_id) : null;
  if (b.member_id && (!memberId || !C.getItem("member", memberId))) fields.member_id = "Seçilen akademisyen bulunamadı.";
  if (!fields.email && db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) fields.email = "Bu e-posta ile zaten bir hesap var.";
  if (Object.keys(fields).length) return bad(res, "Lütfen işaretli alanları düzeltin.", fields);

  const info = db.prepare("INSERT INTO users (email, name, title, university, password_hash) VALUES (?, ?, ?, ?, ?)")
    .run(email, name, String(b.title || "").slice(0, 60).trim(), String(b.university || "").slice(0, 160).trim(), A.hashPassword(b.password));
  const userId = Number(info.lastInsertRowid);
  if (memberId) {
    db.prepare("INSERT INTO submissions (user_id, kind, target_id, data, note) VALUES (?, 'claim', ?, '{}', ?)")
      .run(userId, memberId, "Kayıt sırasında profil sahipliği istendi.");
  }
  log(userId, "kayit", email);
  A.createSession(res, userId);
  ok(res, { user: userRow(userId) });
}));

api.post("/auth/login", authLimit, wrap((req, res) => {
  const email = String(req.body?.email || "").trim().toLowerCase();
  const row = db.prepare("SELECT id, password_hash, status FROM users WHERE email = ?").get(email);
  // Kullanıcı yoksa da aynı sürede yanıt vermek için sahte doğrulama yapılır.
  const valid = A.verifyPassword(String(req.body?.password || ""), row?.password_hash || "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$" + "A".repeat(86));
  if (!row || !valid) return A.fail(res, 401, "E-posta veya şifre hatalı.");
  if (row.status === "blocked") return A.fail(res, 403, "Hesabınız erişime kapatılmış. Site yöneticisiyle iletişime geçin.");
  A.createSession(res, row.id);
  log(row.id, "giris");
  ok(res, { user: userRow(row.id) });
}));

api.post("/auth/logout", (req, res) => { A.destroySession(req, res); ok(res); });

api.post("/auth/password", A.requireUser, authLimit, wrap((req, res) => {
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(req.user.id);
  if (!A.verifyPassword(String(req.body?.current || ""), row.password_hash)) return bad(res, "Mevcut şifre hatalı.", { current: "Mevcut şifre hatalı." });
  const problem = A.passwordProblem(req.body?.password);
  if (problem) return bad(res, problem, { password: problem });
  db.prepare("UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?").run(A.hashPassword(req.body.password), req.user.id);
  log(req.user.id, "sifre-degisti");
  ok(res, { user: userRow(req.user.id) });
}));

api.patch("/auth/me", A.requireUser, wrap((req, res) => {
  const name = String(req.body?.name || "").replace(/\s+/g, " ").trim();
  if (name.length < 5 || name.length > 120) return bad(res, "Adınızı ve soyadınızı yazın.", { name: "Adınızı ve soyadınızı yazın." });
  db.prepare("UPDATE users SET name = ?, title = ?, university = ? WHERE id = ?")
    .run(name, String(req.body?.title || "").slice(0, 60).trim(), String(req.body?.university || "").slice(0, 160).trim(), req.user.id);
  ok(res, { user: userRow(req.user.id) });
}));

// ================================================================ dosya yükleme
const IMAGE_SIG = { "image/jpeg": [0xff, 0xd8, 0xff], "image/png": [0x89, 0x50, 0x4e, 0x47], "image/webp": [0x52, 0x49, 0x46, 0x46] };
const EXT = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" };
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => {
      const d = path.join(cfg.UPLOAD_DIR, new Date().toISOString().slice(0, 7));
      fs.mkdirSync(d, { recursive: true }); cb(null, d);
    },
    filename: (_req, file, cb) => cb(null, crypto.randomBytes(12).toString("hex") + EXT[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, !!EXT[file.mimetype]),
});

api.post("/uploads", A.requireActive, A.rateLimit({ windowMs: 60 * 60e3, max: 60, key: (r) => "u" + r.user.id }), (req, res) => {
  upload.single("file")(req, res, (err) => {
    if (err) return bad(res, err.code === "LIMIT_FILE_SIZE" ? "Dosya en fazla 5 MB olabilir." : "Dosya yüklenemedi.");
    if (!req.file) return bad(res, "Yalnızca JPG, PNG veya WEBP görsel yükleyebilirsiniz.");
    const head = Buffer.alloc(4);
    const fd = fs.openSync(req.file.path, "r"); fs.readSync(fd, head, 0, 4, 0); fs.closeSync(fd);
    if (!IMAGE_SIG[req.file.mimetype].every((b, i) => head[i] === b)) {
      fs.rmSync(req.file.path, { force: true });
      return bad(res, "Dosya geçerli bir görsel değil.");
    }
    const rel = path.relative(cfg.UPLOAD_DIR, req.file.path).split(path.sep).join("/");
    log(req.user.id, "yukleme", rel);
    ok(res, { path: "uploads/" + rel });
  });
});

// ================================================================ üye gönderileri
const MEMBER_KINDS = ["member", "work", "topic", "claim"];

api.post("/submissions", A.requireActive, A.rateLimit({ windowMs: 60 * 60e3, max: 40, key: (r) => "s" + r.user.id }), wrap((req, res) => {
  const { kind } = req.body || {};
  if (!SS.get("submissions_open")) return A.fail(res, 403, "Öneri gönderimi şu anda kapalı.");
  const target = req.body?.target_id == null || req.body.target_id === "" ? null : int(req.body.target_id);
  const note = String(req.body?.note || "").slice(0, 2000).trim();
  if (!MEMBER_KINDS.includes(kind)) return bad(res, "Geçersiz gönderi türü.");
  const open = db.prepare("SELECT count(*) AS n FROM submissions WHERE user_id = ? AND status = 'pending'").get(req.user.id).n;
  if (open >= 30) return bad(res, "Onay bekleyen çok sayıda gönderiniz var. Lütfen yöneticinin incelemesini bekleyin.");

  let data = {};
  if (kind === "claim") {
    if (target == null || !C.getItem("member", target)) return bad(res, "Akademisyen bulunamadı.");
    if (req.user.member_id === target) return bad(res, "Bu profil zaten size bağlı.");
  } else {
    // Üyeler yalnızca yeni kayıt önerir. Mevcut kayıtları sahibi olan akademisyen doğrudan, diğerlerini yöneticiler düzenler.
    if (target != null) {
      return A.fail(res, 403, "Mevcut kayıtları yalnızca sahibi olan akademisyen ya da yöneticiler güncelleyebilir. Hata bildirmek için kaydın altına yorum yazabilirsiniz.");
    }
    data = C.normalize(kind, req.body.data || {});
  }
  const info = db.prepare("INSERT INTO submissions (user_id, kind, target_id, data, note) VALUES (?, ?, ?, ?, ?)")
    .run(req.user.id, kind, target, JSON.stringify(data), note);
  log(req.user.id, "gonderi", `${kind}:${target ?? "yeni"}`);
  ok(res, { id: Number(info.lastInsertRowid) });
}));

function submissionView(s) {
  s = plain(s);
  const data = JSON.parse(s.data);
  const kind = s.kind === "claim" ? "member" : s.kind;
  const target = s.target_id != null ? C.getItem(kind, s.target_id) : null;
  return {
    ...s, data,
    target_label: target ? target.name || target.title : null,
    current: target && s.kind !== "claim" ? C.formValues(kind, target) : null,
  };
}

api.get("/my/submissions", A.requireUser, (req, res) => {
  const rows = db.prepare("SELECT * FROM submissions WHERE user_id = ? ORDER BY id DESC LIMIT 200").all(req.user.id);
  ok(res, { items: rows.map(submissionView) });
});

api.delete("/my/submissions/:id", A.requireUser, (req, res) => {
  const n = db.prepare("DELETE FROM submissions WHERE id = ? AND user_id = ? AND status = 'pending'").run(int(req.params.id), req.user.id).changes;
  n ? ok(res) : A.fail(res, 404, "Geri çekilebilecek bir gönderi bulunamadı.");
});

// ================================================================ kendi kayıtları (akademisyen)
const OWN_PERM = { member: "kendi.profil", work: "kendi.eser" };

function ownCheck(req, res) {
  const { kind } = req.params, id = int(req.params.id);
  if (!OWN_PERM[kind] || id == null || !C.getItem(kind, id)) { A.fail(res, 404, "Kayıt bulunamadı."); return null; }
  if (!P.can(req.user, OWN_PERM[kind])) {
    A.fail(res, 403, req.user.member_id ? "Hesabınızın bu kaydı güncelleme yetkisi yok. Site yöneticisine başvurun."
      : "Kendi kayıtlarınızı güncelleyebilmek için önce akademik profilinizi hesabınıza bağlatmalısınız (Akademik profilim → Bu profil benim).");
    return null;
  }
  if (!C.ownsItem(req.user, kind, id)) { A.fail(res, 403, "Bu kayıt size ait değil. Yalnızca kendi profilinizi, kendi eserlerinizi ve kendi eklediğiniz eserleri güncelleyebilirsiniz."); return null; }
  return { kind, id };
}

api.get("/my/items", A.requireActive, (req, res) => {
  ok(res, { items: C.ownItems(req.user), can: { profil: P.can(req.user, "kendi.profil"), eser: P.can(req.user, "kendi.eser") } });
});

api.get("/my/items/:kind/:id", A.requireActive, (req, res) => {
  const t = ownCheck(req, res);
  if (!t) return;
  const item = C.getItem(t.kind, t.id);
  ok(res, { id: t.id, values: C.formValues(t.kind, item), label: item.name || item.title, version: C.itemVersion(t.kind, t.id) });
});

api.put("/my/items/:kind/:id", A.requireActive, A.rateLimit({ windowMs: 60 * 60e3, max: 60, key: (r) => "o" + r.user.id }), wrap((req, res) => {
  const t = ownCheck(req, res);
  if (!t) return;
  if (staleEdit(req, res, t.kind, t.id)) return;
  const existing = C.getItem(t.kind, t.id);
  const fields = C.normalize(t.kind, req.body?.data || {}, { partial: true });
  C.saveItem(t.kind, t.id, C.applyFields(t.kind, existing, fields, req.user), req.user.id);
  log(req.user.id, "kendi-guncelle", `${t.kind}:${t.id} (${Object.keys(fields).join(",")})`);
  rebuild.schedule(`${t.kind}:${t.id} sahibi güncelledi`, 800);
  ok(res, { id: t.id, version: C.itemVersion(t.kind, t.id) });
}));

// ================================================================ yorumlar
const TARGET = /^(work|topic):(\d{1,9})$/;

// Düzenleme: yorumun sahibi (etkin üye) ya da yorum yöneticisi; gizlenen yorumu yalnızca yönetici düzenler.
const canEditComment = (user, c) => !!user && user.status === "active" &&
  (P.can(user, "yorum.yonet") || (Number(c.user_id) === user.id && c.status !== "hidden"));
// "html": sunucuda temizlenmiş gösterim metni (eski düz metin yorumlar da HTML'e çevrilir); "body" eski istemciler için korunur.
const commentOut = (c, user) => ({
  id: c.id, body: c.body, format: c.format, html: C.commentHtml(c.body, c.format), created_at: c.created_at, updated_at: c.updated_at || null,
  ...(c.name !== undefined ? { name: c.name, title: c.title } : { status: c.status }), can_edit: canEditComment(user, c),
  // Silme düğmesi yalnızca yorum yöneticisine gösterilir; silme isteği DELETE /admin/comments/:id'de ayrıca denetlenir.
  can_delete: !!user && user.status === "active" && P.can(user, "yorum.yonet"),
});

api.get("/comments", (req, res) => {
  const t = String(req.query.target || "");
  if (!TARGET.test(t)) return bad(res, "Geçersiz hedef.");
  const rows = db.prepare(
    `SELECT c.id, c.user_id, c.body, c.format, c.status, c.created_at, c.updated_at, u.name, u.title FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.target = ? AND c.status = 'visible' ORDER BY c.id`
  ).all(t).map(plain);
  let mine = [];
  if (req.user) {
    mine = db.prepare("SELECT id, user_id, body, format, created_at, updated_at, status FROM comments WHERE target = ? AND user_id = ? AND status = 'pending' ORDER BY id")
      .all(t, req.user.id).map(plain);
  }
  ok(res, { items: rows.map((c) => commentOut(c, req.user)), pending: mine.map((c) => commentOut(c, req.user)), limits: C.COMMENT_LIMITS });
});

api.post("/comments", A.requireActive, A.rateLimit({ windowMs: 10 * 60e3, max: 10, key: (r) => "c" + r.user.id }), wrap((req, res) => {
  const t = String(req.body?.target || "");
  const m = t.match(TARGET);
  if (!m || !C.getItem(m[1], Number(m[2]))) return bad(res, "Yorum yapılacak içerik bulunamadı.");
  const v = C.commentInput(req.body?.body, req.body?.format);
  if (v.error) return bad(res, v.error, { body: v.error });
  if (!SS.get("comments_enabled")) return A.fail(res, 403, "Yorumlar şu anda kapalı.");
  const status = P.can(req.user, "yorum.yonet") || !SS.get("comments_require_approval") ? "visible" : "pending";
  const info = db.prepare("INSERT INTO comments (target, user_id, body, format, status) VALUES (?, ?, ?, ?, ?)").run(t, req.user.id, v.body, v.format, status);
  log(req.user.id, "yorum", t);
  ok(res, { id: Number(info.lastInsertRowid), status });
}));

api.patch("/comments/:id", A.requireActive, A.rateLimit({ windowMs: 10 * 60e3, max: 20, key: (r) => "ce" + r.user.id }), wrap((req, res) => {
  const c = db.prepare("SELECT id, user_id, status FROM comments WHERE id = ?").get(int(req.params.id));
  if (!c || !canEditComment(req.user, c)) return A.fail(res, 404, "Düzenlenecek yorum bulunamadı.");
  const mod = P.can(req.user, "yorum.yonet");
  if (!mod && !SS.get("comments_enabled")) return A.fail(res, 403, "Yorumlar şu anda kapalı.");
  const v = C.commentInput(req.body?.body, req.body?.format);
  if (v.error) return bad(res, v.error, { body: v.error });
  // Onay gerekiyorsa üyenin değiştirdiği yorum yeniden incelemeye düşer (onaydan sonra içerik değiştirilerek denetim atlatılamasın).
  const status = mod || !SS.get("comments_require_approval") ? c.status : "pending";
  db.prepare("UPDATE comments SET body = ?, format = ?, status = ?, updated_at = datetime('now') WHERE id = ?").run(v.body, v.format, status, c.id);
  log(req.user.id, "yorum-duzenle", `#${c.id}`);
  ok(res, { id: c.id, status });
}));

// ================================================================ yönetim
// Panelin yönetim bölümü: her uç nokta kendi yetkisini ister (bkz. perms.js).
const admin = express.Router();
admin.use(A.requireStaff);
const need = A.requirePerm;
const SUB_KINDS = ["member", "work", "topic", "claim"];

// Kullanıcının yetkili olduğu işlerdeki bekleyen sayılar
function pendingCounts(user) {
  const n = (sql, ...a) => db.prepare(sql).get(...a).n;
  const kinds = SUB_KINDS.filter((k) => P.can(user, "onay." + k));
  return {
    submissions: kinds.length ? n(`SELECT count(*) AS n FROM submissions WHERE status = 'pending' AND kind IN (${kinds.map(() => "?").join(",")})`, ...kinds) : 0,
    users: P.can(user, "uye.onay") || P.can(user, "uye.yonet") ? n("SELECT count(*) AS n FROM users WHERE status = 'pending'") : 0,
    comments: P.can(user, "yorum.yonet") ? n("SELECT count(*) AS n FROM comments WHERE status = 'pending'") : 0,
  };
}

admin.get("/stats", (req, res) => {
  const counts = {};
  for (const k of ["member", "work", "topic", "album"]) counts[k] = db.prepare("SELECT count(*) AS n FROM items WHERE kind = ? AND deleted = 0").get(k).n;
  counts.users = db.prepare("SELECT count(*) AS n FROM users WHERE status = 'active'").get().n;
  counts.staff = db.prepare("SELECT count(*) AS n FROM users WHERE status = 'active' AND role_key != 'uye'").get().n;
  const recent = P.can(req.user, "kayit.gor")
    ? db.prepare("SELECT l.action, l.detail, l.at, u.name FROM logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 15").all().map(plain)
    : [];
  const newUsers = P.can(req.user, "uye.onay") || P.can(req.user, "uye.yonet")
    ? db.prepare("SELECT id, name, email, status, created_at FROM users ORDER BY id DESC LIMIT 5").all().map(plain) : [];
  ok(res, { pending: pendingCounts(req.user), counts, recent, newUsers, build: rebuild.state });
});

// ---- onay kuyruğu
admin.get("/submissions", (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
  const kinds = SUB_KINDS.filter((k) => P.can(req.user, "onay." + k));
  if (!kinds.length) return A.fail(res, 403, "Onay kuyruğunu görme yetkiniz yok.");
  const rows = db.prepare(
    `SELECT s.*, u.name AS user_name, u.email AS user_email, u.member_id AS user_member_id, r.name AS reviewer_name
     FROM submissions s JOIN users u ON u.id = s.user_id LEFT JOIN users r ON r.id = s.reviewed_by
     WHERE s.status = ? AND s.kind IN (${kinds.map(() => "?").join(",")})
     ORDER BY s.id ${status === "pending" ? "ASC" : "DESC"} LIMIT 200`
  ).all(status, ...kinds);
  ok(res, { items: rows.map(submissionView), kinds });
});

function pendingSubmission(req, res) {
  const s = db.prepare("SELECT * FROM submissions WHERE id = ? AND status = 'pending'").get(int(req.params.id));
  if (!s) { A.fail(res, 404, "Onay bekleyen gönderi bulunamadı."); return null; }
  if (!P.can(req.user, "onay." + s.kind)) { A.fail(res, 403, "Bu türdeki önerileri onaylama yetkiniz yok."); return null; }
  return s;
}

admin.post("/submissions/:id/approve", wrap((req, res) => {
  const s = pendingSubmission(req, res);
  if (!s) return;
  const submitter = userRow(s.user_id);
  let resultId = s.target_id;
  db.exec("BEGIN");
  try {
    if (s.kind === "claim") {
      if (!C.getItem("member", s.target_id)) throw new C.ValidationError({ _: "Akademisyen kaydı artık yok." });
      db.prepare("UPDATE users SET member_id = ? WHERE id = ?").run(s.target_id, s.user_id);
      // Profili onaylanan üye akademisyen grubuna geçer (kendi profilini ve eserlerini güncelleyebilir)
      db.prepare("UPDATE users SET role_key = 'akademisyen' WHERE id = ? AND role_key = 'uye'").run(s.user_id);
    } else {
      const existing = s.target_id != null ? C.getItem(s.kind, s.target_id) : null;
      if (s.target_id != null && !existing) throw new C.ValidationError({ _: "Düzeltilecek kayıt artık yok." });
      const fields = C.normalize(s.kind, req.body?.data || JSON.parse(s.data), { partial: !!existing, isAdmin: true });
      const item = C.applyFields(s.kind, existing, fields, submitter);
      resultId = C.saveItem(s.kind, s.target_id, item, req.user.id, s.user_id).id;
    }
    db.prepare("UPDATE submissions SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now'), result_id = ? WHERE id = ?")
      .run(String(req.body?.admin_note || "").slice(0, 1000), req.user.id, resultId ?? null, s.id);
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  log(req.user.id, "onay", `${s.kind}:${resultId ?? ""} (#${s.id})`);
  if (s.kind !== "claim") rebuild.schedule(`gönderi #${s.id}`);
  ok(res, { result_id: resultId });
}));

admin.post("/submissions/:id/reject", (req, res) => {
  const s = pendingSubmission(req, res);
  if (!s) return;
  db.prepare("UPDATE submissions SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ?")
    .run(String(req.body?.admin_note || "").slice(0, 1000), req.user.id, s.id);
  log(req.user.id, "red", `${s.kind} #${s.id}`);
  ok(res);
});

// ---- üyeler
// Bir yetkili, yalnızca kendi yetkilerinin kapsadığı kullanıcıları yönetebilir (üst yetkiliyi engelleyemez/silemez).
const canManage = (actor, target) => target.id !== actor.id && P.covers(actor.perms, P.permsOf(target.role_key));
const activeSupers = () => db.prepare("SELECT count(*) AS n FROM users WHERE role_key = 'super' AND status = 'active'").get().n;

admin.get("/users", need("uye.onay", "uye.yonet", "yetki.yonet"), (req, res) => {
  const where = [], args = [];
  if (["pending", "active", "blocked"].includes(req.query.status)) { where.push("u.status = ?"); args.push(req.query.status); }
  if (req.query.role && P.roles().has(req.query.role)) { where.push("u.role_key = ?"); args.push(req.query.role); }
  if (req.query.staff === "1") where.push("u.role_key != 'uye'");
  const q = String(req.query.q || "").trim().toLocaleLowerCase("tr");
  const rows = db.prepare(
    `SELECT ${A.PUBLIC_USER.split(", ").map((c) => "u." + c).join(", ")},
       (SELECT count(*) FROM submissions s WHERE s.user_id = u.id) AS submission_count,
       (SELECT count(*) FROM comments c WHERE c.user_id = u.id) AS comment_count
     FROM users u ${where.length ? "WHERE " + where.join(" AND ") : ""} ORDER BY u.status = 'pending' DESC, u.id DESC`
  ).all(...args).map(plain).filter((u) => !q || `${u.name} ${u.email} ${u.university}`.toLocaleLowerCase("tr").includes(q));
  for (const u of rows) {
    A.withPerms(u);
    const m = u.member_id ? C.getItem("member", u.member_id) : null;
    u.member_name = m ? m.name : null;
    u.manageable = canManage(req.user, u);
    delete u.perms;
  }
  ok(res, { items: rows });
});

admin.patch("/users/:id", wrap((req, res) => {
  const id = int(req.params.id);
  const u = userRow(id);
  if (!u) return A.fail(res, 404, "Kullanıcı bulunamadı.");
  const b = req.body || {}, me = req.user, sets = {}, notes = [];
  const deny = (msg) => A.fail(res, 403, msg);

  if ("status" in b && b.status !== u.status) {
    if (!["pending", "active", "blocked"].includes(b.status)) return bad(res, "Geçersiz durum.");
    const approving = u.status === "pending" && b.status === "active";
    if (approving ? !(P.can(me, "uye.onay") || P.can(me, "uye.yonet")) : !P.can(me, "uye.yonet")) return deny("Üyelik durumunu değiştirme yetkiniz yok.");
    if (id === me.id) return bad(res, "Kendi hesabınızın durumunu değiştiremezsiniz.");
    if (!approving && !canManage(me, u)) return deny("Sizden daha geniş yetkili bir kişinin durumunu değiştiremezsiniz.");
    if (u.role_key === "super" && b.status !== "active" && activeSupers() <= 1) return bad(res, "Son süper yöneticinin hesabı kapatılamaz.");
    sets.status = b.status; notes.push("durum=" + b.status);
  }
  if ("role_key" in b && b.role_key !== u.role_key) {
    if (!P.can(me, "yetki.yonet")) return deny("Rol atama yetkiniz yok.");
    if (id === me.id) return bad(res, "Kendi rolünüzü değiştiremezsiniz.");
    const role = P.roles().get(b.role_key);
    if (!role) return bad(res, "Rol bulunamadı.");
    if ((b.role_key === "super" || u.role_key === "super") && !P.isSuper(me)) return deny("Süper yönetici rolünü yalnızca bir süper yönetici verebilir ya da kaldırabilir.");
    if (!P.covers(me.perms, P.permsOf(b.role_key))) return deny("Kendinizde olmayan yetkileri içeren bir rolü atayamazsınız.");
    if (!canManage(me, u)) return deny("Sizden daha geniş yetkili bir kişinin rolünü değiştiremezsiniz.");
    if (u.role_key === "super" && activeSupers() <= 1) return bad(res, "Son süper yöneticinin rolü değiştirilemez; önce başka bir süper yönetici atayın.");
    sets.role_key = b.role_key; sets.role = b.role_key === "super" ? "admin" : "member"; notes.push("rol=" + b.role_key);
  }
  const profile = ["name", "email", "title", "university"].filter((k) => k in b && String(b[k] ?? "") !== String(u[k] ?? ""));
  if (profile.length || ("member_id" in b && (b.member_id ?? null) !== (u.member_id ?? null))) {
    if (!P.can(me, "uye.yonet")) return deny("Üye bilgilerini düzenleme yetkiniz yok.");
    if (id !== me.id && !canManage(me, u)) return deny("Sizden daha geniş yetkili bir kişinin bilgilerini düzenleyemezsiniz.");
    const fields = {};
    if (profile.includes("name")) {
      const v = String(b.name).replace(/\s+/g, " ").trim();
      if (v.length < 5 || v.length > 120) fields.name = "Ad soyad 5-120 karakter olmalı."; else sets.name = v;
    }
    if (profile.includes("email")) {
      const v = String(b.email).trim().toLowerCase();
      if (!/^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v)) fields.email = "Geçerli bir e-posta girin.";
      else if (db.prepare("SELECT 1 FROM users WHERE email = ? AND id != ?").get(v, id)) fields.email = "Bu e-posta başka bir hesapta kayıtlı.";
      else sets.email = v;
    }
    if (profile.includes("title")) sets.title = String(b.title || "").slice(0, 60).trim();
    if (profile.includes("university")) sets.university = String(b.university || "").slice(0, 160).trim();
    if ("member_id" in b) {
      const m = b.member_id === null || b.member_id === "" ? null : int(b.member_id);
      if (m != null && !C.getItem("member", m)) fields.member_id = "Akademisyen bulunamadı."; else sets.member_id = m;
    }
    if (Object.keys(fields).length) return bad(res, "Lütfen işaretli alanları düzeltin.", fields);
    notes.push("bilgiler: " + Object.keys(sets).filter((k) => !["status", "role", "role_key"].includes(k)).join(","));
  }
  if (!Object.keys(sets).length) return ok(res, { user: u });
  db.prepare(`UPDATE users SET ${Object.keys(sets).map((k) => k + " = ?").join(", ")} WHERE id = ?`).run(...Object.values(sets), id);
  if (sets.status === "blocked") db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  log(me.id, "uye-guncelle", `${u.email}: ${notes.join("; ")}`);
  ok(res, { user: userRow(id) });
}));

admin.post("/users/bulk-approve", need("uye.onay", "uye.yonet"), (req, res) => {
  const ids = (Array.isArray(req.body?.ids) ? req.body.ids : []).map(int).filter((x) => x != null).slice(0, 500);
  let n = 0;
  for (const id of ids) n += db.prepare("UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending'").run(id).changes;
  if (n) log(req.user.id, "uye-toplu-onay", `${n} üye`);
  ok(res, { approved: n });
});

admin.post("/users/:id/reset-password", need("uye.yonet"), (req, res) => {
  const u = userRow(int(req.params.id));
  if (!u) return A.fail(res, 404, "Kullanıcı bulunamadı.");
  if (!canManage(req.user, u)) return A.fail(res, 403, "Bu kişinin şifresini sıfırlama yetkiniz yok.");
  const abc = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const raw = [...crypto.randomBytes(12)].map((b) => abc[b % abc.length]).join("");
  const temp = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  db.prepare("UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?").run(A.hashPassword(temp), u.id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(u.id);
  log(req.user.id, "sifre-sifirla", u.email);
  ok(res, { temporary_password: temp });
});

admin.delete("/users/:id", need("uye.yonet"), (req, res) => {
  const u = userRow(int(req.params.id));
  if (!u) return A.fail(res, 404, "Kullanıcı bulunamadı.");
  if (u.id === req.user.id) return bad(res, "Kendi hesabınızı silemezsiniz.");
  if (!canManage(req.user, u)) return A.fail(res, 403, "Sizden daha geniş yetkili bir kişiyi silemezsiniz.");
  if (u.role_key === "super" && activeSupers() <= 1) return bad(res, "Son süper yönetici silinemez.");
  db.prepare("DELETE FROM users WHERE id = ?").run(u.id);
  log(req.user.id, "uye-sil", u.email);
  ok(res);
});

// ---- roller ve yetkiler
function roleView(r) {
  const n = db.prepare("SELECT count(*) AS n FROM users WHERE role_key = ?").get(r.key).n;
  return { key: r.key, label: r.label, description: r.description, system: !!r.system, perms: P.permsOf(r.key), all: r.perms.includes("*"), users: n };
}

admin.get("/roles", (_req, res) => {
  ok(res, { roles: [...P.roles().values()].map(roleView), perms: P.PERMS });
});

function roleInput(req, res) {
  const label = String(req.body?.label || "").replace(/\s+/g, " ").trim();
  const description = String(req.body?.description || "").replace(/\s+/g, " ").trim().slice(0, 200);
  const perms = [...new Set((Array.isArray(req.body?.perms) ? req.body.perms : []).filter((p) => P.PERMS[p]))];
  if (label.length < 2 || label.length > 40) { bad(res, "Rol adı 2-40 karakter olmalı.", { label: "Rol adı 2-40 karakter olmalı." }); return null; }
  if (!P.covers(req.user.perms, perms)) { A.fail(res, 403, "Kendinizde olmayan bir yetkiyi role ekleyemezsiniz."); return null; }
  return { label, description, perms };
}

admin.post("/roles", need("yetki.yonet"), (req, res) => {
  const r = roleInput(req, res);
  if (!r) return;
  let key = P.slug(r.label), i = 2;
  while (P.roles().has(key)) key = `${P.slug(r.label)}-${i++}`;
  db.prepare("INSERT INTO roles (key, label, description, perms) VALUES (?, ?, ?, ?)").run(key, r.label, r.description, JSON.stringify(r.perms));
  P.invalidate();
  log(req.user.id, "rol-ekle", `${key}: ${r.perms.join(",")}`);
  ok(res, { role: roleView(P.roles().get(key)) });
});

admin.put("/roles/:key", need("yetki.yonet"), (req, res) => {
  const cur = P.roles().get(req.params.key);
  if (!cur) return A.fail(res, 404, "Rol bulunamadı.");
  if (cur.system) return bad(res, "Sistem rolleri (Süper Yönetici, Üye) değiştirilemez.");
  if (!P.covers(req.user.perms, P.permsOf(cur.key))) return A.fail(res, 403, "Sizden daha geniş yetkili bir rolü düzenleyemezsiniz.");
  const r = roleInput(req, res);
  if (!r) return;
  db.prepare("UPDATE roles SET label = ?, description = ?, perms = ? WHERE key = ?").run(r.label, r.description, JSON.stringify(r.perms), cur.key);
  P.invalidate();
  log(req.user.id, "rol-duzenle", `${cur.key}: ${r.perms.join(",")}`);
  ok(res, { role: roleView(P.roles().get(cur.key)) });
});

admin.delete("/roles/:key", need("yetki.yonet"), (req, res) => {
  const cur = P.roles().get(req.params.key);
  if (!cur) return A.fail(res, 404, "Rol bulunamadı.");
  if (cur.system) return bad(res, "Sistem rolleri silinemez.");
  if (!P.covers(req.user.perms, P.permsOf(cur.key))) return A.fail(res, 403, "Sizden daha geniş yetkili bir rolü silemezsiniz.");
  const n = db.prepare("SELECT count(*) AS n FROM users WHERE role_key = ?").get(cur.key).n;
  if (n) return bad(res, `Bu role sahip ${n} kişi var. Önce onlara başka bir rol atayın.`);
  db.prepare("DELETE FROM roles WHERE key = ?").run(cur.key);
  P.invalidate();
  log(req.user.id, "rol-sil", cur.key);
  ok(res);
});

// ---- site ayarları
admin.get("/settings", need("site.ayar", "ai.ayar"), (req, res) => {
  const groups = SS.GROUPS.filter((g) => P.can(req.user, g.perm));
  ok(res, { groups, values: SS.all() });
});

admin.put("/settings", need("site.ayar", "ai.ayar"), (req, res) => {
  try {
    const changes = SS.save(req.body?.values, req.user, (perm) => P.can(req.user, perm));
    const keys = Object.keys(changes);
    if (keys.length) {
      log(req.user.id, "ayar", keys.join(", "));
      if (keys.some((k) => ["videos_playlists", "home_show_videos", "gallery_show_videos", "gallery_channel"].includes(k))) {
        // video kaynakları değişti: videoları hemen çek, ardından siteyi üret
        require("./videos").refreshFromSettings(SS).catch(() => {}).then(() => rebuild.schedule("video listesi", 0));
      } else if (keys.some((k) => SS.FIELDS[k].group !== "asistan" && SS.FIELDS[k].group !== "uyelik")) rebuild.schedule("site ayarları", 500);
    }
    ok(res, { values: SS.all(), changed: keys });
  } catch (e) {
    if (e instanceof SS.SettingsError) return bad(res, e.message, e.fields);
    throw e;
  }
});

// ---- kategoriler ve menü
// Bir haberin kategorisini seçmek yeterlidir: kategori sayfası, sayfalardaki bölümler ve menü site üretilirken kendiliğinden dolar.
const catBad = (res, e) => (e instanceof CAT.CategoryError ? bad(res, e.message, e.fields) : null);

admin.get("/categories", need("site.ayar"), (_req, res) => {
  ok(res, { items: CAT.list(), counts: CAT.counts(), fields: CAT.FIELDS, groups: CAT.GROUPS, pages: CAT.menuPages() });
});

admin.post("/categories", need("site.ayar"), (req, res) => {
  try {
    const c = CAT.create(req.body?.data, req.user);
    log(req.user.id, "kategori-ekle", `${c.key} (${c.name})${c.menu_show ? " · menüde" : ""}`);
    rebuild.schedule(`kategori ${c.key} eklendi`, 500);
    ok(res, { item: c });
  } catch (e) { if (!catBad(res, e)) throw e; }
});

admin.put("/categories/:key", need("site.ayar"), (req, res) => {
  try {
    const before = CAT.get(req.params.key);
    const c = CAT.update(req.params.key, req.body?.data, req.user);
    if (!c) return A.fail(res, 404, "Kategori bulunamadı.");
    const changed = Object.keys(req.body?.data || {}).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(c[k]));
    log(req.user.id, "kategori-duzenle", `${c.key} (${changed.join(",") || "değişiklik yok"})`);
    if (changed.length) rebuild.schedule(`kategori ${c.key} düzenlendi`, 500);
    ok(res, { item: c, changed });
  } catch (e) { if (!catBad(res, e)) throw e; }
});

admin.delete("/categories/:key", need("site.ayar"), (req, res) => {
  const r = CAT.remove(req.params.key);
  if (r.error) return A.fail(res, r.status, r.error);
  log(req.user.id, "kategori-sil", req.params.key);
  rebuild.schedule(`kategori ${req.params.key} silindi`, 500);
  ok(res);
});

admin.put("/menu", need("site.ayar"), (req, res) => {
  try {
    CAT.saveMenu(req.body?.items, req.user);
    log(req.user.id, "menu-duzenle", `${(req.body.items || []).filter((i) => i.menu_show).length} öğe menüde`);
    rebuild.schedule("menü düzenlendi", 500);
    ok(res, { items: CAT.list(), pages: CAT.menuPages() });
  } catch (e) { if (!catBad(res, e)) throw e; }
});

// ---- işlem kayıtları
// Paylaşım tıklaması istatistikleri (işlem kayıtlarını görme yetkisiyle)
admin.get("/shares", need("kayit.gor"), (req, res) => {
  const days = Math.max(1, Math.min(366, int(req.query.days) || 30));
  const from = ai.istanbulDay(new Date(Date.now() - (days - 1) * 864e5));
  const all = (sql, ...a) => db.prepare(sql).all(...a).map(plain);
  const top = all(`SELECT target, sum(n) AS n FROM share_clicks WHERE day >= ? GROUP BY target ORDER BY n DESC LIMIT 25`, from)
    .map((r) => ({ ...r, ...(shareTarget(r.target) || { title: "(kaldırılmış içerik)", url: "", kind: r.target.split(":")[0] }) }));
  const byTarget = all(`SELECT target, platform, sum(n) AS n FROM share_clicks WHERE day >= ? GROUP BY target, platform`, from);
  for (const t of top) t.platforms = Object.fromEntries(byTarget.filter((x) => x.target === t.target).map((x) => [x.platform, x.n]));
  ok(res, {
    range: { from, to: ai.istanbulDay(), days },
    total: db.prepare("SELECT coalesce(sum(n), 0) AS n FROM share_clicks WHERE day >= ?").get(from).n,
    allTime: db.prepare("SELECT coalesce(sum(n), 0) AS n FROM share_clicks").get().n,
    byPlatform: all(`SELECT platform, sum(n) AS n FROM share_clicks WHERE day >= ? GROUP BY platform ORDER BY n DESC`, from),
    byKind: all(`SELECT substr(target, 1, instr(target, ':') - 1) AS kind, sum(n) AS n FROM share_clicks WHERE day >= ? GROUP BY kind ORDER BY n DESC`, from),
    byDay: all(`SELECT day, sum(n) AS n FROM share_clicks WHERE day >= ? GROUP BY day ORDER BY day`, from),
    byMonth: all(`SELECT substr(day, 1, 7) AS month, sum(n) AS n FROM share_clicks GROUP BY month ORDER BY month DESC LIMIT 12`),
    top,
  });
});

admin.get("/logs", need("kayit.gor"), (req, res) => {
  const where = [], args = [];
  if (req.query.action) { where.push("l.action = ?"); args.push(String(req.query.action)); }
  if (req.query.user) { where.push("l.user_id = ?"); args.push(int(req.query.user)); }
  const q = String(req.query.q || "").trim();
  if (q) { where.push("(l.detail LIKE ? OR u.name LIKE ? OR u.email LIKE ?)"); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const offset = int(req.query.offset) || 0;
  const total = db.prepare(`SELECT count(*) AS n FROM logs l LEFT JOIN users u ON u.id = l.user_id ${w}`).get(...args).n;
  const items = db.prepare(`SELECT l.id, l.action, l.detail, l.at, u.name, u.email FROM logs l LEFT JOIN users u ON u.id = l.user_id ${w}
    ORDER BY l.id DESC LIMIT 100 OFFSET ?`).all(...args, offset).map(plain);
  const actions = db.prepare("SELECT action, count(*) AS n FROM logs GROUP BY action ORDER BY action").all().map(plain);
  ok(res, { items, total, actions });
});

// ---- içerik
const kindPerm = (req, res, next) => (C.KINDS.includes(req.params.kind) ? need("icerik." + req.params.kind)(req, res, next) : A.fail(res, 404, "Bulunamadı."));

// cats: kategori anahtarı → ad (haber listelerinde bir kez okunur)
function summary(kind, it, cats = CAT.topicChoices().labels) {
  if (kind === "member") return { id: it.id, title: it.name, sub: [it.title, it.university].filter(Boolean).join(" · ") };
  if (kind === "work") return { id: it.id, title: it.title, sub: [it.author, it.year, it.type].filter(Boolean).join(" · ") };
  return { id: it.id, title: it.title, sub: [cats[it.forum] || it.forum, it.date].filter(Boolean).join(" · ") };
}

admin.get("/items/:kind", kindPerm, (req, res) => {
  const { kind } = req.params;
  const q = String(req.query.q || "").toLocaleLowerCase("tr").trim();
  const cats = CAT.topicChoices().labels;
  let items = C.listItems(kind);
  // ?kat=koordinasyon: yalnızca o kategorideki haberler (alt kategoriler dahil)
  const kat = kind === "topic" ? String(req.query.kat || "") : "";
  if (kat) {
    const keys = new Set([kat, ...CAT.list().filter((c) => c.parent === kat).map((c) => c.key)]);
    items = items.filter((it) => keys.has(it.forum));
  }
  let rows = items.map((it) => summary(kind, it, cats));
  if (q) rows = rows.filter((r) => `${r.title} ${r.sub} ${r.id}`.toLocaleLowerCase("tr").includes(q));
  rows.sort(kind === "member" ? (a, b) => a.title.localeCompare(b.title, "tr") : (a, b) => b.id - a.id);
  const offset = int(req.query.offset) || 0;
  ok(res, { total: rows.length, items: rows.slice(offset, offset + 50), canDelete: P.can(req.user, "icerik.sil") });
});

admin.post("/items/:kind", kindPerm, wrap((req, res) => {
  const { kind } = req.params;
  const fields = C.normalize(kind, req.body?.data || {}, { isAdmin: true });
  const item = C.saveItem(kind, null, C.applyFields(kind, null, fields, req.user), req.user.id);
  log(req.user.id, "icerik-ekle", `${kind}:${item.id}`);
  rebuild.schedule(`${kind}:${item.id} eklendi`);
  ok(res, { id: item.id });
}));

admin.put("/items/:kind/:id", kindPerm, wrap((req, res) => {
  const { kind } = req.params, id = int(req.params.id);
  const existing = id != null ? C.getItem(kind, id) : null;
  if (!existing) return A.fail(res, 404, "Bulunamadı.");
  if (staleEdit(req, res, kind, id)) return;
  // Yalnızca gönderilen (değiştirilen) alanlar işlenir; diğer alanlar, görseller ve videolar olduğu gibi kalır.
  const fields = C.normalize(kind, req.body?.data || {}, { isAdmin: true, partial: true });
  C.saveItem(kind, id, C.applyFields(kind, existing, fields, req.user), req.user.id);
  log(req.user.id, "icerik-duzenle", `${kind}:${id} (${Object.keys(fields).join(",")})`);
  rebuild.schedule(`${kind}:${id} düzenlendi`, 800);
  ok(res, { id, version: C.itemVersion(kind, id) });
}));

admin.delete("/items/:kind/:id", need("icerik.sil"), (req, res) => {
  const { kind } = req.params, id = int(req.params.id);
  if (!C.KINDS.includes(kind) || !C.deleteItem(kind, id, req.user.id)) return A.fail(res, 404, "Bulunamadı.");
  log(req.user.id, "icerik-sil", `${kind}:${id}`);
  rebuild.schedule(`${kind}:${id} silindi`);
  ok(res);
});

// ---- geri dönüşüm kutusu
admin.get("/trash", need("icerik.sil"), (_req, res) => {
  const rows = db.prepare(`SELECT i.kind, i.id, i.data, i.updated_at, u.name AS by_name FROM items i LEFT JOIN users u ON u.id = i.updated_by
    WHERE i.deleted = 1 AND i.kind IN ('member', 'work', 'topic') ORDER BY i.updated_at DESC LIMIT 300`).all();
  const cats = CAT.topicChoices().labels;
  ok(res, { items: rows.map((r) => ({ kind: r.kind, ...summary(r.kind, JSON.parse(r.data), cats), deleted_at: r.updated_at, by_name: r.by_name })) });
});

admin.post("/trash/:kind/:id/restore", need("icerik.sil"), (req, res) => {
  const { kind } = req.params, id = int(req.params.id);
  const n = db.prepare("UPDATE items SET deleted = 0, updated_at = datetime('now'), updated_by = ? WHERE kind = ? AND id = ? AND deleted = 1").run(req.user.id, kind, id).changes;
  if (!n) return A.fail(res, 404, "Geri getirilecek kayıt bulunamadı.");
  log(req.user.id, "icerik-geri-getir", `${kind}:${id}`);
  rebuild.schedule(`${kind}:${id} geri getirildi`);
  ok(res);
});

// ---- yorumlar
admin.get("/comments", need("yorum.yonet"), (req, res) => {
  const status = ["pending", "visible", "hidden"].includes(req.query.status) ? req.query.status : "pending";
  const rows = db.prepare(
    `SELECT c.*, u.name AS user_name, u.email AS user_email FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.status = ? ORDER BY c.id DESC LIMIT 300`
  ).all(status).map(plain);
  for (const r of rows) {
    r.html = C.commentHtml(r.body, r.format);
    const [kind, id] = r.target.split(":");
    const it = C.getItem(kind, Number(id));
    r.target_label = it ? it.title : "(silinmiş içerik)";
    r.target_url = `${kind === "work" ? "eser" : "haber"}/${id}.html`;
  }
  ok(res, { items: rows });
});

admin.patch("/comments/:id", need("yorum.yonet"), (req, res) => {
  const status = req.body?.status;
  if (!["visible", "hidden", "pending"].includes(status)) return bad(res, "Geçersiz durum.");
  const n = db.prepare("UPDATE comments SET status = ? WHERE id = ?").run(status, int(req.params.id)).changes;
  if (!n) return A.fail(res, 404, "Yorum bulunamadı.");
  log(req.user.id, "yorum-" + status, `#${req.params.id}`);
  ok(res);
});

// Kalıcı silme (yorumların yanıtı ya da bağlı kaydı yoktur; görseller yükleme klasöründe kalır, gece yedeğinde de bulunur).
// Denetim kaydına hedef içerik ve yazar yazılır.
admin.delete("/comments/:id", need("yorum.yonet"), (req, res) => {
  const c = db.prepare("SELECT id, target, user_id FROM comments WHERE id = ?").get(int(req.params.id));
  if (!c) return A.fail(res, 404, "Yorum bulunamadı. Daha önce silinmiş olabilir.");
  db.prepare("DELETE FROM comments WHERE id = ?").run(c.id);
  log(req.user.id, "yorum-sil", `#${c.id} ${c.target} (yazar #${c.user_id})`);
  ok(res, { id: c.id });
});

// ---- dışa aktarma (CSV, Excel uyumlu)
function csv(res, name, header, rows) {
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // Excel formül enjeksiyonuna karşı
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const body = [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"` });
  res.send("﻿" + body);
}

admin.get("/export/:what", need("disa.aktar"), (req, res) => {
  const what = req.params.what;
  if (what === "uyeler") {
    if (!P.can(req.user, "uye.yonet")) return A.fail(res, 403, "Üye listesini dışa aktarmak için üye yönetimi yetkisi de gerekir.");
    const rows = db.prepare("SELECT id, name, email, title, university, role_key, status, created_at, last_login FROM users ORDER BY id").all();
    log(req.user.id, "disa-aktar", "uyeler");
    return csv(res, "uyeler", ["No", "Ad Soyad", "E-posta", "Unvan", "Kurum", "Rol", "Durum", "Kayıt", "Son giriş"],
      rows.map((u) => [u.id, u.name, u.email, u.title, u.university, P.roles().get(u.role_key)?.label || u.role_key, u.status, u.created_at, u.last_login]));
  }
  if (what === "akademisyenler") {
    log(req.user.id, "disa-aktar", "akademisyenler");
    return csv(res, "akademisyenler", ["No", "Ad Soyad", "Unvan", "Grup", "Üniversite", "Şehir", "Web", "E-posta"],
      C.listItems("member").sort((a, b) => a.name.localeCompare(b.name, "tr")).map((m) => [m.id, m.name, m.title, m.group, m.university, m.city, m.web, m.email]));
  }
  if (what === "eserler") {
    log(req.user.id, "disa-aktar", "eserler");
    return csv(res, "eserler", ["No", "Başlık", "Yazar", "Kategori", "Tür", "Yıl", "Kurum", "Basım yeri", "Sayfa", "Danışman", "Tam metin"],
      C.listItems("work").sort((a, b) => a.id - b.id).map((w) => [w.id, w.title, w.author, w.category, w.type, w.year, w.institution, w.place, w.pages, w.contributor, w.url]));
  }
  A.fail(res, 404, "Bilinmeyen dışa aktarma.");
});

// ---- site üretimi ve yapay zekâ raporu
admin.get("/build", (_req, res) => ok(res, rebuild.state));
admin.post("/build", need("site.yayin"), (req, res) => { rebuild.schedule("elle başlatıldı", 0); log(req.user.id, "site-uret"); ok(res, rebuild.state); });
admin.get("/ai/usage", need("ai.rapor"), (req, res) => ok(res, ai.report(req.query.days)));

api.use("/admin", admin);

// ================================================================ Akaid Asistanı
api.get("/ai/status", (req, res) => ok(res, ai.status(req.user)));

api.post("/ai/chat", A.requireActive, async (req, res, next) => {
  try {
    ok(res, await ai.chat(req.user, req.body));
  } catch (e) {
    if (e instanceof ai.AiError) return res.status(e.status).json({ error: e.message, reason: e.reason });
    next(e);
  }
});

api.use((_req, res) => A.fail(res, 404, "Bulunamadı."));

module.exports = { api };
