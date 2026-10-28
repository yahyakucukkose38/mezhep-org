// Uçtan uca API testleri: geçici bir veri klasöründe gerçek uygulamayı çalıştırır.
// Çalıştırma: cd server && npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mezhep-test-"));
process.env.MZ_DATA_DIR = TMP;
process.env.PUBLIC_ORIGIN = "http://127.0.0.1";

const { createApp } = require("../src/index");
const { db, seedIfEmpty } = require("../src/db");
const A = require("../src/auth");
const C = require("../src/content");
const rebuild = require("../src/rebuild");
rebuild.schedule = () => {}; // testlerde site üretimi çalıştırılmaz

let base, server;
class Client {
  constructor() { this.cookie = ""; }
  async call(method, url, body, { headers = {}, raw } = {}) {
    const h = { "x-mz": "1", ...headers };
    if (this.cookie) h.cookie = this.cookie;
    let payload;
    if (raw) payload = raw;
    else if (body !== undefined) { h["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const r = await fetch(base + "/api" + url, { method, headers: h, body: payload });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    return { status: r.status, body: await r.json().catch(() => ({})) };
  }
}

test.before(async () => {
  seedIfEmpty();
  db.prepare("INSERT INTO users (email, name, password_hash, role, role_key, status) VALUES (?, ?, ?, 'admin', 'super', 'active')")
    .run("admin@test.local", "Yönetici Kişi", A.hashPassword("YoneticiSifre123"));
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

const admin = new Client(), uye = new Client();

test("içerik ilk çalıştırmada aktarılır", () => {
  assert.ok(C.listItems("member").length > 100);
  assert.ok(C.listItems("work").length > 300);
  assert.ok(C.getItem("work", 656).title.includes("Abdulcebbar"));
});

test("x-mz başlığı olmayan değişiklik isteği reddedilir (CSRF)", async () => {
  const r = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 403);
  const r2 = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json", "x-mz": "1", origin: "https://kotu.example" }, body: "{}" });
  assert.equal(r2.status, 403);
});

test("zayıf şifre ve eksik alanlarla kayıt reddedilir", async () => {
  const r = await new Client().call("POST", "/auth/register", { name: "Ali", email: "x", password: "123", accept: false });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.name && r.body.fields.email && r.body.fields.password && r.body.fields.accept);
});

test("kayıt olan üye onay bekler ve gönderi yapamaz", async () => {
  const r = await uye.call("POST", "/auth/register", {
    name: "Zeynep Deneme", email: "Zeynep@Test.local", password: "GucluSifre42", accept: true, member_id: 10, title: "Dr.", university: "Test Ü.",
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.status, "pending");
  const s = await uye.call("POST", "/submissions", { kind: "work", data: { title: "X" } });
  assert.equal(s.status, 403);
  const dup = await new Client().call("POST", "/auth/register", { name: "Başka Kişi", email: "zeynep@test.local", password: "GucluSifre42", accept: true });
  assert.equal(dup.status, 400);
  assert.ok(dup.body.fields.email);
});

test("yanlış şifreyle giriş başarısız, doğrusuyla başarılı", async () => {
  assert.equal((await admin.call("POST", "/auth/login", { email: "admin@test.local", password: "yanlis-sifre-1" })).status, 401);
  const r = await admin.call("POST", "/auth/login", { email: "ADMIN@test.local", password: "YoneticiSifre123" });
  assert.equal(r.status, 200);
  assert.equal(r.body.user.role_key, "super");
  assert.ok(r.body.user.perms.includes("yetki.yonet"));
});

test("üye yönetim uçlarına erişemez", async () => {
  assert.equal((await uye.call("GET", "/admin/stats")).status, 403);
  assert.equal((await new Client().call("GET", "/admin/users")).status, 401); // oturum yok: giriş gerekir
});

test("yönetici üyeyi onaylar; kayıttaki profil talebi kuyruğa düşer", async () => {
  const users = (await admin.call("GET", "/admin/users?status=pending")).body.items;
  const z = users.find((u) => u.email === "zeynep@test.local");
  assert.ok(z);
  assert.equal((await admin.call("PATCH", `/admin/users/${z.id}`, { status: "active" })).status, 200);
  const q = (await admin.call("GET", "/admin/submissions")).body.items;
  const claim = q.find((s) => s.kind === "claim" && s.target_id === 10);
  assert.ok(claim);
  assert.equal((await admin.call("POST", `/admin/submissions/${claim.id}/approve`, {})).status, 200);
  const me = (await uye.call("GET", "/me")).body.user;
  assert.equal(me.status, "active");
  assert.equal(me.member_id, 10);
  assert.equal(me.role_key, "akademisyen", "profil sahipliği onaylanan üye akademisyen olur");
});

test("yeni eser önerisi temizlenir, onaylanınca içeriğe eklenir", async () => {
  const r = await uye.call("POST", "/submissions", {
    kind: "work", note: "kendi tezim",
    data: {
      title: "Deneme Tezi", author: "Zeynep Deneme", category: "Tezler", type: "Doktora", year: "2024",
      ozet: '<p onclick="x()">Özet <script>alert(1)</script><a href="javascript:alert(1)">kötü</a> <a href="https://ornek.org">iyi</a></p>',
    },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = (await admin.call("GET", "/admin/submissions")).body.items.find((x) => x.id === r.body.id);
  assert.ok(!/script|onclick|javascript/i.test(s.data.ozet), s.data.ozet);
  assert.match(s.data.ozet, /href="https:\/\/ornek\.org" target="_blank"/);
  const ok = await admin.call("POST", `/admin/submissions/${s.id}/approve`, {});
  assert.equal(ok.status, 200);
  const w = C.getItem("work", ok.body.result_id);
  assert.equal(w.title, "Deneme Tezi");
  assert.equal(w.year, 2024);
  assert.equal(w.category, "Tezler");
});

test("geçersiz tür ve yıl alan alan hata verir", async () => {
  const r = await uye.call("POST", "/submissions", { kind: "work", data: { title: "A", author: "B", category: "Tezler", type: "Telif", year: "abc" } });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.year);
  const r2 = await uye.call("POST", "/submissions", { kind: "work", data: { title: "A", author: "B", category: "Tezler", type: "Telif" } });
  assert.ok(r2.body.fields.type);
});

test("mevcut kayda öneri gönderilemez; akademisyen kendi profilini doğrudan günceller", async () => {
  const cur = (await uye.call("GET", "/my/items/member/10")).body.values;
  assert.equal((await uye.call("POST", "/submissions", { kind: "member", target_id: 10, data: { ...cur, city: "X" } })).status, 403);
  const r = await uye.call("PUT", "/my/items/member/10", { data: { ...cur, city: "Rize Merkez", group: "Emekliler" } });
  assert.equal(r.status, 200, r.body.error);
  assert.equal(C.getItem("member", 10).city, "Rize Merkez");
  assert.equal(C.getItem("member", 10).group, "Öğretim Elemanları", "grup alanı yalnızca yöneticide");
  assert.equal((await uye.call("PUT", "/my/items/member/11", { data: { city: "Y" } })).status, 403, "başkasının profili");
});

test("üye grup alanını değiştiremez; haber yalnızca izinli bölümlere gönderilir", async () => {
  const r = await uye.call("POST", "/submissions", { kind: "topic", data: { title: "Duyuru", forum: "sss", body: "<p>metin</p>" } });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.forum);
  const ok = await uye.call("POST", "/submissions", { kind: "topic", data: { title: "Yeni Doktor: Deneme", forum: "haber", body: "<p>Tebrikler.</p>" } });
  assert.equal(ok.status, 200);
  const res = await admin.call("POST", `/admin/submissions/${ok.body.id}/approve`, {});
  const t = C.getItem("topic", res.body.result_id);
  assert.equal(t.posts[0].author, "Zeynep Deneme");
  assert.equal(t.summary, "Tebrikler.");
});

test("yorum onaydan sonra görünür; yönetici gizleyebilir", async () => {
  const c = await uye.call("POST", "/comments", { target: "work:656", body: "Çok faydalı bir çalışma." });
  assert.equal(c.status, 200);
  assert.equal(c.body.status, "pending");
  const anon = new Client();
  assert.equal((await anon.call("GET", "/comments?target=work:656")).body.items.length, 0);
  assert.equal((await uye.call("GET", "/comments?target=work:656")).body.pending.length, 1);
  await admin.call("PATCH", `/admin/comments/${c.body.id}`, { status: "visible" });
  const vis = (await anon.call("GET", "/comments?target=work:656")).body.items;
  assert.equal(vis.length, 1);
  assert.equal(vis[0].name, "Zeynep Deneme");
  assert.equal((await uye.call("POST", "/comments", { target: "work:999999", body: "olmayan" })).status, 400);
});

test("zengin metin yorum: biçim korunur, zararlı HTML sunucuda temizlenir", async () => {
  const body = '<h2>Başlık</h2><p><strong>Kalın</strong> ve <em>italik</em> <a href="https://ornek.org/kaynak">kaynak</a></p>' +
    '<ul><li>bir</li></ul><ol><li>iki</li></ol><blockquote>alıntı</blockquote>' +
    '<p><img src="/uploads/2026-10/0123456789abcdef01234567.jpg" alt=""></p>' +
    '<p>video: </p>&lt;iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"&gt;&lt;/iframe&gt;' +
    '<script>alert(1)</script><p onclick="alert(1)" style="color:red">olay</p><img src="x" onerror="alert(1)">' +
    '<a href="javascript:alert(1)">js</a><a href="//kotu.example">pr</a><iframe src="https://kotu.example/x"></iframe>' +
    '<img src="https://kotu.example/izle.gif"><svg onload="alert(1)"></svg><form action="/x"><input></form>';
  const c = await admin.call("POST", "/comments", { target: "work:656", body, format: "html" });
  assert.equal(c.status, 200, c.body.error);
  assert.equal(c.body.status, "visible", "yorum yöneticisinin yorumu doğrudan yayında");
  const row = db.prepare("SELECT body, format FROM comments WHERE id = ?").get(c.body.id);
  assert.equal(row.format, "html");
  for (const bad of ["<script", "onclick", "onerror", "style=", "javascript:", "kotu.example", "<svg", "<form", "<input"]) assert.ok(!row.body.includes(bad), bad + " temizlenmeli");
  for (const good of ["<h2>Başlık</h2>", "<strong>Kalın</strong>", "<em>italik</em>", "<ul><li>bir</li></ul>", "<ol><li>iki</li></ol>", "<blockquote>alıntı</blockquote>",
    'rel="nofollow ugc noopener noreferrer"', 'src="/uploads/2026-10/0123456789abcdef01234567.jpg"', "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"]) assert.ok(row.body.includes(good), good + " korunmalı");
  // yeniden okunduğunda (sayfa yenilenince) aynı biçimle gelir
  const got = (await new Client().call("GET", "/comments?target=work:656")).body;
  const mine = got.items.find((x) => x.id === c.body.id);
  assert.equal(mine.html, row.body);
  assert.equal(mine.can_edit, false, "ziyaretçi düzenleyemez");
  assert.equal(got.limits.text, 3000);
});

test("eski düz metin yorumlar kaçışlanarak paragraflara bölünür", async () => {
  const r = db.prepare("INSERT INTO comments (target, user_id, body, status) VALUES ('work:656', 1, ?, 'visible')").run("Eski <b>yorum</b>\nikinci satır\n\nyeni paragraf");
  const it = (await new Client().call("GET", "/comments?target=work:656")).body.items.find((x) => x.id === Number(r.lastInsertRowid));
  assert.equal(it.format, "text");
  assert.equal(it.html, "<p>Eski &lt;b&gt;yorum&lt;/b&gt;<br>ikinci satır</p><p>yeni paragraf</p>");
  assert.equal(it.body, "Eski <b>yorum</b>\nikinci satır\n\nyeni paragraf", "eski API alanı korunur");
});

test("yorum düzenleme: yalnızca sahibi ya da yorum yöneticisi; onaylı yorum yeniden incelemeye düşer", async () => {
  const c = await uye.call("POST", "/comments", { target: "topic:265", body: "<p>İlk hâli</p>", format: "html" });
  assert.equal(c.status, 200, c.body.error);
  await admin.call("PATCH", `/admin/comments/${c.body.id}`, { status: "visible" });
  let list = (await uye.call("GET", "/comments?target=topic:265")).body.items;
  assert.equal(list.find((x) => x.id === c.body.id).can_edit, true);

  // başka bir üye düzenleyemez
  db.prepare("INSERT INTO users (email, name, password_hash, role_key, status) VALUES ('baska@test.local', 'Başka Üye', ?, 'uye', 'active')").run(A.hashPassword("BaskaSifre12345"));
  const baska = new Client();
  assert.equal((await baska.call("POST", "/auth/login", { email: "baska@test.local", password: "BaskaSifre12345" })).status, 200);
  assert.equal((await baska.call("GET", "/comments?target=topic:265")).body.items.find((x) => x.id === c.body.id).can_edit, false);
  assert.equal((await baska.call("PATCH", `/comments/${c.body.id}`, { body: "<p>ele geçirildi</p>", format: "html" })).status, 404);
  assert.equal((await new Client().call("PATCH", `/comments/${c.body.id}`, { body: "<p>x</p>", format: "html" })).status, 401);

  // sahibi düzenler: biçim kaydedilir, onay gerektiği için yeniden incelemeye düşer
  const e = await uye.call("PATCH", `/comments/${c.body.id}`, { body: '<p><strong>Düzeltilmiş</strong> hâli</p><img src=x onerror="alert(1)">', format: "html" });
  assert.equal(e.status, 200, e.body.error);
  assert.equal(e.body.status, "pending");
  let row = db.prepare("SELECT body, status, updated_at, target, user_id, created_at FROM comments WHERE id = ?").get(c.body.id);
  assert.equal(row.body, "<p><strong>Düzeltilmiş</strong> hâli</p>");
  assert.ok(row.updated_at);
  assert.equal(row.target, "topic:265"); // yazar, hedef ve tarih korunur
  const pend = (await uye.call("GET", "/comments?target=topic:265")).body.pending.find((x) => x.id === c.body.id);
  assert.ok(pend && pend.can_edit && pend.updated_at);

  // yönetici düzenlemesi durumu değiştirmez
  await admin.call("PATCH", `/admin/comments/${c.body.id}`, { status: "visible" });
  assert.equal((await admin.call("PATCH", `/comments/${c.body.id}`, { body: "<p>Yönetici düzeltmesi</p>", format: "html" })).body.status, "visible");
  // gizlenen yorumu sahibi düzenleyemez
  await admin.call("PATCH", `/admin/comments/${c.body.id}`, { status: "hidden" });
  assert.equal((await uye.call("PATCH", `/comments/${c.body.id}`, { body: "<p>geri</p>", format: "html" })).status, 404);
  // yönetim listesi temizlenmiş HTML'i verir
  const adm = (await admin.call("GET", "/admin/comments?status=hidden")).body.items.find((x) => x.id === c.body.id);
  assert.equal(adm.html, "<p>Yönetici düzeltmesi</p>");
});

test("yorum sınırları: uzunluk, görsel ve video sayısı, boş içerik", async () => {
  const post = (body) => admin.call("POST", "/comments", { target: "work:656", body, format: "html" });
  assert.equal((await post("<p>" + "a".repeat(3001) + "</p>")).status, 400);
  assert.equal((await post("<p><br></p><p>  </p>")).status, 400);
  assert.equal((await post("<script>alert('uzun bir zararlı kod')</script>")).status, 400, "temizlendikten sonra boş kalan yorum");
  const img = '<p><img src="/uploads/2026-10/0123456789abcdef01234567.png"></p>';
  assert.equal((await post(img.repeat(7))).status, 400);
  assert.equal((await post(img)).status, 200, "yalnızca görsel içeren yorum");
  const vid = '<figure class="media-video"><iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0"></iframe></figure>';
  assert.equal((await post(vid.repeat(4))).status, 400);
});

test("yükleme yalnızca gerçek görsel kabul eder", async () => {
  const fake = new FormData();
  fake.append("file", new Blob(["<?php echo 1; ?>"], { type: "image/png" }), "x.png");
  assert.equal((await uye.call("POST", "/uploads", undefined, { raw: fake })).status, 400);
  // SVG (betik taşıyabilir), HTML ve uzantısı değiştirilmiş dosyalar kabul edilmez
  for (const [data, type, name] of [['<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', "image/svg+xml", "x.svg"], ["<html><script>alert(1)</script>", "text/html", "x.html"],
    ["<script>alert(1)</script>", "image/jpeg", "x.jpg"], ["GIF89a", "image/gif", "x.gif"]]) {
    const f = new FormData(); f.append("file", new Blob([data], { type }), name);
    assert.equal((await uye.call("POST", "/uploads", undefined, { raw: f })).status, 400, name);
  }
  // 5 MB sınırı
  const big = new FormData(); big.append("file", new Blob([Buffer.alloc(5 * 1024 * 1024 + 10, 0xff)], { type: "image/jpeg" }), "b.jpg");
  assert.equal((await uye.call("POST", "/uploads", undefined, { raw: big })).status, 400);
  assert.equal((await new Client().call("POST", "/uploads", undefined, { raw: fake })).status, 401, "giriş yapmamış kullanıcı yükleyemez");
  const png = new FormData();
  png.append("file", new Blob([Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a0a50000000049454e44ae426082", "hex")], { type: "image/png" }), "a.png");
  const r = await uye.call("POST", "/uploads", undefined, { raw: png });
  assert.equal(r.status, 200);
  assert.match(r.body.path, /^uploads\/\d{4}-\d{2}\/[a-f0-9]{24}\.png$/);
  assert.ok(fs.existsSync(path.join(TMP, r.body.path)));
});

test("geçici şifre sonrası şifre değişikliği zorunlu", async () => {
  const z = (await admin.call("GET", "/admin/users")).body.items.find((u) => u.email === "zeynep@test.local");
  const t = (await admin.call("POST", `/admin/users/${z.id}/reset-password`)).body.temporary_password;
  const c = new Client();
  assert.equal((await c.call("POST", "/auth/login", { email: "zeynep@test.local", password: t })).body.user.must_change, 1);
  assert.equal((await c.call("POST", "/submissions", { kind: "claim", target_id: 11 })).status, 403);
  assert.equal((await c.call("POST", "/auth/password", { current: t, password: "YeniGuclu2025" })).status, 200);
  assert.equal((await c.call("GET", "/me")).body.user.must_change, 0);
});

test("yönetici kendi yetkisini kaldıramaz; engellenen üye giriş yapamaz", async () => {
  const me = (await admin.call("GET", "/me")).body.user;
  assert.equal((await admin.call("PATCH", `/admin/users/${me.id}`, { role_key: "uye" })).status, 400);
  const z = (await admin.call("GET", "/admin/users")).body.items.find((u) => u.email === "zeynep@test.local");
  await admin.call("PATCH", `/admin/users/${z.id}`, { status: "blocked" });
  assert.equal((await uye.call("GET", "/me")).body.user, null);
  assert.equal((await new Client().call("POST", "/auth/login", { email: "zeynep@test.local", password: "YeniGuclu2025" })).status, 403);
});

test("dışa aktarım site üreteci biçiminde JSON yazar", () => {
  const dir = path.join(TMP, "json");
  C.exportAll(dir);
  for (const f of ["members", "works", "topics", "albums", "links", "files", "pages"]) assert.ok(fs.existsSync(path.join(dir, f + ".json")), f);
  const works = JSON.parse(fs.readFileSync(path.join(dir, "works.json"), "utf8"));
  assert.ok(works.some((w) => w.title === "Deneme Tezi"));
});
