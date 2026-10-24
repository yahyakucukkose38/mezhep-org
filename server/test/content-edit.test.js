// İçerik düzenleme: rol bazlı yetki (sunucu tarafı), üzerine yazma koruması, yalnızca değişen alanların işlenmesi,
// metin içi video (güvenli sağlayıcı listesi) ve önbellek başlıkları.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mezhep-edit-"));
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
    return { status: r.status, text, body: json };
  }
}
const PW = "SifreDeneme123";
const U = {};
const YT = "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0";
let topicId, workId;

test.before(async () => {
  seedIfEmpty();
  // yalnızca eser düzenleyebilen özel bir rol: haber düzenleyememeli
  db.prepare("INSERT INTO roles (key, label, perms) VALUES ('eserci', 'Eser Editörü', ?)").run(JSON.stringify(["icerik.work"]));
  const mk = (key, role) => db.prepare("INSERT INTO users (email, name, password_hash, role_key, status) VALUES (?, ?, ?, ?, 'active')")
    .run(key + "@t.local", key[0].toUpperCase() + key.slice(1) + " Deneme", A.hashPassword(PW), role);
  mk("super", "super"); mk("yonetici", "yonetici"); mk("editor", "editor"); mk("eserci", "eserci"); mk("hoca", "akademisyen"); mk("uye", "uye");
  topicId = C.listItems("topic")[0].id;
  workId = C.listItems("work")[0].id;
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of ["super", "yonetici", "editor", "eserci", "hoca", "uye"]) {
    U[k] = new Client();
    assert.equal((await U[k].call("POST", "/auth/login", { email: k + "@t.local", password: PW })).status, 200, k);
  }
  U.anon = new Client();
});
test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

// ---------------------------------------------------------------- video
test("video bağlantıları tanınır: YouTube, youtu.be, Shorts, embed, Vimeo; diğerleri reddedilir", () => {
  const p = C.parseVideo;
  assert.deepEqual(p("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s"), { provider: "youtube", id: "dQw4w9WgXcQ", short: false });
  assert.equal(p("https://youtu.be/dQw4w9WgXcQ?si=abc").id, "dQw4w9WgXcQ");
  assert.equal(p("https://youtube.com/shorts/dQw4w9WgXcQ").short, true);
  assert.equal(p("https://m.youtube.com/watch?feature=share&v=dQw4w9WgXcQ").id, "dQw4w9WgXcQ");
  assert.equal(p("https://www.youtube.com/embed/dQw4w9WgXcQ?si=x").id, "dQw4w9WgXcQ");
  assert.deepEqual(p("https://vimeo.com/123456789/abcdef1234"), { provider: "vimeo", id: "123456789", hash: "abcdef1234" });
  assert.equal(p("https://player.vimeo.com/video/123456789").id, "123456789");
  for (const bad of ["https://evil.example/embed/dQw4w9WgXcQ", "javascript:alert(1)", "https://www.youtube.com/watch?v=short", "https://dailymotion.com/video/x8"]) assert.equal(p(bad), null, bad);
});

