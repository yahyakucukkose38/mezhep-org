// Komut satırı yönetim araçları (sunucuda: docker compose exec app npm run yonetici -- <komut>).
//   olustur <e-posta> "<Ad Soyad>"   yönetici hesabı oluşturur, geçici şifreyi yazdırır
//   sifre <e-posta>                  geçici şifre üretir (ilk girişte değiştirilir)
//   liste                            yöneticileri listeler
const crypto = require("node:crypto");
const { db } = require("./db");
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
} else if (cmd === "liste") {
  for (const r of db.prepare("SELECT email, name, status FROM users WHERE role = 'admin'").all()) console.log(`${r.email}\t${r.name}\t${r.status}`);
} else {
  console.log('Kullanım: npm run yonetici -- olustur <e-posta> "<Ad Soyad>" | sifre <e-posta> | liste');
  process.exit(1);
}
