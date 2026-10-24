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
  async call(method, url, body) {
    const h = { "x-mz": "1", "content-type": "application/json" };
    if (this.cookie) h.cookie = this.cookie;
    const r = await fetch(base + "/api" + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
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
  const bad = await U.super.call("PUT", "/admin/settings", { values: { banner_link: "javascript:alert(1)", home_news_count: 99 } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.banner_link && bad.body.fields.home_news_count);
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
