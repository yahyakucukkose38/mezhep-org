// Roller/yetkiler, sahiplik kuralları, site ayarları, geri dönüşüm kutusu, dışa aktarma ve işlem kayıtları.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mezhep-rbac-"));
process.env.MZ_DATA_DIR = TMP;
process.env.PUBLIC_ORIGIN = "http://127.0.0.1";

const { createApp } = require("../src/index");
const { db, seedIfEmpty } = require("../src/db");
const A = require("../src/auth");
const C = require("../src/content");
require("../src/rebuild").schedule = () => {};

let base, server;
class Client {
  constructor() { this.cookie = ""; }
  // raw: FormData (dosya yükleme) olduğu gibi gönderilir
  async call(method, url, body, { raw } = {}) {
    const h = { "x-mz": "1", ...(raw ? {} : { "content-type": "application/json" }) };
    if (this.cookie) h.cookie = this.cookie;
    const r = await fetch(base + "/api" + url, { method, headers: h, body: raw || (body === undefined ? undefined : JSON.stringify(body)) });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await r.text();
    let json = {};
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, text, body: json, type: r.headers.get("content-type") || "" };
  }
}
const PW = "SifreDeneme123";
const U = {};
const id = (email) => db.prepare("SELECT id FROM users WHERE email = ?").get(email).id;

test.before(async () => {
  seedIfEmpty();
  const mk = (key, role, memberId = null) => db.prepare(
    "INSERT INTO users (email, name, password_hash, role_key, status, member_id) VALUES (?, ?, ?, ?, 'active', ?)"
  ).run(key + "@t.local", key[0].toUpperCase() + key.slice(1) + " Deneme", A.hashPassword(PW), role, memberId);
  mk("super", "super"); mk("yonetici", "yonetici"); mk("editor", "editor"); mk("moderator", "moderator");
  mk("hoca", "akademisyen", 10); mk("uye", "uye");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of ["super", "yonetici", "editor", "moderator", "hoca", "uye"]) {
    U[k] = new Client();
    assert.equal((await U[k].call("POST", "/auth/login", { email: k + "@t.local", password: PW })).status, 200, k);
  }
});
test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test("hazır roller ve yetkiler yüklenir", async () => {
  const me = (await U.editor.call("GET", "/me")).body.user;
  assert.equal(me.role_label, "Editör");
  assert.ok(me.perms.includes("onay.work") && !me.perms.includes("uye.onay"));
  const hoca = (await U.hoca.call("GET", "/me")).body;
  assert.deepEqual(hoca.user.perms.sort(), ["kendi.eser", "kendi.profil"]);
  assert.equal(hoca.pending, undefined, "akademisyen yönetici sayılmaz");
  assert.equal((await U.hoca.call("GET", "/admin/stats")).status, 403);
  assert.equal((await U.uye.call("GET", "/admin/stats")).status, 403);
});

test("editör: eser onaylar; üyelere, ayarlara ve rollere erişemez", async () => {
  const s = await U.uye.call("POST", "/submissions", { kind: "work", data: { title: "Editör Testi", author: "Uye Deneme", category: "Kitaplar", type: "Telif" } });
  assert.equal(s.status, 200);
  const q = (await U.editor.call("GET", "/admin/submissions")).body;
  assert.ok(q.kinds.includes("work") && !q.kinds.includes("claim"));
  assert.equal((await U.editor.call("POST", `/admin/submissions/${s.body.id}/approve`, {})).status, 200);
  for (const [m, u] of [["GET", "/admin/users"], ["GET", "/admin/settings"], ["POST", "/admin/roles"], ["GET", "/admin/logs"], ["GET", "/admin/trash"], ["GET", "/admin/ai/usage"]]) {
    assert.equal((await U.editor.call(m, u, m === "POST" ? {} : undefined)).status, 403, `${m} ${u}`);
  }
  assert.equal((await U.editor.call("GET", "/admin/items/work")).status, 200);
});

