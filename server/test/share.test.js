// Paylaşım tıklaması sayacı: yalnızca geçerli içerik + platform sayılır, kişi bilgisi tutulmaz, rapor yetkiye bağlıdır.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mezhep-share-"));
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
  async call(method, url, body, headers = { "x-mz": "1" }) {
    const h = { ...headers, "content-type": "application/json" };
    if (this.cookie) h.cookie = this.cookie;
    const r = await fetch(base + "/api" + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const text = await r.text();
    let json = {};
    try { json = JSON.parse(text); } catch {}
    return { status: r.status, body: json };
  }
}
const PW = "SifreDeneme123";
const U = {};
let topicId, workId;

test.before(async () => {
  seedIfEmpty();
  const mk = (key, role) => db.prepare("INSERT INTO users (email, name, password_hash, role_key, status) VALUES (?, ?, ?, ?, 'active')")
    .run(key + "@t.local", key + " Deneme", A.hashPassword(PW), role);
  mk("super", "super"); mk("editor", "editor"); mk("uye", "uye");
  topicId = C.listItems("topic")[0].id;
  workId = C.listItems("work")[0].id;
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of ["super", "editor", "uye"]) {
    U[k] = new Client();
    assert.equal((await U[k].call("POST", "/auth/login", { email: k + "@t.local", password: PW })).status, 200);
  }
  U.anon = new Client();
});
test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test("ziyaretçi paylaşım tıklaması kaydedebilir; aynı gün-içerik-platform tek satırda sayılır", async () => {
  for (const [t, p] of [[`topic:${topicId}`, "whatsapp"], [`topic:${topicId}`, "whatsapp"], [`topic:${topicId}`, "kopyala"], [`work:${workId}`, "x"], ["album:8-37", "facebook"], ["member:10", "sistem"]]) {
    assert.equal((await U.anon.call("POST", "/share", { target: t, platform: p })).status, 204, t + " " + p);
  }
  const rows = db.prepare("SELECT * FROM share_clicks ORDER BY target, platform").all();
  assert.equal(rows.find((r) => r.target === `topic:${topicId}` && r.platform === "whatsapp").n, 2);
  // kişiye ait bilgi tutulmaz: yalnızca gün, içerik, platform ve sayı
  assert.deepEqual(db.prepare("PRAGMA table_info(share_clicks)").all().map((c) => c.name).sort(), ["day", "n", "platform", "target"]);
});

test("geçersiz platform, var olmayan ya da silinmiş içerik ve başka siteden gelen istek sayılmaz", async () => {
  const before = db.prepare("SELECT sum(n) AS n FROM share_clicks").get().n;
  assert.equal((await U.anon.call("POST", "/share", { target: `topic:${topicId}`, platform: "instagram" })).status, 400);
  assert.equal((await U.anon.call("POST", "/share", { target: "topic:999999", platform: "x" })).status, 400);
  assert.equal((await U.anon.call("POST", "/share", { target: "users:1", platform: "x" })).status, 400);
  assert.equal((await U.anon.call("POST", "/share", { target: "album:99-99", platform: "x" })).status, 400);
  assert.equal((await U.anon.call("POST", "/share", { target: `topic:${topicId}`, platform: "x" }, {})).status, 403, "CSRF başlığı yok");
  assert.equal(db.prepare("SELECT sum(n) AS n FROM share_clicks").get().n, before);
});

test("rapor: yalnızca işlem kayıtlarını görme yetkisi olanlara; platform, içerik, gün ve ay dökümü", async () => {
  assert.equal((await U.anon.call("GET", "/admin/shares")).status, 401);
  assert.equal((await U.uye.call("GET", "/admin/shares")).status, 403);
  assert.equal((await U.editor.call("GET", "/admin/shares")).status, 403, "editör rolünde kayit.gor yok");
  const r = await U.super.call("GET", "/admin/shares?days=30");
  assert.equal(r.status, 200);
  assert.equal(r.body.total, 6);
  assert.equal(r.body.byPlatform[0].platform, "whatsapp");
  const top = r.body.top[0];
  assert.equal(top.target, `topic:${topicId}`);
  assert.equal(top.n, 3);
  assert.equal(top.url, `/haber/${topicId}.html`);
  assert.deepEqual(top.platforms, { whatsapp: 2, kopyala: 1 });
  assert.ok(r.body.top.some((t) => t.kind === "album" && t.url === "/galeri/8-37.html" && /Koordinasyon/.test(t.title)));
  assert.equal(r.body.byDay.length, 1);
  assert.equal(r.body.byMonth[0].n, 6);
});