test("metin temizleme: gömme kodu güvenli oynatıcıya çevrilir, yabancı iframe ve öznitelikler atılır", () => {
  // YouTube'un "Yerleştir" kodu (kullanıcının yapıştırdığı biçim)
  const code = '<p>Giriş</p><iframe width="560" height="315" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=Ab" title="YouTube video player" frameborder="0" allow="autoplay" onload="alert(1)" allowfullscreen></iframe>';
  const h = C.cleanHtml(code);
  assert.match(h, new RegExp(`<figure class="media-video"><iframe src="${YT.replace(/[?.]/g, "\\$&")}"`));
  assert.ok(!/onload|width=|frameborder|youtube\.com\/embed/.test(h), h);
  // düz metin olarak yapıştırılmış kod (editörde metin olarak görünen hâl) da dönüştürülür
  const asText = C.cleanHtml('<p>Sitemiz güncelleniyor. &lt;iframe width="560" src="https://www.youtube.com/embed/dQw4w9WgXcQ?si=x" allowfullscreen&gt;&lt;/iframe&gt;</p>');
  assert.match(asText, /<p>Sitemiz güncelleniyor\.\s*<\/p><figure class="media-video"><iframe src="https:\/\/www\.youtube-nocookie\.com/);
  assert.ok(!/&lt;iframe/.test(asText));
  // desteklenmeyen sağlayıcı ve tehlikeli adresler tamamen atılır
  assert.equal(C.cleanHtml('<p>a</p><iframe src="https://evil.example/x"></iframe>'), "<p>a</p>");
  assert.equal(C.cleanHtml('<p>a</p><iframe src="javascript:alert(1)"></iframe><figure class="media-video"><iframe src="https://www.youtube-nocookie.com/embed/xx"></iframe></figure>'), "<p>a</p>");
  // yan yana yerleşim sınıfları korunur, başka sınıflar atılır
  const half = C.cleanHtml('<figure class="media-video half x-evil"><iframe src="https://youtu.be/dQw4w9WgXcQ"></iframe></figure><p><img class="half is-picked" src="/uploads/2025/a.jpg"></p>');
  assert.match(half, /<figure class="media-video half">/);
  assert.match(half, /<img src="\{ROOT\}uploads\/2025\/a\.jpg" alt="" loading="lazy" class="half" \/>|<img src="\{ROOT\}uploads\/2025\/a\.jpg" alt="" loading="lazy" class="half">/);
  assert.ok(!/x-evil|is-picked|contenteditable/.test(half));
  // yalnızca videodan oluşan metin geçerlidir; Shorts dikey biçim alır; Vimeo desteklenir
  assert.match(C.cleanHtml("<iframe src='https://youtube.com/shorts/dQw4w9WgXcQ'></iframe>"), /class="media-video short"/);
  assert.match(C.cleanHtml('<iframe src="https://vimeo.com/123456789"></iframe>'), /src="https:\/\/player\.vimeo\.com\/video\/123456789"/);
});

// ---------------------------------------------------------------- yetki
test("haber düzenleme yetkisi sunucuda denetlenir (ziyaretçi, üye, akademisyen, yalnızca eser yetkili rol)", async () => {
  const body = { data: { title: "Yetkisiz değişiklik" } };
  assert.equal((await U.anon.call("PUT", `/admin/items/topic/${topicId}`, body)).status, 401);
  for (const k of ["uye", "hoca", "eserci"]) assert.equal((await U[k].call("PUT", `/admin/items/topic/${topicId}`, body)).status, 403, k);
  // akademisyen kendi alanı dışındaki kaydı "kendi kayıtlarım" yolundan da düzenleyemez
  assert.equal((await U.hoca.call("PUT", `/my/items/work/${workId}`, body)).status, 403);
  assert.notEqual(C.getItem("topic", topicId).title, "Yetkisiz değişiklik");
  // eser yetkili rol eseri düzenleyebilir
  assert.equal((await U.eserci.call("PUT", `/admin/items/work/${workId}`, { data: { place: "İstanbul" } })).status, 200);
});

test("süper yönetici, yönetici ve editör haberi düzenler; yalnızca değişen alan işlenir, görsel ve metin korunur", async () => {
  const before = C.getItem("topic", topicId);
  for (const [k, t] of [["super", "Başlık A"], ["yonetici", "Başlık B"], ["editor", "Başlık C"]]) {
    const g = await U[k].call("GET", `/items/topic/${topicId}`);
    assert.ok(g.body.version, "sürüm damgası");
    const r = await U[k].call("PUT", `/admin/items/topic/${topicId}`, { data: { title: t }, version: g.body.version });
    assert.equal(r.status, 200, k + " " + r.text);
    assert.notEqual(r.body.version, g.body.version);
  }
  const after = C.getItem("topic", topicId);
  assert.equal(after.title, "Başlık C");
  assert.equal(after.posts[0].html, before.posts[0].html);
  assert.equal(after.image, before.image);
  assert.equal(after.forum, before.forum);
  const lg = db.prepare("SELECT detail FROM logs WHERE action = 'icerik-duzenle' ORDER BY id DESC LIMIT 1").get();
  assert.equal(lg.detail, `topic:${topicId} (title)`);
});

test("habere video eklenir; görsel ve video yan yana kaydedilir", async () => {
  const g = await U.editor.call("GET", `/items/topic/${topicId}`);
  const html = g.body.values.body + '<figure class="media-video half" contenteditable="false"><iframe src="' + YT + '"></iframe></figure><p><img class="half" src="/uploads/2025/b.jpg" alt=""></p>';
  const r = await U.editor.call("PUT", `/admin/items/topic/${topicId}`, { data: { body: html }, version: g.body.version });
  assert.equal(r.status, 200, r.text);
  const saved = C.getItem("topic", topicId).posts[0].html;
  assert.match(saved, /<figure class="media-video half"><iframe src="https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?rel=0"/);
  assert.match(saved, /class="half"/);
  // tekrar açınca editöre aynı içerik gelir
  const again = await U.editor.call("GET", `/items/topic/${topicId}`);
  assert.match(again.body.values.body, /media-video half/);
});

test("üzerine yazma koruması: ekran açıkken kayıt değiştiyse 409, sürüm gönderilmezse eski davranış", async () => {
  const a = await U.super.call("GET", `/items/topic/${topicId}`);
  const b = await U.editor.call("GET", `/items/topic/${topicId}`);
  assert.equal((await U.super.call("PUT", `/admin/items/topic/${topicId}`, { data: { title: "Önce kaydeden" }, version: a.body.version })).status, 200);
  const late = await U.editor.call("PUT", `/admin/items/topic/${topicId}`, { data: { title: "Sonra kaydeden" }, version: b.body.version });
  assert.equal(late.status, 409);
  assert.match(late.body.error, /başka biri tarafından değiştirildi/);
  assert.equal(C.getItem("topic", topicId).title, "Önce kaydeden");
  assert.equal((await U.editor.call("PUT", `/admin/items/topic/${topicId}`, { data: { title: "Sürümsüz" } })).status, 200);
});

test("doğrulama hatası alan bazında döner; zorunlu alan boşaltılamaz", async () => {
  const r = await U.editor.call("PUT", `/admin/items/topic/${topicId}`, { data: { title: "", body: "<p></p>" } });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.title && r.body.fields.body);
});

