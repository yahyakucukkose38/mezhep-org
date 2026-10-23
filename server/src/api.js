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

const userRow = (id) => plain(db.prepare(`SELECT ${A.PUBLIC_USER} FROM users WHERE id = ?`).get(id));

// ================================================================ genel
api.get("/health", (_req, res) => ok(res, { ok: true }));

api.get("/schema", (_req, res) => ok(res, { schemas: C.SCHEMAS, ranks: C.RANKS, groups: C.GROUPS, workTypes: C.WORK_TYPES, forums: C.FORUMS }));

api.get("/me", (req, res) => {
  if (!req.user) return ok(res, { user: null });
  const out = { user: req.user };
  if (req.user.role === "admin") out.pending = pendingCounts();
  return ok(res, out);
});

api.get("/lookup/members", (req, res) => {
  const q = String(req.query.q || "").toLocaleLowerCase("tr").trim();
  const rows = C.listItems("member")
    .filter((m) => !q || `${m.name} ${m.university}`.toLocaleLowerCase("tr").includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, "tr")).slice(0, 25)
    .map((m) => ({ id: m.id, name: m.name, title: m.title, university: m.university }));
  ok(res, { items: rows });
});

// Panel formlarını doldurmak için (sitede zaten herkese açık olan veri).
api.get("/items/:kind/:id", (req, res) => {
  const { kind } = req.params, id = int(req.params.id);
  if (!C.KINDS.includes(kind) || id == null) return A.fail(res, 404, "Bulunamadı.");
  const item = C.getItem(kind, id);
  if (!item) return A.fail(res, 404, "Bulunamadı.");
  ok(res, { id, values: C.formValues(kind, item), label: item.name || item.title });
});

// ================================================================ hesap
const authLimit = A.rateLimit({ windowMs: 15 * 60e3, max: 12 });