test("moderatör: üye onaylar ama rol atayamaz ve üye silemez", async () => {
  const c = new Client();
  await c.call("POST", "/auth/register", { name: "Yeni Başvuru", email: "yeni@t.local", password: PW, accept: true });
  const nid = id("yeni@t.local");
  assert.equal((await U.moderator.call("PATCH", `/admin/users/${nid}`, { status: "active" })).status, 200);
  assert.equal((await U.moderator.call("PATCH", `/admin/users/${nid}`, { role_key: "editor" })).status, 403);
  assert.equal((await U.moderator.call("PATCH", `/admin/users/${nid}`, { status: "blocked" })).status, 403, "engelleme uye.yonet ister");
  assert.equal((await U.moderator.call("DELETE", `/admin/users/${nid}`)).status, 403);
});

test("yetki yükseltme engellenir; yönetici rolü rol atayamaz", async () => {
  assert.equal((await U.yonetici.call("PATCH", `/admin/users/${id("uye@t.local")}`, { role_key: "editor" })).status, 403, "yönetici rolünde yetki.yonet yok");
  assert.equal((await U.yonetici.call("PATCH", `/admin/users/${id("super@t.local")}`, { status: "blocked" })).status, 403, "üst yetkiliyi engelleyemez");
  // yalnızca rol atama + üye onay yetkisi olan özel rol
  const r = await U.super.call("POST", "/admin/roles", { label: "Rol Sorumlusu", perms: ["yetki.yonet", "uye.onay"] });
  assert.equal(r.status, 200);
  const key = r.body.role.key;
  assert.equal((await U.super.call("PATCH", `/admin/users/${id("moderator@t.local")}`, { role_key: key })).status, 200);
  const rs = U.moderator; // artık "Rol Sorumlusu"
  assert.equal((await rs.call("PATCH", `/admin/users/${id("uye@t.local")}`, { role_key: "editor" })).status, 403, "kendinde olmayan yetkileri içeren rol");
  assert.equal((await rs.call("PATCH", `/admin/users/${id("uye@t.local")}`, { role_key: "super" })).status, 403);
  assert.equal((await rs.call("POST", "/admin/roles", { label: "Hileli", perms: ["icerik.work"] })).status, 403);
  assert.equal((await rs.call("PATCH", `/admin/users/${id("editor@t.local")}`, { role_key: "uye" })).status, 403, "daha geniş yetkiliyi düşüremez");
  const ok = await rs.call("POST", "/admin/roles", { label: "Onaycı", perms: ["uye.onay"] });
  assert.equal(ok.status, 200);
  assert.equal((await rs.call("PATCH", `/admin/users/${id("uye@t.local")}`, { role_key: ok.body.role.key })).status, 200);
  assert.equal((await U.super.call("DELETE", `/admin/roles/${ok.body.role.key}`)).status, 400, "kullanımdaki rol silinemez");
  assert.equal((await U.super.call("PATCH", `/admin/users/${id("uye@t.local")}`, { role_key: "uye" })).status, 200);
  assert.equal((await U.super.call("DELETE", `/admin/roles/${ok.body.role.key}`)).status, 200);
  assert.equal((await U.super.call("PUT", "/admin/roles/super", { label: "X", perms: [] })).status, 400, "sistem rolü değişmez");
});