test("site üretim durumu herkese açık ama yalnızca durum bilgisi verir; sayfa ve betikler her istekte doğrulanır", async () => {
  const b = await U.anon.call("GET", "/site/build");
  assert.equal(b.status, 200);
  assert.deepEqual(Object.keys(b.body).sort(), ["lastEnd", "ok", "queued", "running"]);
  for (const u of ["/assets/js/app.js", "/assets/css/style.css", "/panel/panel.js", "/panel/"]) {
    const r = await fetch(base + u);
    assert.equal(r.status, 200, u);
    assert.equal(r.headers.get("cache-control"), "no-cache", u);
    assert.ok(r.headers.get("etag") || r.headers.get("last-modified"), u);
  }
  assert.match((await fetch(base + "/")).headers.get("content-security-policy"), /frame-src https:\/\/www\.youtube-nocookie\.com https:\/\/player\.vimeo\.com/);
});

test("etkinlik bölümü üçe ayrıldı: seçenekler, başlığa göre sınıflandırma ve bir kerelik taşıma", async () => {
  const s = (await U.editor.call("GET", "/schema")).body;
  const forum = s.schemas.topic.find((f) => f.key === "forum");
  for (const k of ["etkinlik", "sempozyum", "koordinasyon"]) assert.ok(forum.options.includes(k) && forum.memberOptions.includes(k), k);
  assert.equal(forum.labels.koordinasyon, "Koordinasyon");
  assert.equal(C.eventKind("2023 Rize 8. Koordinasyon Toplantısı"), "koordinasyon");
  assert.equal(C.eventKind("II. İstişare Toplantısı Elazığda Yapıldı"), "koordinasyon");
  assert.equal(C.eventKind("12 Ekim Isparta Mezhepler Çalıştayı Program"), "koordinasyon");
  assert.equal(C.eventKind("Uluslararası Maturidilik Sempozyumu"), "sempozyum");
  assert.equal(C.eventKind("Büyük Türk Bilgini Mâtürîdî ve Mâtürîdîlik Semp."), "sempozyum");
  assert.equal(C.eventKind("27-28 Eylül 2003 Metodoloji Problemi Toplantısı"), "etkinlik");
  // eski kayıt "etkinlik" olarak durur; taşıma bir kez çalışır
  const id = C.listItems("topic").find((t) => t.forum === "koordinasyon").id;
  const it = C.getItem("topic", id); it.forum = "etkinlik"; C.saveItem("topic", id, it, null);
  const { runOnce } = require("../src/db");
  const first = runOnce("test-etkinlik", () => C.splitEventForums());
  assert.ok(first.includes(`${id}→koordinasyon`));
  assert.equal(C.getItem("topic", id).forum, "koordinasyon");
  assert.equal(runOnce("test-etkinlik", () => C.splitEventForums()), null, "ikinci kez çalışmaz");
  // yeni kategoriyle haber kaydedilebilir
  const r = await U.editor.call("PUT", `/admin/items/topic/${id}`, { data: { forum: "sempozyum" } });
  assert.equal(r.status, 200, r.text);
  assert.equal(C.getItem("topic", id).forum, "sempozyum");
});

