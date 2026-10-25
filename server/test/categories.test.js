// Kategoriler: otomatik listeleme (kategori sayfası, sayfalardaki bölümler, menü), panel uç noktaları, doğrulama,
// adres değişikliğinde yönlendirme ve geri alınabilir taşıma. Site gerçekten üretilir (scripts/build.py) ve HTML denetlenir.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mezhep-kat-"));
process.env.MZ_DATA_DIR = TMP;
process.env.PUBLIC_ORIGIN = "http://127.0.0.1";

const { createApp } = require("../src/index");
const { db, seedIfEmpty } = require("../src/db");
const A = require("../src/auth");
const C = require("../src/content");
const CAT = require("../src/categories");
const rebuild = require("../src/rebuild");
const cfg = require("../src/config");
rebuild.schedule = () => {};

let base, server;
class Client {
  constructor() { this.cookie = ""; }
  async call(method, url, body) {
    const h = { "x-mz": "1", "content-type": "application/json" };
    if (this.cookie) h.cookie = this.cookie;
    const r = await fetch(base + "/api" + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    let json = {};
    try { json = JSON.parse(await r.text()); } catch {}
    return { status: r.status, body: json };
  }
}
const PW = "SifreDeneme123";
const U = {};
const site = (p) => fs.readFileSync(path.join(cfg.SITE_DIR, p), "utf8");
const exists = (p) => fs.existsSync(path.join(cfg.SITE_DIR, p));
const pageData = (html) => JSON.parse(html.match(/<script type="application\/json" id="page-data">([\s\S]*?)<\/script>/)[1].replace(/<\\\//g, "</"));
// ana sayfadaki bir kategori bölümünün HTML'i
const block = (html, key) => (html.match(new RegExp(`<section class="section[^"]*" data-category="${key}">[\\s\\S]*?</section>`)) || [""])[0];
const navOf = (html) => html.match(/<nav class="nav"[\s\S]*?<\/nav>/)[0];
async function build() {
  await rebuild.run();
  assert.equal(rebuild.state.ok, true, rebuild.state.log);
}

test.before(async () => {
  seedIfEmpty();
  const mk = (key, role) => db.prepare("INSERT INTO users (email, name, password_hash, role_key, status) VALUES (?, ?, ?, ?, 'active')")
    .run(key + "@t.local", key[0].toUpperCase() + key.slice(1) + " Deneme", A.hashPassword(PW), role);
  mk("super", "super"); mk("editor", "editor"); mk("uye", "uye");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of ["super", "editor", "uye"]) {
    U[k] = new Client();
    assert.equal((await U[k].call("POST", "/auth/login", { email: k + "@t.local", password: PW })).status, 200, k);
  }
});
test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test("taşıma: varsayılan kategoriler bir kez yazılır; mevcut haberlerin hepsi bir kategoriye bağlıdır", () => {
  const keys = CAT.list().map((c) => c.key);
  for (const k of ["haber", "etkinlikler", "sempozyum", "koordinasyon", "etkinlik", "kitap", "sss", "anket"]) assert.ok(keys.includes(k), k);
  assert.equal(CAT.get("koordinasyon").parent, "etkinlikler");
  assert.deepEqual(CAT.adoptOrphans(), [], "tanımsız kategori yok");
  const n = CAT.counts();
  assert.equal(n.koordinasyon.live, 16);
  const total = C.listItems("topic").length;
  assert.equal(Object.values(n).reduce((a, x) => a + x.live, 0), total, "her haber bir kategoride");
  assert.equal(CAT.seed(), null, "taşıma ikinci kez çalışmaz");
});

test("kategori ekranı yalnızca site ayarı yetkisiyle; panel formu alan tanımlarını alır", async () => {
  assert.equal((await U.editor.call("GET", "/admin/categories")).status, 403);
  assert.equal((await U.uye.call("POST", "/admin/categories", { data: { name: "X" } })).status, 403);
  const r = await U.super.call("GET", "/admin/categories");
  assert.equal(r.status, 200);
  assert.ok(r.body.fields.some((f) => f.key === "pages") && r.body.fields.some((f) => f.key === "seo_title"));
  assert.equal(r.body.counts.koordinasyon.live, 16);
  // panel listesinde kategoriye göre süzme (alt kategoriler dahil)
  assert.equal((await U.super.call("GET", "/admin/items/topic?kat=koordinasyon")).body.total, 16);
  assert.equal((await U.super.call("GET", "/admin/items/topic?kat=etkinlikler")).body.total, 47);
});

test("üretilen site: Koordinasyon'un 16 içeriği kategori sayfasında; ana sayfada 6; mevcut adresler yerinde", async () => {
  await build();
  const k = site("kategori/koordinasyon.html");
  assert.equal(pageData(k).length, 16);
  assert.equal((k.match(/class="card news-card/g) || []).length, 16, "JavaScript'siz ziyaretçi de hepsini görür");
  assert.match(k, /<link rel="canonical" href="https:\/\/mezhep\.net\/kategori\/koordinasyon\.html">/);
  const home = site("index.html"), kb = block(home, "koordinasyon");
  assert.equal((kb.match(/class="card news-card/g) || []).length, 6);
  assert.match(kb, /href="kategori\/koordinasyon\.html">Tümünü gör \(16\)/);
  assert.equal((block(home, "haber").match(/class="card news-card/g) || []).length, 6);
  for (const p of ["haberler.html", "etkinlikler.html", "kaynaklar.html", "hakkinda.html", "haber/265.html", "haber/119.html"]) assert.ok(exists(p), p);
  // etkinlikler sayfasının kategori menüsü panelden; eski #tur=Koordinasyon bağlantısı için kısa ad korunur
  assert.match(site("etkinlikler.html"), /data-ev-filter="Koordinasyon" data-ev-key="koordinasyon"/);
  // menü: Etkinlikler altında Koordinasyon
  assert.match(navOf(home), /<div class="nav-item"><a href="etkinlikler\.html">Etkinlikler<\/a>[\s\S]*href="kategori\/koordinasyon\.html">Koordinasyon Toplantıları/);
  // daha önce hiçbir listede görünmeyen anket kaydı artık kategori sayfasında
  assert.equal(pageData(site("kategori/anketler.html")).length, 1);
});

test("yeni yazı yalnızca kategorisi seçilerek yayımlanır: kategori sayfası, ana sayfa bölümü ve menü kendiliğinden güncellenir", async () => {
  const r = await U.super.call("POST", "/admin/items/topic", { data: { title: "2026 Ankara 10. Koordinasyon Toplantısı", forum: "koordinasyon", date: "2026-10-20", body: "<p>Toplantı duyurusu.</p>" } });
  assert.equal(r.status, 200);
  // ana sayfada en çok 3 içerik, kategori sayfasında hepsi
  assert.equal((await U.super.call("PUT", "/admin/categories/koordinasyon", { data: { count: "3" } })).status, 200);
  await build();
  const k = pageData(site("kategori/koordinasyon.html"));
  assert.equal(k.length, 17);
  assert.equal(k[0].id, r.body.id, "en yeni en üstte");
  const kb = block(site("index.html"), "koordinasyon");
  assert.equal((kb.match(/class="card news-card/g) || []).length, 3);
  assert.ok(kb.includes(`haber/${r.body.id}.html`));
  assert.match(kb, /Tümünü gör \(17\)/);
  // haber sayfasında konum: Ana Sayfa › Etkinlikler › Koordinasyon Toplantıları
  const h = site(`haber/${r.body.id}.html`);
  assert.match(h, /<a href="\.\.\/etkinlikler\.html">Etkinlikler<\/a>[\s\S]*?<a href="\.\.\/kategori\/koordinasyon\.html">Koordinasyon Toplantıları<\/a><\/nav>/);
  assert.match(navOf(h), /href="\.\.\/kategori\/koordinasyon\.html" aria-current="page"/);
});

test("yeni kategori: doğrulama, menüye ekleme, boş durum ve otomatik listeleme", async () => {
  const dup = await U.super.call("POST", "/admin/categories", { data: { name: "Başka", slug: "koordinasyon" } });
  assert.equal(dup.status, 400); assert.ok(dup.body.fields.slug);
  const deep = await U.super.call("POST", "/admin/categories", { data: { name: "Derin", parent: "koordinasyon" } });
  assert.equal(deep.status, 400); assert.ok(deep.body.fields.parent, "menü iki düzeyli");
  assert.equal((await U.super.call("POST", "/admin/categories", { data: { name: "" } })).status, 400);
  assert.equal((await U.super.call("POST", "/admin/categories", { data: { name: "X", count: 7 } })).body.fields.count !== undefined, true);

  const r = await U.super.call("POST", "/admin/categories", { data: { name: "Çalıştay Duyuruları", menu_show: true, home_show: true, count: "6", pages: ["kaynaklar"], open_submit: true } });
  assert.equal(r.status, 200);
  const cat = r.body.item;
  assert.equal(cat.slug, "calistay-duyurulari");
  // haber formunda seçilebilir; üyeler de önerebilir
  const forum = (await U.uye.call("GET", "/schema")).body.schemas.topic.find((f) => f.key === "forum");
  assert.ok(forum.options.includes(cat.key) && forum.memberOptions.includes(cat.key));
  await build();
  const page = site("kategori/calistay-duyurulari.html");
  assert.match(page, /Bu kategoride henüz yayımlanmış içerik bulunmuyor/);
  assert.match(navOf(site("index.html")), /href="kategori\/calistay-duyurulari\.html">Çalıştay Duyuruları/);
  assert.equal(block(site("index.html"), cat.key), "", "boş bölüm sayfalarda gösterilmez");

  await U.super.call("POST", "/admin/items/topic", { data: { title: "Usul Çalıştayı", forum: cat.key, date: "2026-10-01", body: "<p>Duyuru</p>" } });
  await build();
  assert.equal(pageData(site("kategori/calistay-duyurulari.html")).length, 1);
  assert.match(block(site("index.html"), cat.key), /Usul Çalıştayı/);
  assert.match(block(site("kaynaklar.html"), cat.key), /Usul Çalıştayı/);

  // içerik varken silinemez; içerikler korunur
  const del = await U.super.call("DELETE", `/admin/categories/${cat.key}`);
  assert.equal(del.status, 400);
  assert.equal(CAT.counts()[cat.key].live, 1);
  assert.equal((await U.super.call("DELETE", "/admin/categories/haber")).status, 400, "ana bölüm silinemez");
  const empty = (await U.super.call("POST", "/admin/categories", { data: { name: "Geçici" } })).body.item;
  assert.equal((await U.super.call("DELETE", `/admin/categories/${empty.key}`)).status, 200);
});

test("menüden kaldırılan kategorinin içerikleri ve sayfası kalır; menü sırası değiştirilebilir", async () => {
  const before = CAT.counts().koordinasyon.live;
  const m = await U.super.call("GET", "/admin/categories");
  const items = m.body.pages.map((p) => ({ type: "page", key: p.key, menu_show: true, menu_order: p.key === "galeri" ? 15 : p.menu_order }))
    .concat(m.body.items.map((c) => ({ type: "category", key: c.key, menu_show: c.key === "koordinasyon" ? false : c.menu_show, menu_order: c.menu_order })));
  assert.equal((await U.editor.call("PUT", "/admin/menu", { items })).status, 403);
  assert.equal((await U.super.call("PUT", "/admin/menu", { items: [{ type: "page", key: "yok", menu_show: true, menu_order: 1 }] })).status, 400);
  assert.equal((await U.super.call("PUT", "/admin/menu", { items })).status, 200);
  await build();
  const nav = navOf(site("index.html"));
  assert.ok(!nav.includes("kategori/koordinasyon.html"), "menüden kalktı");
  assert.ok(nav.indexOf("galeri.html") < nav.indexOf("akademisyenler.html"), "sıra değişti");
  assert.ok(exists("kategori/koordinasyon.html"));
  assert.equal(CAT.counts().koordinasyon.live, before, "içerik silinmedi");
  // menüde değilken haber sayfası üst kategoriyi (Etkinlikler) işaretler
  const id = C.listItems("topic").find((t) => t.forum === "koordinasyon").id;
  assert.match(navOf(site(`haber/${id}.html`)), /href="\.\.\/etkinlikler\.html" aria-current="page"/);
});

test("adres değişince eski adres yeni sayfaya yönlenir; özel sıralama ve SEO alanları uygulanır", async () => {
  const r = await U.super.call("PUT", "/admin/categories/sempozyum", { data: { slug: "sempozyum-ve-kongreler", seo_title: "Sempozyum ve Kongreler", seo_desc: "Sempozyum duyuruları", sort: "manual" } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.item.old_slugs, ["sempozyumlar"]);
  const ids = C.listItems("topic").filter((t) => t.forum === "sempozyum").map((t) => t.id).sort((a, b) => a - b);
  // en eski sempozyum duyurusuna 1. sıra verilir: özel sırada en üste çıkar
  assert.equal((await U.super.call("PUT", `/admin/items/topic/${ids[0]}`, { data: { order: "1" } })).status, 200);
  assert.equal((await U.super.call("PUT", `/admin/items/topic/${ids[0]}`, { data: { order: "-5" } })).status, 400);
  await build();
  const old = site("kategori/sempozyumlar.html");
  assert.match(old, /http-equiv="refresh" content="0; url=\.\.\/kategori\/sempozyum-ve-kongreler\.html"/);
  assert.match(old, /rel="canonical" href="https:\/\/mezhep\.net\/kategori\/sempozyum-ve-kongreler\.html"/);
  const p = site("kategori/sempozyum-ve-kongreler.html");
  assert.match(p, /<title>Sempozyum ve Kongreler · Mezhep\.Org<\/title>/);
  assert.match(p, /<meta name="description" content="Sempozyum duyuruları">/);
  assert.equal(pageData(p)[0].id, ids[0]);
  // eski adres geri alınırsa yönlendirme kalkar
  await U.super.call("PUT", "/admin/categories/sempozyum", { data: { slug: "sempozyumlar" } });
  assert.deepEqual(CAT.get("sempozyum").old_slugs, ["sempozyum-ve-kongreler"]);
});

test("geri alma: kategori tabloları kaldırılır, haberlere dokunulmaz; yeniden kurulum varsayılanları yazar", () => {
  const topics = db.prepare("SELECT count(*) AS n FROM items WHERE kind = 'topic' AND deleted = 0").get().n;
  CAT.rollback();
  assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name IN ('categories', 'menu_pages')").get().n, 0);
  assert.equal(db.prepare("SELECT count(*) AS n FROM items WHERE kind = 'topic' AND deleted = 0").get().n, topics);
  db.exec(`CREATE TABLE categories (key TEXT PRIMARY KEY, data TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), updated_by INTEGER);
           CREATE TABLE menu_pages (key TEXT PRIMARY KEY, menu_show INTEGER NOT NULL, menu_order INTEGER NOT NULL);`);
  assert.equal(CAT.seed(), CAT.list().length);
  assert.ok(CAT.adoptOrphans().length >= 1, "panelden eklenmiş kategorideki haber sahipsiz kalmaz");
});
