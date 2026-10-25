// Eski mezhep.org (.asp) adreslerinin yeni sayfalara kalıcı yönlendirilmesi.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mezhep-eski-"));
process.env.MZ_DATA_DIR = TMP;
const { createApp } = require("../src/index");
const { db, seedIfEmpty } = require("../src/db");
const C = require("../src/content");

let base, server;
test.before(async () => {
  seedIfEmpty();
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });
const go = async (u, method = "GET") => { const r = await fetch(base + u, { method, redirect: "manual" }); return [r.status, r.headers.get("location")]; };

test("eski kayıt bağlantıları aynı numaralı yeni sayfaya gider (büyük/küçük harf duyarsız)", async () => {
  const m = C.listItems("member")[0], w = C.listItems("work")[0], t = C.listItems("topic").find((x) => x.forum === "koordinasyon"), a = C.listItems("album")[0];
  assert.deepEqual(await go(`/eleman_read.asp?item=${m.id}`), [301, `/akademisyen/${m.id}.html`]);
  assert.deepEqual(await go(`/ESER_READ.ASP?ITEM=${w.id}`), [301, `/eser/${w.id}.html`]);
  assert.deepEqual(await go(`/link.asp?TOPIC_ID=${t.id}`), [301, `/haber/${t.id}.html`]);
  assert.deepEqual(await go(`/forum_topic.asp?TOPIC_ID=${t.id}&FORUM_ID=5`), [301, `/haber/${t.id}.html`]);
  assert.deepEqual(await go(`/pic.asp?cmd=2&cid=${a.cid}&sid=${a.sid}&page=1`), [301, `/galeri/${a.cid}-${a.sid}.html`]);
  assert.deepEqual(await go(`/eleman_read.asp?item=${m.id}`, "HEAD"), [301, `/akademisyen/${m.id}.html`]);
});

test("bölüm sayfaları ve artık olmayan kayıtlar ilgili listeye; bilinmeyen .asp ana sayfaya", async () => {
  assert.deepEqual(await go("/default.asp"), [301, "/"]);
  assert.deepEqual(await go("/eleman.asp?cmd=2&cid=1&sid=2"), [301, "/akademisyenler.html"]);
  assert.deepEqual(await go("/eser.asp?cmd=6"), [301, "/eserler.html"]);
  assert.deepEqual(await go("/fnews.asp?page=3"), [301, "/haberler.html"]);
  assert.deepEqual(await go("/links.asp?cmd=2&cid=2&sid=9"), [301, "/kaynaklar.html"]);
  assert.deepEqual(await go("/policy.asp"), [301, "/hakkinda.html#kosullar"]);
  assert.deepEqual(await go("/eser_read.asp?item=999999"), [301, "/eserler.html"]);
  assert.deepEqual(await go("/link.asp?TOPIC_ID=abc"), [301, "/haberler.html"]);
  assert.deepEqual(await go("/bilinmeyen.asp"), [301, "/"]);
  // .asp olmayan adresler ve API etkilenmez
  assert.equal((await go("/api/health"))[0], 200);
  assert.equal((await go("/alt/klasor.asp"))[0], 404);
});
