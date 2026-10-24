// Rol ve yetki sistemi. Her kullanıcının tek bir rolü vardır; rol bir yetki listesi taşır.
// "super" rolü tüm yetkilere sahiptir ("*") ve yalnızca başka bir süper yönetici tarafından atanabilir.
const { db } = require("./db");

const PERMS = {
  "uye.onay": { label: "Üyelik başvurularını onaylama", group: "Üyeler" },
  "uye.yonet": { label: "Üyeleri düzenleme, engelleme, silme ve şifre sıfırlama", group: "Üyeler" },
  "yetki.yonet": { label: "Rolleri tanımlama ve üyelere rol atama", group: "Üyeler" },
  "onay.member": { label: "Akademisyen önerilerini onaylama", group: "Onay kuyruğu" },
  "onay.work": { label: "Eser önerilerini onaylama", group: "Onay kuyruğu" },
  "onay.topic": { label: "Haber ve duyuru önerilerini onaylama", group: "Onay kuyruğu" },
  "onay.claim": { label: "Profil sahiplik taleplerini onaylama", group: "Onay kuyruğu" },
  "icerik.member": { label: "Akademisyen kayıtlarını ekleme ve düzenleme", group: "İçerik" },
  "icerik.work": { label: "Eser kayıtlarını ekleme ve düzenleme", group: "İçerik" },
  "icerik.topic": { label: "Haber ve etkinlikleri ekleme ve düzenleme", group: "İçerik" },
  "icerik.sil": { label: "Kayıt silme ve geri dönüşüm kutusundan geri getirme", group: "İçerik" },
  "yorum.yonet": { label: "Yorumları yayınlama, gizleme ve silme", group: "İçerik" },
  "site.ayar": { label: "Site ayarlarını değiştirme", group: "Site" },
  "site.yayin": { label: "Siteyi elle yeniden üretme", group: "Site" },
  "kayit.gor": { label: "İşlem kayıtlarını görme", group: "Site" },
  "disa.aktar": { label: "Verileri dışa aktarma (CSV)", group: "Site" },
  "ai.rapor": { label: "Yapay zekâ kullanım ve maliyet raporunu görme", group: "Akaid Asistanı" },
  "ai.ayar": { label: "Asistan ayarlarını değiştirme", group: "Akaid Asistanı" },
  // Kendi içeriği: yönetim paneline erişim vermez; yalnızca kişinin kendi kayıtlarını onaysız güncellemesini sağlar.
  "kendi.profil": { label: "Kendi akademik profilini ve özgeçmişini onaysız güncelleme", group: "Kendi içeriği", own: true },
  "kendi.eser": { label: "Kendi eserlerini ve kendi eklediği eserleri onaysız güncelleme", group: "Kendi içeriği", own: true },
};
const ALL = Object.keys(PERMS);
// Yönetim paneline giriş sağlayan yetkiler ("kendi.*" dışındakiler)
const STAFF = ALL.filter((p) => !PERMS[p].own);

const DEFAULT_ROLES = [
  { key: "super", label: "Süper Yönetici", description: "Tüm yetkiler; rolleri ve diğer yöneticileri yönetir.", perms: ["*"], system: 1 },
  { key: "yonetici", label: "Yönetici", description: "Rol yönetimi dışındaki tüm yönetim işleri.", perms: ALL.filter((p) => p !== "yetki.yonet"), system: 0 },
  { key: "editor", label: "Editör", description: "İçerik ve önerileri yönetir; üyelere dokunmaz.",
    perms: ["onay.member", "onay.work", "onay.topic", "icerik.member", "icerik.work", "icerik.topic", "yorum.yonet", "site.yayin"], system: 0 },
  { key: "moderator", label: "Moderatör", description: "Üyelik başvurularını, profil taleplerini ve yorumları yönetir.",
    perms: ["uye.onay", "onay.claim", "yorum.yonet"], system: 0 },
  { key: "akademisyen", label: "Akademisyen", description: "Kendi profilini ve eserlerini onaysız günceller. Profil sahipliği onaylanan üyelere otomatik verilir.",
    perms: ["kendi.profil", "kendi.eser"], system: 0 },
  { key: "uye", label: "Üye", description: "Yalnızca yeni ekleme önerir; öneriler yönetici onayıyla yayınlanır.", perms: [], system: 1 },
];

db.exec(`CREATE TABLE IF NOT EXISTS roles (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  perms       TEXT NOT NULL DEFAULT '[]',
  system      INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
)`);
{
  const ins = db.prepare("INSERT OR IGNORE INTO roles (key, label, description, perms, system) VALUES (?, ?, ?, ?, ?)");
  for (const r of DEFAULT_ROLES) ins.run(r.key, r.label, r.description, JSON.stringify(r.perms), r.system);
  // Eski şema: users.role ('admin'/'member') → users.role_key
  const cols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name);
  if (!cols.includes("role_key")) {
    db.exec("ALTER TABLE users ADD COLUMN role_key TEXT NOT NULL DEFAULT 'uye'");
    db.exec("UPDATE users SET role_key = 'super' WHERE role = 'admin'");
  }
}

let cache = null;
function roles() {
  if (!cache) {
    cache = new Map(db.prepare("SELECT * FROM roles ORDER BY system DESC, label").all().map((r) => {
      const perms = JSON.parse(r.perms);
      return [r.key, { ...r, perms: perms.includes("*") ? ["*"] : perms.filter((p) => PERMS[p]) }];
    }));
  }
  return cache;
}
const invalidate = () => { cache = null; };

// Rolün etkin yetki listesi ("*" tüm yetkilere açılır).
function permsOf(roleKey) {
  const r = roles().get(roleKey);
  if (!r) return [];
  return r.perms.includes("*") ? [...ALL] : r.perms;
}
const can = (user, perm) => !!user && user.status === "active" && !user.must_change && (user.perms || []).includes(perm);
const isStaff = (user) => !!user && (user.perms || []).some((p) => STAFF.includes(p));
const isSuper = (user) => !!user && user.role_key === "super";
// a'nın yetkileri b'nin yetkilerini kapsıyor mu? (yetki yükseltmeyi önlemek için)
const covers = (actorPerms, targetPerms) => targetPerms.every((p) => actorPerms.includes(p));

function slug(label) {
  const s = String(label).toLocaleLowerCase("tr").replace(/ı/g, "i").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  return s || "rol";
}

module.exports = { PERMS, ALL, STAFF, DEFAULT_ROLES, roles, invalidate, permsOf, can, isStaff, isSuper, covers, slug };
