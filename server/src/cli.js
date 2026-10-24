// Komut satırı yönetim araçları (sunucuda: docker compose exec app npm run yonetici -- <komut>).
//   olustur <e-posta> "<Ad Soyad>"   yönetici hesabı oluşturur, geçici şifreyi yazdırır
//   sifre <e-posta>                  geçici şifre üretir (ilk girişte değiştirilir)
//   liste                            yöneticileri listeler
//   icerik-yenile                    data/*.json'daki düzeltilmiş içeriği veritabanına işler; panelden
//                                    düzenlenmiş/eklenmiş kayıtlara dokunmaz, seed'den çıkarılan kayıtları kaldırır
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config");
const { db, log, SEED_FILES } = require("./db");
const A = require("./auth");

const [cmd, email, name] = process.argv.slice(2);
const temp = () => crypto.randomBytes(9).toString("base64url") + "7";

if (cmd === "olustur" && email) {
  const pw = temp();
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase());
  if (existing) {
    db.prepare("UPDATE users SET role = 'admin', status = 'active', password_hash = ?, must_change = 1 WHERE id = ?").run(A.hashPassword(pw), existing.id);
  } else {
    db.prepare("INSERT INTO users (email, name, password_hash, role, status, must_change) VALUES (?, ?, ?, 'admin', 'active', 1)")
      .run(email.toLowerCase(), name || "Site Yöneticisi", A.hashPassword(pw));
  }
  console.log(`Yönetici hazır: ${email}\nGeçici şifre: ${pw}\n(ilk girişte değiştirilecek)`);
} else if (cmd === "sifre" && email) {
  const pw = temp();
  const n = db.prepare("UPDATE users SET password_hash = ?, must_change = 1 WHERE email = ?").run(A.hashPassword(pw), email.toLowerCase()).changes;
  if (!n) { console.error("Kullanıcı bulunamadı."); process.exit(1); }
  db.prepare("DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)").run(email.toLowerCase());
  console.log(`Geçici şifre: ${pw}`);
} else if (cmd === "icerik-yenile") {
  const stats = { guncellenen: 0, ayni: 0, korunan: 0, eklenen: 0, kaldirilan: 0 };
  const get = db.prepare("SELECT data, updated_by, deleted FROM items WHERE kind = ? AND id = ?");
  const put = db.prepare("INSERT INTO items (kind, id, data) VALUES (?, ?, ?) ON CONFLICT(kind, id) DO UPDATE SET data = excluded.data, deleted = 0, updated_at = datetime('now')");
  db.exec("BEGIN");
  try {
    for (const [kind, file] of Object.entries(SEED_FILES)) {
      const rows = JSON.parse(fs.readFileSync(path.join(cfg.SEED_DIR, file + ".json"), "utf8"));
      const seen = new Set();
      rows.forEach((row, i) => {
        const id = row.id ?? (kind === "album" ? row.cid * 1000 + row.sid : i + 1);
        seen.add(id);
        const cur = get.get(kind, id);
        const data = JSON.stringify({ ...row, id });
        if (cur && cur.updated_by != null) { stats.korunan++; return; }   // panelden düzenlenmiş: dokunma
        if (cur && cur.data === data && !cur.deleted) { stats.ayni++; return; }
        put.run(kind, id, data);
        cur ? stats.guncellenen++ : stats.eklenen++;
      });
      // seed'de artık olmayan ve panelden hiç dokunulmamış kayıtlar (birleştirilen/silinen) kaldırılır
      for (const r of db.prepare("SELECT id FROM items WHERE kind = ? AND deleted = 0 AND updated_by IS NULL").all(kind)) {
        if (!seen.has(r.id)) { db.prepare("UPDATE items SET deleted = 1, updated_at = datetime('now') WHERE kind = ? AND id = ?").run(kind, r.id); stats.kaldirilan++; }
      }
    }
    const pages = fs.readFileSync(path.join(cfg.SEED_DIR, "pages.json"), "utf8");
    const p = get.get("page", 1);
    if (!p || p.updated_by == null) put.run("page", 1, JSON.stringify(JSON.parse(pages)));
    db.exec("COMMIT");
  } catch (e) { db.exec("ROLLBACK"); throw e; }
  log(null, "icerik-yenile", JSON.stringify(stats));
  console.log("İçerik yenilendi:", stats, "\nSiteyi yeniden üretmek için uygulamayı yeniden başlatın ya da panelden 'Siteyi şimdi yeniden üret'.");
} else if (cmd === "liste") {
  for (const r of db.prepare("SELECT email, name, status FROM users WHERE role = 'admin'").all()) console.log(`${r.email}\t${r.name}\t${r.status}`);
} else {
  console.log('Kullanım: npm run yonetici -- olustur <e-posta> "<Ad Soyad>" | sifre <e-posta> | liste | icerik-yenile');
  process.exit(1);
}