test("son süper yönetici korunur; ikinci süper atanınca devredilebilir", async () => {
  const sid = id("super@t.local");
  assert.equal((await U.super.call("PATCH", `/admin/users/${sid}`, { role_key: "uye" })).status, 400, "kendi rolü");
  assert.equal((await U.super.call("PATCH", `/admin/users/${id("yonetici@t.local")}`, { role_key: "super" })).status, 200);
  const two = new Client();
  await two.call("POST", "/auth/login", { email: "yonetici@t.local", password: PW });
  assert.equal((await two.call("PATCH", `/admin/users/${sid}`, { role_key: "yonetici" })).status, 200, "başka süper varken düşürülebilir");
  assert.equal((await two.call("PATCH", `/admin/users/${id("yonetici@t.local")}`, { status: "blocked" })).status, 400);
  assert.equal((await U.super.call("PATCH", `/admin/users/${two.cookie && id("yonetici@t.local")}`, { role_key: "uye" })).status, 403, "artık süper değil");
  // eski hâline döndür
  await two.call("PATCH", `/admin/users/${sid}`, { role_key: "super" });
  await U.super.call("PATCH", `/admin/users/${id("yonetici@t.local")}`, { role_key: "yonetici" });
});

test("akademisyen: kendi eserini ve kendi eklediği eseri düzenler, başkasınınkini düzenleyemez", async () => {
  const ahmet = C.getItem("member", 10).name; // Ahmet İshak Demir
  const own = C.listItems("work").find((w) => w.author === ahmet);
  assert.ok(own, "yazarı Ahmet İshak Demir olan eser");
  const other = C.listItems("work").find((w) => w.author !== ahmet && !w.author.includes("Ahmet İshak"));
  const list = (await U.hoca.call("GET", "/my/items")).body.items;
  assert.ok(list.some((i) => i.kind === "member" && i.id === 10));
  assert.ok(list.some((i) => i.kind === "work" && i.id === own.id));
  assert.ok(!list.some((i) => i.id === other.id));
  assert.equal((await U.hoca.call("PUT", `/my/items/work/${own.id}`, { data: { pages: "1-20" } })).status, 200);
  assert.equal(C.getItem("work", own.id).pages, "1-20");
  assert.equal((await U.hoca.call("PUT", `/my/items/work/${other.id}`, { data: { pages: "1" } })).status, 403);
  // başkasına ait bir eseri ekler; onaylanınca onu da düzenleyebilir
  const s = await U.hoca.call("POST", "/submissions", { kind: "work", data: { title: "Öğrencimin Tezi", author: "Başka Yazar", category: "Tezler", type: "Doktora" } });
  const ap = await U.editor.call("POST", `/admin/submissions/${s.body.id}/approve`, {});
  assert.equal((await U.hoca.call("PUT", `/my/items/work/${ap.body.result_id}`, { data: { year: "2020" } })).status, 200);
  assert.equal(C.getItem("work", ap.body.result_id).year, 2020);
  // normal üye kendi eklediğini bile doğrudan düzenleyemez
  const us = await U.uye.call("POST", "/submissions", { kind: "work", data: { title: "Üye Eseri", author: "Uye Deneme", category: "Kitaplar", type: "Telif" } });
  const ap2 = await U.editor.call("POST", `/admin/submissions/${us.body.id}/approve`, {});
  assert.equal((await U.uye.call("PUT", `/my/items/work/${ap2.body.result_id}`, { data: { year: "2020" } })).status, 403);
  assert.equal((await U.uye.call("POST", "/submissions", { kind: "work", target_id: ap2.body.result_id, data: { year: "2021" } })).status, 403);
});

test("site ayarları: yetki, doğrulama ve etkisi", async () => {
  assert.equal((await U.editor.call("PUT", "/admin/settings", { values: { registration_open: false } })).status, 403);
  const bad = await U.super.call("PUT", "/admin/settings", { values: { banner_link: "javascript:alert(1)", home_quote: "x".repeat(400) } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.banner_link && bad.body.fields.home_quote);
  assert.equal((await U.super.call("PUT", "/admin/settings", { values: { registration_open: false, comments_require_approval: false, banner_enabled: true, banner_text: "Duyuru" } })).status, 200);
  assert.equal((await new Client().call("POST", "/auth/register", { name: "Kapalı Kayıt", email: "k@t.local", password: PW, accept: true })).status, 403);
  const c = await U.uye.call("POST", "/comments", { target: "work:656", body: "Onaysız yorum" });
  assert.equal(c.body.status, "visible");
  const pub = (await new Client().call("GET", "/site-settings")).body;
  assert.equal(pub.registration_open, false);
  assert.ok(!("ai_monthly_budget" in pub) && !("banner_text" in pub), "yalnızca herkese açık alanlar");
  // asistan ayarları ayrı yetki ister
  const yon = await U.yonetici.call("GET", "/admin/settings");
  assert.ok(yon.body.groups.some((g) => g.key === "asistan"));
  assert.equal((await U.super.call("PUT", "/admin/settings", { values: { registration_open: true, comments_require_approval: true, banner_enabled: false } })).status, 200);
  // dışa aktarılan ayarlar site üreteci içindir
  C.exportAll(path.join(TMP, "json"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(TMP, "json", "settings.json"), "utf8")).banner_text, "Duyuru");
});