test("galeri videoları: kanal akışı eskilerle birleştirilir, kanal ayarı doğrulanır", async () => {
  const bad = await U.super.call("PUT", "/admin/settings", { values: { gallery_channel: "javascript:alert(1)" } });
  assert.equal(bad.status, 400);
  assert.ok(bad.body.fields.gallery_channel);
  const v = require("../src/videos");
  const CH = "UCGFN07whsFRvjvB7TzK-bKg";
  const entry = (id, t, d) => `<entry><yt:videoId>${id}</yt:videoId><title>${t}</title><published>${d}T10:00:00+00:00</published></entry>`;
  let feed = `<feed><title>MezhepOrg</title>${entry("AAAAAAAAAA1", "Eski video", "2023-05-04")}</feed>`;
  const orig = global.fetch, asked = [];
  global.fetch = async (url) => { asked.push(String(url)); return { ok: true, text: async () => feed }; };
  try {
    assert.equal(await v.refresh([], CH), true);
    feed = `<feed><title>MezhepOrg</title>${entry("AAAAAAAAAA2", "Yeni &amp; güzel", "2026-10-01")}</feed>`;
    await v.refresh([], CH);
    assert.ok(asked.every((u) => u.includes("channel_id=" + CH)));
    let c = v.load().channel;
    // tohum veride (data/videos.json) kanalın gerçek videoları da var; hepsi korunur, en yeni başta
    assert.equal(c.videos[0].id, "AAAAAAAAAA2", "yeni video başa eklenir");
    assert.ok(c.videos.some((x) => x.id === "AAAAAAAAAA1"), "önceki video kalır");
    assert.equal(c.videos[0].title, "Yeni & güzel");
    await v.refresh([]);
    assert.equal(v.load().channel.videos.length, c.videos.length, "kanal verilmezse dokunulmaz");
    await v.refresh([], "");
    assert.equal(v.load().channel, null, "galeri videoları kapatılınca kanal kaldırılır");
  } finally { global.fetch = orig; }
});