api.post("/auth/register", authLimit, wrap((req, res) => {
  const b = req.body || {};
  if (b.website) return ok(res, { user: null }); // bot tuzağı
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

function diffAgainst(kind, existing, fields) {
  const cur = C.formValues(kind, existing);
  const out = {};
  for (const [k, v] of Object.entries(fields)) if (String(cur[k] ?? "") !== String(v ?? "")) out[k] = v;
  return out;
}

api.post("/submissions", A.requireActive, A.rateLimit({ windowMs: 60 * 60e3, max: 40, key: (r) => "s" + r.user.id }), wrap((req, res) => {
  const { kind } = req.body || {};
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
    let existing = null;
    if (target != null) {
      existing = C.getItem(kind, target);
      if (!existing) return bad(res, "Düzeltilecek kayıt bulunamadı.");
      if (kind === "topic") return bad(res, "Haberlerde düzeltme için yorum yazabilir ya da yöneticiye ulaşabilirsiniz.");
    }
    data = C.normalize(kind, req.body.data || {}, { partial: target != null });
    if (existing) {
      data = diffAgainst(kind, existing, data);
      if (!Object.keys(data).length) return bad(res, "Mevcut kayıtta bir değişiklik yapmadınız.");
    }
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

// ================================================================ yorumlar
const TARGET = /^(work|topic):(\d{1,9})$/;

api.get("/comments", (req, res) => {
  const t = String(req.query.target || "");
  if (!TARGET.test(t)) return bad(res, "Geçersiz hedef.");
  const rows = db.prepare(
    `SELECT c.id, c.body, c.created_at, u.name, u.title FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.target = ? AND c.status = 'visible' ORDER BY c.id`
  ).all(t).map(plain);
  let mine = [];
  if (req.user) {
    mine = db.prepare("SELECT id, body, created_at, status FROM comments WHERE target = ? AND user_id = ? AND status = 'pending' ORDER BY id")
      .all(t, req.user.id).map(plain);
  }
  ok(res, { items: rows, pending: mine });
});

api.post("/comments", A.requireActive, A.rateLimit({ windowMs: 10 * 60e3, max: 10, key: (r) => "c" + r.user.id }), wrap((req, res) => {
  const t = String(req.body?.target || "");
  const m = t.match(TARGET);
  if (!m || !C.getItem(m[1], Number(m[2]))) return bad(res, "Yorum yapılacak içerik bulunamadı.");
  const body = String(req.body?.body || "").replace(/\r/g, "").replace(/\n{3,}/g, "\n\n").trim();
  if (body.length < 3) return bad(res, "Yorum çok kısa.", { body: "Yorum çok kısa." });
  if (body.length > 3000) return bad(res, "Yorum en fazla 3000 karakter olabilir.", { body: "En fazla 3000 karakter." });
  const status = req.user.role === "admin" ? "visible" : "pending";
  const info = db.prepare("INSERT INTO comments (target, user_id, body, status) VALUES (?, ?, ?, ?)").run(t, req.user.id, body, status);
  log(req.user.id, "yorum", t);
  ok(res, { id: Number(info.lastInsertRowid), status });
}));

// ================================================================ yönetim
const admin = express.Router();
admin.use(A.requireAdmin);

function pendingCounts() {
  const n = (sql) => db.prepare(sql).get().n;
  return {
    submissions: n("SELECT count(*) AS n FROM submissions WHERE status = 'pending'"),
    users: n("SELECT count(*) AS n FROM users WHERE status = 'pending'"),
    comments: n("SELECT count(*) AS n FROM comments WHERE status = 'pending'"),
  };
}

admin.get("/stats", (_req, res) => {
  const counts = {};
  for (const k of ["member", "work", "topic", "album"]) counts[k] = db.prepare("SELECT count(*) AS n FROM items WHERE kind = ? AND deleted = 0").get(k).n;
  counts.users = db.prepare("SELECT count(*) AS n FROM users WHERE status = 'active'").get().n;
  const recent = db.prepare(
    "SELECT l.action, l.detail, l.at, u.name FROM logs l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 25"
  ).all().map(plain);
  ok(res, { pending: pendingCounts(), counts, recent, build: rebuild.state });
});

// ---- onay kuyruğu
admin.get("/submissions", (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : "pending";
  const rows = db.prepare(
    `SELECT s.*, u.name AS user_name, u.email AS user_email, u.member_id AS user_member_id
     FROM submissions s JOIN users u ON u.id = s.user_id WHERE s.status = ? ORDER BY s.id ${status === "pending" ? "ASC" : "DESC"} LIMIT 200`
  ).all(status);
  ok(res, { items: rows.map(submissionView) });
});

admin.post("/submissions/:id/approve", wrap((req, res) => {
  const s = db.prepare("SELECT * FROM submissions WHERE id = ? AND status = 'pending'").get(int(req.params.id));
  if (!s) return A.fail(res, 404, "Onay bekleyen gönderi bulunamadı.");
  const submitter = userRow(s.user_id);
  let resultId = s.target_id;
  db.exec("BEGIN");
  try {
    if (s.kind === "claim") {
      if (!C.getItem("member", s.target_id)) throw new C.ValidationError({ _: "Akademisyen kaydı artık yok." });
      db.prepare("UPDATE users SET member_id = ? WHERE id = ?").run(s.target_id, s.user_id);
    } else {
      const existing = s.target_id != null ? C.getItem(s.kind, s.target_id) : null;
      if (s.target_id != null && !existing) throw new C.ValidationError({ _: "Düzeltilecek kayıt artık yok." });
      // Yönetici formu düzenleyip göndermişse onu, yoksa üyenin önerisini işle.
      const fields = req.body?.data
        ? C.normalize(s.kind, req.body.data, { partial: !!existing, isAdmin: true })
        : C.normalize(s.kind, JSON.parse(s.data), { partial: !!existing, isAdmin: true });
      const item = C.applyFields(s.kind, existing, fields, submitter);
      resultId = C.saveItem(s.kind, s.target_id, item, req.user.id).id;
      if (s.kind === "member" && s.target_id == null && !submitter.member_id && req.body?.link_user) {
        db.prepare("UPDATE users SET member_id = ? WHERE id = ?").run(resultId, s.user_id);
      }
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
  const n = db.prepare("UPDATE submissions SET status = 'rejected', admin_note = ?, reviewed_by = ?, reviewed_at = datetime('now') WHERE id = ? AND status = 'pending'")
    .run(String(req.body?.admin_note || "").slice(0, 1000), req.user.id, int(req.params.id)).changes;
  if (!n) return A.fail(res, 404, "Onay bekleyen gönderi bulunamadı.");
  log(req.user.id, "red", `#${req.params.id}`);
  ok(res);
});

// ---- üyeler (hesaplar)
admin.get("/users", (req, res) => {
  const where = ["pending", "active", "blocked"].includes(req.query.status) ? "WHERE u.status = ?" : "";
  const rows = db.prepare(
    `SELECT ${A.PUBLIC_USER.split(", ").map((c) => "u." + c).join(", ")},
       (SELECT count(*) FROM submissions s WHERE s.user_id = u.id) AS submission_count
     FROM users u ${where} ORDER BY u.status = 'pending' DESC, u.id DESC`
  ).all(...(where ? [req.query.status] : [])).map(plain);
  for (const r of rows) {
    const m = r.member_id ? C.getItem("member", r.member_id) : null;
    r.member_name = m ? m.name : null;
  }
  ok(res, { items: rows });
});

admin.patch("/users/:id", wrap((req, res) => {
  const id = int(req.params.id);
  const u = userRow(id);
  if (!u) return A.fail(res, 404, "Kullanıcı bulunamadı.");
  const b = req.body || {};
  if (id === req.user.id && ((b.role && b.role !== "admin") || (b.status && b.status !== "active"))) {
    return bad(res, "Kendi yönetici yetkinizi kaldıramaz ya da hesabınızı kapatamazsınız.");
  }
  if (b.status && !["pending", "active", "blocked"].includes(b.status)) return bad(res, "Geçersiz durum.");
  if (b.role && !["member", "admin"].includes(b.role)) return bad(res, "Geçersiz rol.");
  let memberId = u.member_id;
  if ("member_id" in b) {
    memberId = b.member_id === null || b.member_id === "" ? null : int(b.member_id);
    if (memberId != null && !C.getItem("member", memberId)) return bad(res, "Akademisyen bulunamadı.");
  }
  db.prepare("UPDATE users SET status = ?, role = ?, member_id = ? WHERE id = ?").run(b.status || u.status, b.role || u.role, memberId, id);
  if (b.status === "blocked") db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  log(req.user.id, "uye-guncelle", `${u.email} ${JSON.stringify(b)}`);
  ok(res, { user: userRow(id) });
}));

admin.post("/users/:id/reset-password", (req, res) => {
  const id = int(req.params.id);
  const u = userRow(id);
  if (!u) return A.fail(res, 404, "Kullanıcı bulunamadı.");
  const temp = crypto.randomBytes(9).toString("base64url") + "7";
  db.prepare("UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?").run(A.hashPassword(temp), id);
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
  log(req.user.id, "sifre-sifirla", u.email);
  ok(res, { temporary_password: temp });
});

admin.delete("/users/:id", (req, res) => {
  const id = int(req.params.id);
  if (id === req.user.id) return bad(res, "Kendi hesabınızı silemezsiniz.");
  const u = userRow(id);
  if (!u) return A.fail(res, 404, "Kullanıcı bulunamadı.");
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
  log(req.user.id, "uye-sil", u.email);
  ok(res);
});

// ---- içerik
function summary(kind, it) {
  if (kind === "member") return { id: it.id, title: it.name, sub: [it.title, it.university].filter(Boolean).join(" · ") };
  if (kind === "work") return { id: it.id, title: it.title, sub: [it.author, it.year, it.type].filter(Boolean).join(" · ") };
  return { id: it.id, title: it.title, sub: [C.FORUMS[it.forum] || it.forum, it.date].filter(Boolean).join(" · ") };
}

admin.get("/items/:kind", (req, res) => {
  const { kind } = req.params;
  if (!C.KINDS.includes(kind)) return A.fail(res, 404, "Bulunamadı.");
  const q = String(req.query.q || "").toLocaleLowerCase("tr").trim();
  let rows = C.listItems(kind).map((it) => summary(kind, it));
  if (q) rows = rows.filter((r) => `${r.title} ${r.sub} ${r.id}`.toLocaleLowerCase("tr").includes(q));
  rows.sort(kind === "member" ? (a, b) => a.title.localeCompare(b.title, "tr") : (a, b) => b.id - a.id);
  const offset = int(req.query.offset) || 0;
  ok(res, { total: rows.length, items: rows.slice(offset, offset + 50) });
});

admin.post("/items/:kind", wrap((req, res) => {
  const { kind } = req.params;
  if (!C.KINDS.includes(kind)) return A.fail(res, 404, "Bulunamadı.");
  const fields = C.normalize(kind, req.body?.data || {}, { isAdmin: true });
  const item = C.saveItem(kind, null, C.applyFields(kind, null, fields, req.user), req.user.id);
  log(req.user.id, "icerik-ekle", `${kind}:${item.id}`);
  rebuild.schedule(`${kind}:${item.id} eklendi`);
  ok(res, { id: item.id });
}));

admin.put("/items/:kind/:id", wrap((req, res) => {
  const { kind } = req.params, id = int(req.params.id);
  const existing = C.KINDS.includes(kind) && id != null ? C.getItem(kind, id) : null;
  if (!existing) return A.fail(res, 404, "Bulunamadı.");
  const fields = C.normalize(kind, req.body?.data || {}, { isAdmin: true });
  C.saveItem(kind, id, C.applyFields(kind, existing, fields, req.user), req.user.id);
  log(req.user.id, "icerik-duzenle", `${kind}:${id}`);
  rebuild.schedule(`${kind}:${id} düzenlendi`);
  ok(res, { id });
}));

admin.delete("/items/:kind/:id", (req, res) => {
  const { kind } = req.params, id = int(req.params.id);
  if (!C.KINDS.includes(kind) || !C.deleteItem(kind, id, req.user.id)) return A.fail(res, 404, "Bulunamadı.");
  log(req.user.id, "icerik-sil", `${kind}:${id}`);
  rebuild.schedule(`${kind}:${id} silindi`);
  ok(res);
});

// ---- yorumlar
admin.get("/comments", (req, res) => {
  const status = ["pending", "visible", "hidden"].includes(req.query.status) ? req.query.status : "pending";
  const rows = db.prepare(
    `SELECT c.*, u.name AS user_name, u.email AS user_email FROM comments c JOIN users u ON u.id = c.user_id
     WHERE c.status = ? ORDER BY c.id DESC LIMIT 300`
  ).all(status).map(plain);
  for (const r of rows) {
    const [kind, id] = r.target.split(":");
    const it = C.getItem(kind, Number(id));
    r.target_label = it ? it.title : "(silinmiş içerik)";
    r.target_url = `${kind === "work" ? "eser" : "haber"}/${id}.html`;
  }
  ok(res, { items: rows });
});

admin.patch("/comments/:id", (req, res) => {
  const status = req.body?.status;
  if (!["visible", "hidden", "pending"].includes(status)) return bad(res, "Geçersiz durum.");
  const n = db.prepare("UPDATE comments SET status = ? WHERE id = ?").run(status, int(req.params.id)).changes;
  if (!n) return A.fail(res, 404, "Yorum bulunamadı.");
  log(req.user.id, "yorum-" + status, `#${req.params.id}`);
  ok(res);
});

admin.delete("/comments/:id", (req, res) => {
  const n = db.prepare("DELETE FROM comments WHERE id = ?").run(int(req.params.id)).changes;
  n ? ok(res) : A.fail(res, 404, "Yorum bulunamadı.");
});

// ---- site üretimi
admin.get("/build", (_req, res) => ok(res, rebuild.state));
admin.post("/build", (req, res) => { rebuild.schedule("elle başlatıldı", 0); log(req.user.id, "site-uret"); ok(res, rebuild.state); });

// ---- yapay zekâ kullanım raporu
admin.get("/ai/usage", (req, res) => ok(res, ai.report(req.query.days)));

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