test("video modülü: oynatma listesi doğrulaması ve RSS ayrıştırma", async () => {
  const r = await U.super.call("PUT", "/admin/settings", { values: { videos_playlists: "PLgecerli1234567890abc\njavascript:alert(1)" } });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.videos_playlists);
  const v = require("../src/videos");
  const feed = `<feed><title>Ahmet İshak DEMİR Kısa Kısa</title>
    <entry><yt:videoId>UMgez7HGUEw</yt:videoId><title>Her İyilik &amp; İyilik midir?</title><published>2026-03-08T10:00:00+00:00</published></entry>
    <entry><yt:videoId>kötü</yt:videoId><title>x</title></entry></feed>`;
  const p = v.parseFeed("PLx", feed);
  assert.equal(p.title, "Ahmet İshak DEMİR Kısa Kısa");
  assert.deepEqual(p.videos, [{ id: "UMgez7HGUEw", title: "Her İyilik & İyilik midir?", published: "2026-03-08" }]);
});

test("geri dönüşüm kutusu: silinen kayıt geri getirilir", async () => {
  assert.equal((await U.editor.call("DELETE", "/admin/items/work/656")).status, 403, "silme ayrı yetki");
  assert.equal((await U.yonetici.call("DELETE", "/admin/items/work/656")).status, 200);
  assert.equal(C.getItem("work", 656), null);
  const t = (await U.yonetici.call("GET", "/admin/trash")).body.items;
  assert.ok(t.some((x) => x.kind === "work" && x.id === 656));
  assert.equal((await U.yonetici.call("POST", "/admin/trash/work/656/restore")).status, 200);
  assert.ok(C.getItem("work", 656));
});

test("CSV dışa aktarma: yetki ve formül enjeksiyonu koruması", async () => {
  assert.equal((await U.editor.call("GET", "/admin/export/eserler")).status, 403);
  db.prepare("UPDATE users SET name = ? WHERE email = 'uye@t.local'").run("=HYPERLINK(\"http://x\")");
  const r = await U.super.call("GET", "/admin/export/uyeler");
  assert.equal(r.status, 200);
  assert.match(r.type, /text\/csv/);
  assert.ok(r.text.includes("'=HYPERLINK"), "formül hücresi metne çevrilir");
  const w = await U.yonetici.call("GET", "/admin/export/eserler");
  assert.equal(w.status, 200);
  assert.ok(w.text.split("\r\n").length > 300);
});

test("işlem kayıtları: yetkiliye açık, filtrelenebilir", async () => {
  assert.equal((await U.editor.call("GET", "/admin/logs")).status, 403);
  const r = await U.super.call("GET", "/admin/logs?action=kendi-guncelle");
  assert.equal(r.status, 200);
  assert.ok(r.body.items.length >= 2 && r.body.items.every((x) => x.action === "kendi-guncelle"));
  assert.ok(r.body.actions.some((a) => a.action === "rol-ekle"));
});

test("yorum silme: yalnızca yöneticiler (yorum.sil); mantıksal silme, geri getirme ve denetim kaydı", async () => {
  // önceki rol testleri moderatör hesabının rolünü değiştiriyor; burada yeniden Moderatör rolü
  db.prepare("UPDATE users SET role_key = 'moderator' WHERE email = 'moderator@t.local'").run();
  const mk = async (who, body) => {
    const r = await U[who].call("POST", "/comments", { target: "topic:265", body: `<p>${body}</p>`, format: "html" });
    assert.equal(r.status, 200, r.body.error);
    db.prepare("UPDATE comments SET status = 'visible' WHERE id = ?").run(r.body.id);
    return r.body.id;
  };
  const a = await mk("uye", "Üyenin yorumu"), b = await mk("hoca", "Hocanın yorumu"), c = await mk("super", "Yöneticinin yorumu");
  const row = (cid) => db.prepare("SELECT * FROM comments WHERE id = ?").get(cid);
  const list = async (who) => ((who ? U[who] : new Client()).call("GET", "/comments?target=topic:265")).then((r) => r.body.items);
  // düğme bayrağı: yalnızca Süper Yönetici ve Yönetici
  const flag = async (who) => (await list(who)).find((x) => x.id === a);
  for (const who of ["super", "yonetici"]) assert.equal((await flag(who)).can_delete, true, who);
  for (const who of ["editor", "moderator", "hoca", "uye", null]) assert.equal((await flag(who)).can_delete, false, String(who));
  assert.equal((await flag("uye")).can_edit, true, "düzenleme yetkisi değişmedi");
  assert.equal((await flag("moderator")).can_edit, true, "moderatör düzenlemeye devam eder");

  // yetkisiz istekler reddedilir; yorumlar yerinde kalır
  assert.equal((await new Client().call("DELETE", `/admin/comments/${b}`)).status, 401);
  for (const who of ["uye", "hoca"]) assert.equal((await U[who].call("DELETE", `/admin/comments/${b}`)).status, 403, who);
  assert.equal((await U.uye.call("DELETE", `/admin/comments/${a}`)).status, 403, "üye kendi yorumunu da bu uçtan silemez");
  for (const who of ["editor", "moderator"]) assert.equal((await U[who].call("DELETE", `/admin/comments/${b}`)).status, 403, who + " yorum yayınlar/gizler ama silemez");
  const noCsrf = await fetch(base + `/api/admin/comments/${b}`, { method: "DELETE", headers: { cookie: U.super.cookie } });
  assert.equal(noCsrf.status, 403, "x-mz başlığı olmayan istek (CSRF)");
  assert.ok(!row(a).deleted_at && !row(b).deleted_at && !row(c).deleted_at);

  // yönetici siler: kayıt silinmez, işaretlenir; yalnızca o yorum etkilenir
  const total = db.prepare("SELECT count(*) AS n FROM comments").get().n;
  const r = await U.yonetici.call("DELETE", `/admin/comments/${b}`);
  assert.equal(r.status, 200, r.body.error);
  assert.equal(r.body.id, b);
  assert.equal(db.prepare("SELECT count(*) AS n FROM comments").get().n, total, "hiçbir kayıt silinmedi");
  assert.ok(row(b).deleted_at && row(b).deleted_by === id("yonetici@t.local"));
  assert.equal(row(b).body, "<p>Hocanın yorumu</p>");
  assert.ok(!row(a).deleted_at && !row(c).deleted_at);
  // silinen yorum hiçbir yerde görünmez, düzenlenemez, durumu değiştirilemez
  for (const who of [null, "hoca", "super"]) assert.ok(!(await list(who)).some((x) => x.id === b), String(who));
  assert.equal((await U.hoca.call("PATCH", `/comments/${b}`, { body: "<p>x</p>", format: "html" })).status, 404);
  assert.equal((await U.super.call("PATCH", `/admin/comments/${b}`, { status: "visible" })).status, 404);
  assert.ok(!(await U.moderator.call("GET", "/admin/comments?status=visible")).body.items.some((x) => x.id === b));
  // Silinenler: yalnızca yorum.sil
  assert.equal((await U.moderator.call("GET", "/admin/comments?status=deleted")).status, 403);
  const del = (await U.super.call("GET", "/admin/comments?status=deleted")).body.items.find((x) => x.id === b);
  assert.ok(del && del.deleted_by_name === "Yonetici Deneme" && del.html === "<p>Hocanın yorumu</p>");
  // ikinci kez silme ve geçersiz kimlikler
  assert.equal((await U.super.call("DELETE", `/admin/comments/${b}`)).status, 404);
  assert.equal((await U.super.call("DELETE", "/admin/comments/abc")).status, 404);
  assert.equal((await U.super.call("DELETE", "/admin/comments/999999")).status, 404);
  // geri getirme: yalnızca yorum.sil; önceki durumuyla döner
  assert.equal((await U.moderator.call("POST", `/admin/comments/${b}/restore`)).status, 403);
  assert.equal((await U.super.call("POST", `/admin/comments/${a}/restore`)).status, 404, "silinmemiş yorum");
  assert.equal((await U.super.call("POST", `/admin/comments/${b}/restore`)).status, 200);
  assert.ok(!row(b).deleted_at && row(b).status === "visible");
  assert.ok((await list(null)).some((x) => x.id === b));
  // denetim kaydı: kim, hangi yorum, hangi içerik, kimin yorumu
  const logs = db.prepare("SELECT user_id, action, detail FROM logs WHERE action IN ('yorum-sil', 'yorum-geri') ORDER BY id DESC LIMIT 2").all().map((x) => ({ ...x }));
  assert.deepEqual(logs[1], { user_id: id("yonetici@t.local"), action: "yorum-sil", detail: `#${b} topic:265 (yazar #${id("hoca@t.local")})` });
  assert.deepEqual(logs[0], { user_id: id("super@t.local"), action: "yorum-geri", detail: `#${b} topic:265` });
});

test("yorum.sil yetkisi var olan Yönetici rolüne bir kez eklenir; Editör ve Moderatöre eklenmez", () => {
  const P = require("../src/perms");
  const perms = (k) => JSON.parse(db.prepare("SELECT perms FROM roles WHERE key = ?").get(k).perms);
  assert.ok(P.permsOf("yonetici").includes("yorum.sil") && P.permsOf("super").includes("yorum.sil"));
  assert.ok(!P.permsOf("editor").includes("yorum.sil") && !P.permsOf("moderator").includes("yorum.sil"));
  assert.ok(db.prepare("SELECT 1 FROM migrations WHERE name = 'yorum-sil-yetkisi'").get());
  // geçiş tekrar çalışmaz: rol ekranından kaldırılan yetki geri eklenmez
  db.prepare("UPDATE roles SET perms = ? WHERE key = 'yonetici'").run(JSON.stringify(perms("yonetici").filter((p) => p !== "yorum.sil")));
  delete require.cache[require.resolve("../src/perms")];
  require("../src/perms");
  assert.ok(!perms("yonetici").includes("yorum.sil"));
});

test("galeri, kaynaklar ve Hakkında: Editör ekler ve düzenler, silemez; diğerleri dokunamaz", async () => {
  const P = require("../src/perms");
  for (const p of ["icerik.album", "icerik.kaynak", "icerik.sayfa"]) {
    assert.ok(P.permsOf("editor").includes(p) && P.permsOf("yonetici").includes(p) && P.permsOf("super").includes(p), p);
    assert.ok(!P.permsOf("moderator").includes(p) && !P.permsOf("akademisyen").includes(p) && !P.permsOf("uye").includes(p), p);
  }
  for (const kind of ["album", "link", "file", "page"]) {
    assert.equal((await U.editor.call("GET", `/admin/items/${kind}`)).status, 200, kind);
    for (const who of ["moderator", "hoca", "uye"]) assert.equal((await U[who].call("GET", `/admin/items/${kind}`)).status, 403, `${who} ${kind}`);
    assert.equal((await new Client().call("GET", `/admin/items/${kind}`)).status, 401);
  }
  // mevcut kayıtlar panelde listelenir
  assert.equal((await U.editor.call("GET", "/admin/items/album")).body.total, C.listItems("album").length);
  assert.equal((await U.editor.call("GET", "/admin/items/link")).body.total, 8);

  // bağlantı: adres doğrulanır
  assert.equal((await U.editor.call("POST", "/admin/items/link", { data: { name: "Kötü", url: "javascript:alert(1)", category: "Dergiler" } })).status, 400);
  const l = await U.editor.call("POST", "/admin/items/link", { data: { name: "İLAM Araştırma Dergisi", url: "https://dergipark.org.tr/tr/pub/ilam", category: "Dergiler", desc: "Hakemli dergi" } });
  assert.equal(l.status, 200, l.text);
  assert.equal(C.getItem("link", l.body.id).url, "https://dergipark.org.tr/tr/pub/ilam");
  const f = await U.editor.call("POST", "/admin/items/file", { data: { name: "Transkripsiyon kılavuzu", url: "https://ornek.edu.tr/kilavuz.pdf", category: "Belgeler", date: "2026-10-29" } });
  assert.equal(f.status, 200, f.text);
  assert.equal(C.getItem("file", f.body.id).date, "29.10.2026");

  // albüm: fotoğraf yolu güvenliği
  const png = new FormData();
  png.append("file", new Blob([Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0a50000000049454e44ae426082", "hex")], { type: "image/png" }), "a.png");
  const up = await U.editor.call("POST", "/uploads", undefined, { raw: png });
  assert.equal(up.status, 200, up.text);
  for (const src of ["../../etc/passwd.jpg", "uploads/../../gizli.jpg", "https://kotu.example/x.jpg", "uploads/x.svg", "javascript:alert(1)"]) {
    const r = await U.editor.call("POST", "/admin/items/album", { data: { event: "Deneme 2026", name: "Açılış", photos: [{ title: "x", src }] } });
    assert.equal(r.status, 400, src);
  }
  // yeni etkinlik: yeni etkinlik numarası; aynı etkinlikteki ikinci albüm aynı numarayı alır; adres numaradan türer
  const maxCid = Math.max(...C.listItems("album").map((a) => a.cid));
  const a1 = await U.editor.call("POST", "/admin/items/album", { data: { event: "Deneme 2026", name: "Açılış", photos: [{ title: "Açılış <b>konuşması</b>", src: "/" + up.body.path }] } });
  assert.equal(a1.status, 200, a1.text);
  const al = C.getItem("album", a1.body.id);
  assert.equal(al.cid, maxCid + 1);
  assert.equal(a1.body.id, al.cid * 1000 + al.sid);
  assert.deepEqual(al.photos, [{ title: "Açılış <b>konuşması</b>", thumb: up.body.path, src: up.body.path }]);
  const a2 = await U.editor.call("POST", "/admin/items/album", { data: { event: "Deneme 2026", name: "Oturumlar", photos: [] } });
  assert.equal(C.getItem("album", a2.body.id).cid, al.cid);
  // düzenleme: fotoğraf sırası ve açıklama; adres değişmez
  const g = await U.editor.call("GET", `/items/album/${a1.body.id}`);
  assert.equal(g.body.label, "Deneme 2026 — Açılış");
  const photos = [{ title: "İkinci", src: up.body.path }, { ...g.body.values.photos[0], title: "Açılış" }];
  assert.equal((await U.editor.call("PUT", `/admin/items/album/${a1.body.id}`, { data: { photos }, version: g.body.version })).status, 200);
  assert.deepEqual(C.getItem("album", a1.body.id).photos.map((p) => p.title), ["İkinci", "Açılış"]);
  assert.equal(C.getItem("album", a1.body.id).cid, al.cid);

  // Hakkında: tek kayıt; düzenlenir, eklenemez, silinemez
  const pg = await U.editor.call("GET", "/items/page/1");
  assert.ok(pg.body.values.about_html.includes("Mezhepler Tarihi"), "mevcut metin panelde görünür");
  assert.equal((await U.editor.call("PUT", "/admin/items/page/1", { data: { about_lead: "Yeni giriş cümlesi.", about_html: "<p>Yeni <script>x</script>amaç metni.</p>" }, version: pg.body.version })).status, 200);
  assert.equal(C.getItem("page", 1).about_html, "<p>Yeni amaç metni.</p>");
  assert.ok(C.getItem("page", 1).policy, "kullanım koşulları korunur");
  assert.equal((await U.super.call("POST", "/admin/items/page", { data: { about_lead: "x" } })).status, 400);
  assert.equal((await U.super.call("DELETE", "/admin/items/page/1")).status, 400);

  // silme: Editör silemez; Yönetici siler, geri dönüşüm kutusundan geri gelir
  assert.equal((await U.editor.call("DELETE", `/admin/items/link/${l.body.id}`)).status, 403);
  assert.equal((await U.yonetici.call("DELETE", `/admin/items/album/${a2.body.id}`)).status, 200);
  assert.ok((await U.yonetici.call("GET", "/admin/trash")).body.items.some((x) => x.kind === "album" && x.id === a2.body.id));
  assert.equal((await U.yonetici.call("POST", `/admin/trash/album/${a2.body.id}/restore`)).status, 200);
  assert.ok(C.getItem("album", a2.body.id));

  // site üreteci: kaydedilenler sayfalarda
  const cfg = require("../src/config"), rebuild = require("../src/rebuild");
  await rebuild.run();
  assert.ok(rebuild.state.ok, rebuild.state.log);
  const page = (p) => fs.readFileSync(path.join(cfg.SITE_DIR, p), "utf8");
  assert.ok(page("galeri.html").includes("Deneme 2026"));
  assert.ok(page(`galeri/${al.cid}-${al.sid}.html`).includes(up.body.path));
  assert.ok(page("baglantilar.html").includes('href="https://dergipark.org.tr/tr/pub/ilam"') && page("kaynaklar.html").includes('href="https://ornek.edu.tr/kilavuz.pdf"'));
  assert.ok(page("baglantilar.html").includes('href="https://dergipark.org.tr/tr/pub/kader"'), "taşınan eski adresler");
  assert.ok(page("hakkinda.html").includes("Yeni giriş cümlesi.") && page("hakkinda.html").includes("Yeni amaç metni."));
});

test("bağlantı adresleri ve Hakkında metni var olan veritabanına bir kez, yalnızca boşsa doldurulur", () => {
  const cfg = require("../src/config");
  const k = C.listItems("link").find((x) => x.name === "KADER");
  db.prepare("UPDATE items SET data = ? WHERE kind = 'link' AND id = ?").run(JSON.stringify({ ...k, url: "" }), k.id);
  const pg = C.getItem("page", 1);
  db.prepare("UPDATE items SET data = ? WHERE kind = 'page' AND id = 1").run(JSON.stringify({ ...pg, about_lead: "" }));
  const done = C.fillFromSeed(cfg.SEED_DIR);
  assert.ok(done.includes("link:" + k.id) && done.includes("page:1"), done.join());
  assert.equal(C.getItem("link", k.id).url, "https://dergipark.org.tr/tr/pub/kader");
  assert.ok(C.getItem("page", 1).about_lead.includes("Koordinasyon Sitesi"));
  assert.equal(C.getItem("page", 1).about_html, "<p>Yeni amaç metni.</p>", "dolu alana dokunulmaz");
  assert.deepEqual(C.fillFromSeed(cfg.SEED_DIR), [], "yapılacak iş kalmadı");
});
