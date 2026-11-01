// Bağlantılar rehberi: veri taşıma, yetkiler, adres denetimi, mükerrer uyarısı, kategoriler, Türkçe sıralama, açıklama
// görünürlüğü, toplu işlemler, CSV / Excel içe ve dışa aktarma, eski "Bağlantılar" haber kategorisinden aktarım ve 1000 bağlantı.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mezhep-links-"));
process.env.MZ_DATA_DIR = TMP;
process.env.PUBLIC_ORIGIN = "http://127.0.0.1";

const { createApp } = require("../src/index");
const { db, seedIfEmpty } = require("../src/db");
const A = require("../src/auth");
const C = require("../src/content");
const L = require("../src/links");
const SHEET = require("../src/sheet");
const cfg = require("../src/config");
const rebuild = require("../src/rebuild");
const realRun = rebuild.run;
rebuild.schedule = () => {};

let base, server;
class Client {
  constructor() { this.cookie = ""; }
  async call(method, url, body, { raw } = {}) {
    const h = { "x-mz": "1", ...(raw ? {} : { "content-type": "application/json" }) };
    if (this.cookie) h.cookie = this.cookie;
    const r = await fetch(base + "/api" + url, { method, headers: h, body: raw || (body === undefined ? undefined : JSON.stringify(body)) });
    const set = r.headers.get("set-cookie");
    if (set) this.cookie = set.split(";")[0];
    const buf = Buffer.from(await r.arrayBuffer());
    let json = {};
    try { json = JSON.parse(buf.toString("utf8")); } catch {}
    return { status: r.status, body: json, buf, text: buf.toString("utf8"), type: r.headers.get("content-type") || "" };
  }
}
const PW = "SifreDeneme123";
const U = {};
const site = (p) => fs.readFileSync(path.join(cfg.SITE_DIR, p), "utf8");
const fileForm = (buf, name, type) => { const fd = new FormData(); fd.append("file", new Blob([buf], { type }), name); return fd; };
const linkRows = (html) => [...html.matchAll(/<li data-c="([^"]*)" data-s="([^"]*)" data-f="[^"]*">([\s\S]*?)<\/li>/g)].map((m) => ({ c: m[1], s: m[2], html: m[3], name: (m[3].match(/<span class="lk-name">([^<]*)<\/span>/) || [])[1] }));

test.before(async () => {
  seedIfEmpty();
  const mk = (key, role) => db.prepare("INSERT INTO users (email, name, password_hash, role_key, status) VALUES (?, ?, ?, ?, 'active')")
    .run(key + "@t.local", key[0].toUpperCase() + key.slice(1) + " Deneme", A.hashPassword(PW), role);
  for (const [k, r] of [["super", "super"], ["yonetici", "yonetici"], ["editor", "editor"], ["moderator", "moderator"], ["uye", "uye"]]) mk(k, r);
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const k of ["super", "yonetici", "editor", "moderator", "uye"]) {
    U[k] = new Client();
    assert.equal((await U[k].call("POST", "/auth/login", { email: k + "@t.local", password: PW })).status, 200, k);
  }
});
test.after(() => { server.close(); db.close(); fs.rmSync(TMP, { recursive: true, force: true }); });

test("var olan bağlantılar kayıpsız taşınır: kategori adları ayrı bağlantı kategorilerine, eski etiketler alt kategoriye bağlanır", async () => {
  const before = C.listItems("link").map((l) => ({ id: l.id, name: l.name, url: l.url, desc: l.desc, cat: l.category, sub: l.sub }));
  assert.equal(before.length, 8);
  const done = L.adopt();
  assert.equal(done.length, 8);
  assert.deepEqual(L.adopt(), [], "ikinci çalıştırmada yapılacak iş yok");
  const cats = L.cats(), byKey = Object.fromEntries(cats.map((c) => [c.key, c]));
  for (const b of before) {
    const l = C.getItem("link", b.id);
    assert.equal(l.name, b.name); assert.equal(l.url, b.url); assert.equal(l.desc, b.desc);
    assert.equal(byKey[l.category].name, b.cat, "kategori adı korunur");
    assert.equal(byKey[l.sub].name, b.sub, "eski etiket alt kategori oldu");
    assert.equal(byKey[l.sub].parent, l.category);
    assert.equal(l.status, "aktif");
  }
  assert.deepEqual(cats.filter((c) => !c.parent).map((c) => c.name).sort(), ["Dergiler", "Kaynaklar", "Kişisel Siteler", "İlahiyat Sahası"].sort());
  // haber kategorileri ayrı: bağlantı kategorisi açmak haber kategorilerini değiştirmez
  assert.ok(!require("../src/categories").list().some((c) => c.key === "kisisel-siteler"));
});

test("yetkiler: Editör ekler ve düzenler, silemez; moderatör ve üye erişemez; ziyaretçiye 401", async () => {
  for (const [m, u] of [["GET", "/admin/links"], ["GET", "/admin/link-categories"], ["GET", "/admin/links/export"], ["POST", "/admin/links"], ["GET", "/admin/links/settings"]]) {
    assert.equal((await U.moderator.call(m, u, m === "POST" ? {} : undefined)).status, 403, `moderatör ${m} ${u}`);
    assert.equal((await U.uye.call(m, u, m === "POST" ? {} : undefined)).status, 403, `üye ${m} ${u}`);
    assert.equal((await new Client().call(m, u, m === "POST" ? {} : undefined)).status, 401, `ziyaretçi ${m} ${u}`);
  }
  const list = await U.editor.call("GET", "/admin/links");
  assert.equal(list.status, 200);
  assert.equal(list.body.total, 8);
  assert.equal(list.body.canDelete, false);
  const id = list.body.items[0].id;
  assert.equal((await U.editor.call("DELETE", `/admin/links/${id}`)).status, 403);
  assert.equal((await U.editor.call("POST", "/admin/links/bulk", { ids: [id], action: "delete" })).status, 403);
  assert.equal((await U.editor.call("DELETE", `/admin/link-categories/${C.getItem("link", id).category}?move_to=x`)).status, 403);
  assert.ok(C.getItem("link", id), "hiçbir şey silinmedi");
  assert.equal((await U.yonetici.call("GET", "/admin/links")).body.canDelete, true);
});

test("ekleme: zorunlu alanlar, https tamamlama, tehlikeli şemalar, alt kategori uyumu ve mükerrer uyarısı", async () => {
  const dergi = L.cats().find((c) => c.name === "Dergiler"), kaynak = L.cats().find((c) => c.name === "Kaynaklar");
  const empty = await U.editor.call("POST", "/admin/links", { data: {} });
  assert.equal(empty.status, 400);
  assert.ok(empty.body.fields.name && empty.body.fields.url && empty.body.fields.category);
  for (const url of ["javascript:alert(1)", "data:text/html,<script>alert(1)</script>", "ftp://ornek.edu.tr/a", "vbscript:x", "http://", "ornek"]) {
    const r = await U.editor.call("POST", "/admin/links", { data: { name: "Kötü " + url, url, category: dergi.key } });
    assert.equal(r.status, 400, url);
    assert.ok(r.body.fields.url, url);
  }
  // şemasız adres https:// ile tamamlanır; kategori adla da verilebilir
  const ok = await U.editor.call("POST", "/admin/links", { data: { name: "İSAM Kütüphanesi", url: "kutuphane.isam.org.tr", category: "kaynaklar", desc: "Katalog <b>ve</b> veri tabanları", tags: "kütüphane, katalog, Kütüphane", order: "5" } });
  assert.equal(ok.status, 200, ok.text);
  const l = C.getItem("link", ok.body.id);
  assert.equal(l.url, "https://kutuphane.isam.org.tr");
  assert.equal(l.category, kaynak.key);
  assert.deepEqual(l.tags, ["kütüphane", "katalog"], "tekrarlanan etiket atılır");
  assert.equal(l.order, 5);
  assert.equal(l.status, "aktif");
  // başka kategorinin alt kategorisi seçilemez
  const tez = L.cats().find((c) => c.parent === kaynak.key);
  const wrong = await U.editor.call("POST", "/admin/links", { data: { name: "Yanlış alt", url: "https://yanlis.example.org", category: dergi.key, sub: tez.key } });
  assert.equal(wrong.status, 400);
  assert.ok(wrong.body.fields.sub);
  // mükerrer: aynı adres (www., sondaki / ve şema farkı önemsiz) → 409 ve liste; onayla kaydedilir
  const dup = await U.editor.call("POST", "/admin/links", { data: { name: "Kader dergisi", url: "http://www.dergipark.org.tr/tr/pub/kader/", category: dergi.key } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.duplicates[0].name, "KADER");
  assert.equal(dup.body.duplicates[0].reason, "url");
  const sameName = await U.editor.call("POST", "/admin/links", { data: { name: "kader", url: "https://kader.example.org", category: dergi.key } });
  assert.equal(sameName.status, 409, "aynı ad (büyük/küçük harf farkı önemsiz)");
  const chk = await U.editor.call("GET", "/admin/links/check?url=" + encodeURIComponent("dergipark.org.tr/tr/pub/kader") + "&name=");
  assert.equal(chk.body.duplicates.length, 1, "form açıkken anlık denetim");
  const forced = await U.editor.call("POST", "/admin/links", { data: { name: "Kader dergisi", url: "http://www.dergipark.org.tr/tr/pub/kader/", category: dergi.key }, allow_duplicate: true });
  assert.equal(forced.status, 200);
  // genel içerik uç noktası da aynı kurallarla çalışır
  assert.equal((await U.editor.call("POST", "/admin/items/link", { data: { name: "e-Makalat 2", url: "https://dergipark.org.tr/tr/pub/emakalat", category: dergi.key } })).status, 409);
  // düzenleme: sürüm denetimi; kategori değişince eski alt kategori düşer
  const g = await U.editor.call("GET", `/admin/links/${ok.body.id}`);
  assert.equal(g.body.item.category_label, "Kaynaklar");
  assert.equal((await U.editor.call("PUT", `/admin/links/${ok.body.id}`, { data: { sub: tez.key }, version: g.body.item.version })).status, 200);
  assert.equal((await U.editor.call("PUT", `/admin/links/${ok.body.id}`, { data: { desc: "x" }, version: g.body.item.version })).status, 409, "eski sürümle kaydedilemez");
  const v2 = (await U.editor.call("GET", `/admin/links/${ok.body.id}`)).body.item.version;
  assert.equal((await U.editor.call("PUT", `/admin/links/${ok.body.id}`, { data: { category: dergi.key, status: "pasif" }, version: v2 })).status, 200);
  assert.equal(C.getItem("link", ok.body.id).sub, "");
  assert.equal(C.getItem("link", ok.body.id).status, "pasif");
  // silme ve geri alma
  assert.equal((await U.yonetici.call("DELETE", `/admin/links/${forced.body.id}`)).status, 200);
  assert.equal(C.getItem("link", forced.body.id), null);
  assert.ok((await U.yonetici.call("GET", "/admin/trash")).body.items.some((x) => x.kind === "link" && x.id === forced.body.id));
  assert.equal((await U.yonetici.call("POST", "/admin/links/restore", { ids: [forced.body.id] })).status, 200);
  assert.ok(C.getItem("link", forced.body.id));
  assert.equal((await U.yonetici.call("DELETE", `/admin/links/${forced.body.id}`)).status, 200);
});

test("kategoriler: ekleme, alt kategori, yeniden adlandırma, sıralama, taşıma; silinen kategorinin bağlantıları taşınır", async () => {
  const add = (data) => U.editor.call("POST", "/admin/link-categories", { data });
  const a = await add({ name: "Akademik Araştırma Merkezleri", description: "Araştırma kurumları" });
  assert.equal(a.status, 200, a.text);
  assert.equal((await add({ name: "akademik araştırma merkezleri" })).status, 400, "aynı ad");
  assert.equal((await add({ name: "" })).status, 400);
  const sub = await add({ name: "Vakıflar", parent: a.body.item.key });
  assert.equal(sub.body.item.parent, a.body.item.key);
  assert.equal((await add({ name: "Üçüncü düzey", parent: sub.body.item.key })).status, 400, "iki düzey");
  // önerilen kategoriler: eksik olanlar eklenir, var olana dokunulmaz
  const sg = await U.editor.call("POST", "/admin/link-categories/suggested");
  assert.equal(sg.body.added.length, L.SUGGESTED.length - 1);
  assert.equal(L.cats().filter((c) => c.name === "Akademik Araştırma Merkezleri").length, 1);
  // bağlantı ekle, alt kategoriyi başka üst kategoriye taşı: bağlantı da taşınır
  const l = await U.editor.call("POST", "/admin/links", { data: { name: "TDV", url: "https://tdv.org", category: a.body.item.key, sub: sub.body.item.key } });
  const dig = L.cats().find((c) => c.name === "Diğer Bağlantılar");
  assert.equal((await U.editor.call("PUT", `/admin/link-categories/${sub.body.item.key}`, { data: { parent: dig.key, name: "Vakıflar ve Dernekler" } })).status, 200);
  assert.deepEqual([C.getItem("link", l.body.id).category, C.getItem("link", l.body.id).sub], [dig.key, sub.body.item.key]);
  assert.equal(L.catGet(sub.body.item.key).name, "Vakıflar ve Dernekler");
  // alt kategoriyi üst düzeye almak
  assert.equal((await U.editor.call("PUT", `/admin/link-categories/${sub.body.item.key}`, { data: { parent: "" } })).status, 200);
  assert.deepEqual([C.getItem("link", l.body.id).category, C.getItem("link", l.body.id).sub], [sub.body.item.key, ""]);
  // sıralama
  const tops = L.cats().filter((c) => !c.parent);
  const reversed = tops.slice().reverse().map((c, i) => ({ key: c.key, order: (i + 1) * 10 }));
  assert.equal((await U.editor.call("PUT", "/admin/link-categories/order", { items: reversed })).status, 200);
  assert.deepEqual(L.cats().filter((c) => !c.parent).map((c) => c.key), reversed.map((x) => x.key));
  // silme: içinde bağlantı varsa taşınacak kategori sorulur; bağlantı silinmez
  const r1 = await U.yonetici.call("DELETE", `/admin/link-categories/${sub.body.item.key}`);
  assert.equal(r1.status, 409);
  assert.equal(r1.body.count, 1);
  const r2 = await U.yonetici.call("DELETE", `/admin/link-categories/${sub.body.item.key}?move_to=${dig.key}`);
  assert.equal(r2.status, 200, r2.text);
  assert.equal(r2.body.moved, 1);
  assert.equal(C.getItem("link", l.body.id).category, dig.key);
  assert.equal(L.catGet(sub.body.item.key), null);
  // alt kategorisi olan kategori silinemez
  const parentWithKid = L.cats().find((c) => L.cats().some((x) => x.parent === c.key));
  assert.equal((await U.yonetici.call("DELETE", `/admin/link-categories/${parentWithKid.key}?move_to=${dig.key}`)).status, 400);
});

test("Türkçe alfabetik sıralama (Ç, Ğ, I, İ, Ö, Ş, Ü) panelde ve sitede; açıklamaları göster / gizle; pasifler yayımlanmaz", async () => {
  const cat = L.cats().find((c) => c.name === "Bilimsel Dergiler");
  const names = ["Zeytin", "Üsküdar", "Uludağ", "Şura", "Sakarya", "Ömer", "Osman", "İslam", "Işık", "Ilgaz", "Ğ Harfi", "Gazi", "Çukurova", "Cumhuriyet", "Ankara"];
  for (const [i, n] of names.entries()) {
    const r = await U.editor.call("POST", "/admin/links", { data: { name: n + " Dergisi", url: `https://d${i}.example.org`, category: cat.key, desc: n + " açıklaması", order: String(100 - i) } });
    assert.equal(r.status, 200, r.text);
  }
  const expected = ["Ankara", "Cumhuriyet", "Çukurova", "Gazi", "Ğ Harfi", "Ilgaz", "Işık", "İslam", "Osman", "Ömer", "Sakarya", "Şura", "Uludağ", "Üsküdar", "Zeytin"].map((n) => n + " Dergisi");
  const az = await U.editor.call("GET", `/admin/links?cat=${cat.key}&sort=az&limit=100`);
  assert.deepEqual(az.body.items.map((x) => x.name), expected);
  const za = await U.editor.call("GET", `/admin/links?cat=${cat.key}&sort=za&limit=100`);
  assert.deepEqual(za.body.items.map((x) => x.name), expected.slice().reverse());
  const nw = await U.editor.call("GET", `/admin/links?cat=${cat.key}&sort=new&limit=100`);
  assert.equal(nw.body.items[0].name, "Ankara Dergisi");
  const manual = await U.editor.call("GET", `/admin/links?cat=${cat.key}&sort=manual&limit=100`);
  assert.equal(manual.body.items[0].name, "Ankara Dergisi", "öncelik 86 en küçük");
  // arama: Türkçe karakter ve büyük/küçük harf duyarsız
  assert.deepEqual((await U.editor.call("GET", `/admin/links?q=${encodeURIComponent("ISIK")}`)).body.items.map((x) => x.name), ["Işık Dergisi"]);
  assert.deepEqual((await U.editor.call("GET", `/admin/links?q=${encodeURIComponent("islam dergi")}`)).body.items.map((x) => x.name), ["İslam Dergisi"]);
  // bir bağlantının açıklaması gizli, bir bağlantı pasif, adı ve açıklaması HTML içeren bir bağlantı
  const isik = az.body.items.find((x) => x.name === "Işık Dergisi"), gazi = az.body.items.find((x) => x.name === "Gazi Dergisi");
  const v = (id) => C.itemVersion("link", id);
  assert.equal((await U.editor.call("PUT", `/admin/links/${isik.id}`, { data: { hide_desc: true }, version: v(isik.id) })).status, 200);
  assert.equal((await U.editor.call("PUT", `/admin/links/${gazi.id}`, { data: { status: "pasif" }, version: v(gazi.id) })).status, 200);
  assert.equal((await U.editor.call("POST", "/admin/links", { data: { name: "Tırnaklı", url: "https://kotu.example.org/?b=\"2\"", category: cat.key } })).status, 400, "adreste tırnak olamaz");
  const xss = await U.editor.call("POST", "/admin/links", { data: { name: "<img src=x onerror=alert(1)> Kötü", url: "https://kotu.example.org/?a=1&b=2", category: cat.key, desc: "<script>alert(1)</script>" } });
  assert.equal(xss.status, 200, xss.text);

  await realRun();
  assert.ok(rebuild.state.ok, rebuild.state.log);
  let page = site("baglantilar.html");
  const rows = linkRows(page).filter((r) => r.c === cat.key);
  assert.deepEqual(rows.map((r) => r.name).filter((n) => n.endsWith("Dergisi")), expected.filter((n) => n !== "Gazi Dergisi"), "sitede Türkçe A–Z; pasif yok");
  assert.ok(!page.includes("Gazi Dergisi"), "pasif bağlantı yayımlanmaz");
  assert.ok(page.includes("Ankara açıklaması") && !page.includes("Işık açıklaması"), "bağlantıya özel gizleme");
  assert.ok(!/<script>alert|<img src=x/.test(page), "ad ve açıklama kaçışlanır");
  assert.ok(page.includes("&lt;script&gt;alert(1)&lt;/script&gt;") && page.includes('href="https://kotu.example.org/?a=1&amp;b=2"'));
  for (const a of page.match(/<a class="lk-row"[^>]*>/g)) {
    assert.match(a, /target="_blank"/); assert.match(a, /rel="noopener noreferrer"/); assert.match(a, /href="https?:\/\//);
  }
  assert.match(page, /<input type="search" data-lk-q/);
  assert.match(page, /<select class="select lk-select" data-lk-cat/);
  assert.match(page, /<nav class="lk-side"/);
  assert.ok(page.includes('data-lk-empty hidden'), "sonuç bulunamadı mesajı");
  assert.ok(page.includes('href="baglantilar.html" aria-current="page"'), "menüde Bağlantılar");
  assert.ok(!/news-card|Devamını oku|class="comments"|og:type" content="article/.test(page), "haber görünümü yok");
  // Kaynaklar sayfası rehbere yönlendirir; eski ".asp" adresi yeni sayfaya
  assert.ok(site("kaynaklar.html").includes('href="baglantilar.html"'));
  const old = await fetch(base + "/links.asp?cmd=2", { redirect: "manual" });
  assert.deepEqual([old.status, old.headers.get("location")], [301, "/baglantilar.html"]);
  assert.equal((await fetch(base + "/baglantilar")).status, 200, "uzantısız adres");

  // genel ayar: açıklamalar kapalı; özel sıra
  const s = await U.editor.call("PUT", "/admin/links/settings", { values: { links_show_desc: false, links_sort: "manual", links_title: "Akademik Bağlantılar Rehberi", site_name: "Ele Geçirildi" } });
  assert.equal(s.status, 200, s.text);
  assert.deepEqual(s.body.changed.sort(), ["links_show_desc", "links_sort", "links_title"], "başka gruptaki ayar bu uçtan değiştirilemez");
  assert.equal((await U.moderator.call("PUT", "/admin/links/settings", { values: { links_show_desc: true } })).status, 403);
  await realRun();
  page = site("baglantilar.html");
  assert.ok(!page.includes("Ankara açıklaması") && !page.includes('class=lk-desc'), "açıklamalar gizli");
  assert.ok(page.includes("<h1>Akademik Bağlantılar Rehberi</h1>"));
  const manualRows = linkRows(page).filter((r) => r.c === cat.key).map((r) => r.name);
  assert.equal(manualRows[0], "Ankara Dergisi");
  assert.equal(manualRows[manualRows.length - 2], "Zeytin Dergisi", "öncelik verilmeyen bağlantı sona");
  await U.editor.call("PUT", "/admin/links/settings", { values: { links_show_desc: true, links_sort: "az", links_title: "Akademik Bağlantılar" } });
});

test("toplu işlemler: kategori değiştirme, aktif / pasif, silme ve geri alma", async () => {
  const cat = L.cats().find((c) => c.name === "Bilimsel Dergiler"), dig = L.cats().find((c) => c.name === "Diğer Bağlantılar");
  const ids = (await U.editor.call("GET", `/admin/links?cat=${cat.key}&limit=3`)).body.items.map((x) => x.id);
  assert.equal((await U.editor.call("POST", "/admin/links/bulk", { ids, action: "category", value: dig.key })).body.count, 3);
  assert.ok(ids.every((id) => C.getItem("link", id).category === dig.key));
  assert.equal((await U.editor.call("POST", "/admin/links/bulk", { ids, action: "status", value: "pasif" })).body.count, 3);
  assert.ok(ids.every((id) => C.getItem("link", id).status === "pasif"));
  assert.equal((await U.editor.call("POST", "/admin/links/bulk", { ids, action: "status", value: "silindi" })).status, 400);
  assert.equal((await U.editor.call("POST", "/admin/links/bulk", { ids: [], action: "status", value: "aktif" })).status, 400);
  const del = await U.yonetici.call("POST", "/admin/links/bulk", { ids, action: "delete" });
  assert.equal(del.body.count, 3);
  assert.ok(ids.every((id) => !C.getItem("link", id)));
  assert.equal((await U.yonetici.call("POST", "/admin/links/restore", { ids })).body.count, 3);
  assert.ok(ids.every((id) => C.getItem("link", id)), "geri alındı");
});

test("CSV içe aktarma: Windows-1254 ve ';' ayırıcı, ön izleme, hatalı ve mükerrer satırlar, yönetici onayından sonra kayıt", async () => {
  const csv = [
    "Bağlantı adı;URL;Açıklama;Kategori;Alt kategori;Durum",
    "İSNAD Atıf Sistemi;isnadsistemi.org;Atıf kılavuzu;Akademik Araştırma Merkezleri;;Aktif",
    "Şamil Dergisi;https://samil.example.edu.tr;;Bilimsel Dergiler;Yurt Dışı;Pasif",
    ";https://adsiz.example.org;;Dijital Kaynaklar;;Aktif",
    "Kötü adres;javascript:alert(1);;Dijital Kaynaklar;;Aktif",
    "KADER yeniden;https://dergipark.org.tr/tr/pub/kader;;Dergiler;;Aktif",
    "İkinci İSNAD;https://www.isnadsistemi.org/;;Akademik Araştırma Merkezleri;;Aktif",
    "Yeni Kategori Sitesi;https://yeni.example.org;;Çevrim İçi Arşivler;Belgeler;",
    "Durumu bozuk;https://bozuk.example.org;;Dijital Kaynaklar;;belki",
  ].join("\r\n");
  // Türkçe Excel'in kaydettiği gibi Windows-1254
  const enc = { "ç": 0xe7, "Ç": 0xc7, "ğ": 0xf0, "Ğ": 0xd0, "ı": 0xfd, "İ": 0xdd, "ö": 0xf6, "Ö": 0xd6, "ş": 0xfe, "Ş": 0xde, "ü": 0xfc, "Ü": 0xdc };
  const buf = Buffer.from([...csv].map((ch) => enc[ch] ?? ch.charCodeAt(0)));
  assert.equal((await U.moderator.call("POST", "/admin/links/import/preview", undefined, { raw: fileForm(buf, "baglantilar.csv", "text/csv") })).status, 403);
  const pv = await U.editor.call("POST", "/admin/links/import/preview", undefined, { raw: fileForm(buf, "baglantilar.csv", "text/csv") });
  assert.equal(pv.status, 200, pv.text);
  const by = Object.fromEntries(pv.body.rows.map((r) => [r.line, r]));
  assert.equal(by[2].data.name, "İSNAD Atıf Sistemi", "kodlama çözüldü");
  assert.equal(by[2].data.url, "https://isnadsistemi.org");
  assert.ok(by[2].ok && !by[2].duplicate);
  assert.equal(by[3].data.status, "pasif");
  assert.ok(by[3].new_sub, "Yurt Dışı alt kategorisi açılacak");
  assert.ok(!by[4].ok && !by[5].ok, "adsız ve javascript: satırları hatalı");
  assert.equal(by[6].duplicate.name, "KADER");
  assert.ok(!by[7].ok && /2\. satırla aynı adres/.test(by[7].errors.join()), "dosya içinde mükerrer");
  assert.ok(by[8].new_category && by[8].new_sub);
  assert.ok(!by[9].ok, "geçersiz durum");
  assert.deepEqual(pv.body.summary, { total: 8, ok: 3, invalid: 4, duplicates: 1, new_categories: ["Bilimsel Dergiler › Yurt Dışı", "Çevrim İçi Arşivler", "Çevrim İçi Arşivler › Belgeler"] });
  const before = C.listItems("link").length;
  assert.equal(C.listItems("link").length, before, "ön izleme kayıt yapmaz");
  // onay: geçerli satırlar gönderilir; sunucu yeniden doğrular (araya sızdırılmış kötü satır da reddedilir)
  const rows = pv.body.rows.filter((r) => r.ok).map((r) => ({ line: r.line, ...r.data }));
  rows.push({ line: 99, name: "Sızma", url: "javascript:alert(1)", category: "Dijital Kaynaklar", status: "aktif" });
  const cm = await U.editor.call("POST", "/admin/links/import/commit", { rows, skip_duplicates: true });
  assert.equal(cm.status, 200, cm.text);
  assert.deepEqual([cm.body.created, cm.body.skipped, cm.body.failed], [3, 1, 1]);
  assert.equal(C.listItems("link").length, before + 3);
  const arsiv = L.cats().find((c) => c.name === "Çevrim İçi Arşivler");
  assert.ok(arsiv && L.cats().some((c) => c.parent === arsiv.key && c.name === "Belgeler"));
  assert.ok(C.listItems("link").some((l) => l.name === "Şamil Dergisi" && l.status === "pasif"));
  // başlıksız dosya, eski .xls ve boş dosya anlaşılır hata verir
  assert.equal((await U.editor.call("POST", "/admin/links/import/preview", undefined, { raw: fileForm(Buffer.from("a;b\n1;2"), "x.csv", "text/csv") })).status, 400);
  assert.match((await U.editor.call("POST", "/admin/links/import/preview", undefined, { raw: fileForm(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0]), "x.xls", "application/vnd.ms-excel") })).body.error, /\.xls/);
  assert.equal((await U.editor.call("POST", "/admin/links/import/preview", undefined, { raw: fileForm(Buffer.from(""), "x.csv", "text/csv") })).status, 400);
});

test("dışa aktarma: CSV (formül enjeksiyonuna karşı) ve Excel; Excel dosyası yeniden içe aktarılabilir", async () => {
  await U.editor.call("POST", "/admin/links", { data: { name: "=HYPERLINK(\"http://kotu\")", url: "https://formul.example.org", category: "Dijital Kaynaklar", desc: "+1 şaşırtıcı" }, allow_duplicate: true });
  const c = await U.editor.call("GET", "/admin/links/export?format=csv");
  assert.equal(c.status, 200);
  assert.match(c.type, /text\/csv/);
  const table = SHEET.parseCsv(c.buf);
  assert.deepEqual(table[0], L.EXPORT_HEAD);
  assert.equal(table.length - 1, C.listItems("link").length);
  assert.ok(table.some((r) => r[1] === "'=HYPERLINK(\"http://kotu\")" && r[3] === "'+1 şaşırtıcı"), "formül olarak çalışmaz");
  const x = await U.editor.call("GET", "/admin/links/export?format=xlsx");
  assert.match(x.type, /spreadsheetml/);
  assert.equal(x.buf.readUInt32LE(0), 0x04034b50, "ZIP (xlsx)");
  const files = SHEET.unzip(x.buf);
  for (const f of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) assert.ok(files[f], f);
  const sheet = SHEET.parseXlsx(x.buf);
  assert.deepEqual(sheet[0], L.EXPORT_HEAD);
  assert.ok(sheet.some((r) => r[1] === "İSNAD Atıf Sistemi" && r[4] === "Akademik Araştırma Merkezleri"), "Türkçe karakterler korunur");
  assert.ok(sheet.some((r) => r[1] === "=HYPERLINK(\"http://kotu\")"), "Excel'de metin hücresi (formül değil)");
  assert.ok(!files["xl/worksheets/sheet1.xml"]().toString().includes("<f>"));
  // dışa aktarılan dosyayı geri yüklemek: hepsi mükerrer olarak işaretlenir, hiçbir şey çoğalmaz
  const pv = await U.editor.call("POST", "/admin/links/import/preview", undefined, { raw: fileForm(x.buf, "geri.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") });
  assert.equal(pv.status, 200, pv.text);
  assert.equal(pv.body.summary.ok, 0);
  assert.ok(pv.body.rows.filter((r) => r.ok).every((r) => r.duplicate));
  // biçimli ve paylaşılan metinli (sharedStrings) bir Excel dosyası da okunur
  const shared = SHEET.zip({
    "xl/workbook.xml": '<workbook xmlns:r="r"><sheets><sheet name="A" sheetId="1" r:id="rId1"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    "xl/sharedStrings.xml": "<sst><si><t>Bağlantı adı</t></si><si><t>URL</t></si><si><r><t>Kalın </t></r><r><t>Ad &amp; Soyad</t></r></si><si><t>https://paylasilan.example.org</t></si></sst>",
    "xl/worksheets/sheet1.xml": '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row></sheetData></worksheet>',
  });
  assert.deepEqual(SHEET.parseXlsx(shared), [["Bağlantı adı", "URL"], ["Kalın Ad & Soyad", "https://paylasilan.example.org"]]);
});

test("eski “Bağlantılar” haber kategorisi: kayıtlar raporlanır, onayla aktarılır, haberler silinmez, kategori sayfası yönlendirilir", async () => {
  const CAT = require("../src/categories");
  // canlıdaki durum: Bağlantılar (haber kategorisi) › Kişisel Sayfalar, içinde iki haber
  const root = CAT.create({ name: "Bağlantılar", menu_show: true, open_submit: true }, null);
  const kid = CAT.create({ name: "Kişisel Sayfalar", parent: root.key, menu_show: true }, null);
  const mkTopic = (title, forum, html) => C.saveItem("topic", null, C.applyFields("topic", null, { title, forum, body: html }, { name: "Yönetici" }), 1);
  const t1 = mkTopic("Mezhep.Org", root.key, '<p><a href="https://www.mezhep.org" target="_blank" rel="noopener">www.mezhep.org</a> sitemizin 2.0 sürümü.</p>');
  const t2 = mkTopic("Prof. Dr. Ahmet İshak DEMİR", kid.key, '<p><a href="https://www.ahmetishak.com">https://www.ahmetishak.com</a></p>');
  const t3 = mkTopic("Adressiz duyuru", root.key, "<p>Burada adres yok.</p>");
  const topicsBefore = C.listItems("topic").length;

  assert.equal((await U.moderator.call("GET", "/admin/links/legacy")).status, 403);
  const lg = await U.editor.call("GET", "/admin/links/legacy");
  assert.equal(lg.status, 200);
  assert.equal(lg.body.category.key, root.key, "“Bağlantılar” kategorisi kendiliğinden bulunur");
  assert.equal(lg.body.canRedirect, false, "Editör kategori sayfasını yönlendiremez");
  const it = Object.fromEntries(lg.body.items.map((x) => [x.id, x]));
  assert.equal(it[t1.id].url, "https://www.mezhep.org");
  assert.equal(it[t1.id].desc, "www.mezhep.org sitemizin 2.0 sürümü.");
  assert.equal(it[t2.id].url, "https://www.ahmetishak.com");
  assert.equal(it[t2.id].desc, "", "metin yalnızca adresse açıklama boş");
  assert.equal(it[t2.id].suggest, "Kişisel Sayfalar");
  assert.equal(it[t1.id].suggest, "Diğer Bağlantılar");
  assert.equal(it[t3.id].url, "");

  // Editör yönlendirme isteyemez
  assert.equal((await U.editor.call("POST", "/admin/links/legacy", { category: root.key, items: [], redirect: true })).status, 403);
  const tr = await U.editor.call("POST", "/admin/links/legacy", { category: root.key, items: [{ id: t1.id, target: it[t1.id].suggest_key }, { id: t2.id, target: "new:Kişisel Sayfalar" }, { id: t3.id, target: "" }] });
  assert.equal(tr.status, 200, tr.text);
  assert.equal(tr.body.created.length, 2);
  assert.equal(tr.body.skipped.length, 1, "adressiz haber atlanır");
  const l2 = C.getItem("link", tr.body.created.find((x) => x.topic === t2.id).link);
  assert.equal(l2.url, "https://www.ahmetishak.com");
  assert.equal(L.catGet(l2.category).name, "Kişisel Sayfalar");
  // haberler silinmedi, yalnızca işaretlendi
  assert.equal(C.listItems("topic").length, topicsBefore);
  assert.ok(C.getItem("topic", t1.id) && C.getItem("topic", t2.id));
  assert.equal(C.getItem("topic", t1.id).moved_to_link, tr.body.created[0].link);
  // ikinci kez aktarılmaz
  const again = await U.editor.call("POST", "/admin/links/legacy", { category: root.key, items: [{ id: t1.id, target: "" }] });
  assert.equal(again.body.created.length, 0);
  assert.match(again.body.skipped[0].error, /Daha önce aktarıldı/);
  // Süper Yönetici: eski kategori menüden kalkar, sayfası rehbere yönlenir
  const rd = await U.super.call("POST", "/admin/links/legacy", { category: root.key, items: [], redirect: true });
  assert.deepEqual(rd.body.redirected.sort(), [root.key, kid.key].sort());
  assert.equal(CAT.get(root.key).menu_show, false);
  await realRun();
  assert.ok(rebuild.state.ok, rebuild.state.log);
  const catPage = site(`kategori/${root.slug}.html`);
  assert.match(catPage, /http-equiv="refresh" content="0; url=\.\.\/baglantilar\.html"/);
  assert.match(site(`kategori/${kid.slug}.html`), /url=\.\.\/baglantilar\.html/);
  assert.ok(fs.existsSync(path.join(cfg.SITE_DIR, `haber/${t1.id}.html`)), "haber sayfası yerinde");
  assert.ok(!site("index.html").includes(`href="kategori/${root.slug}.html"`), "eski kategori menüde ve alt bilgide değil");
  const page = site("baglantilar.html");
  assert.ok(page.includes("Prof. Dr. Ahmet İshak DEMİR") && page.includes('href="https://www.ahmetishak.com"'));
  // yönlendirme haber kategorisi ekranından kaldırılabilir
  assert.equal((await U.super.call("PUT", `/admin/categories/${root.key}`, { data: { redirect: "" } })).status, 200);
  assert.equal(CAT.get(root.key).redirect, "");
  assert.equal((await U.super.call("PUT", `/admin/categories/${root.key}`, { data: { redirect: "https://kotu.example" } })).status, 400);
});

test("1000 bağlantı: içe aktarma, panel listesi (sunucuda sayfalama) ve site üretimi hızlı kalır", async () => {
  const header = "Bağlantı adı;URL;Açıklama;Kategori;Alt kategori;Durum";
  const cats = ["Üniversiteler ve İlahiyat Fakülteleri", "Kütüphaneler ve Veri Tabanları", "Dijital Kaynaklar", "Akademik Kuruluşlar"];
  const lines = Array.from({ length: 1000 }, (_, i) => `Kaynak ${String(i).padStart(4, "0")} Çalışmaları;https://kaynak${i}.example.org;${i}. örnek açıklama;${cats[i % 4]};Grup ${i % 7};Aktif`);
  const buf = Buffer.from([header, ...lines].join("\n"), "utf8");
  let t0 = Date.now();
  const pv = await U.editor.call("POST", "/admin/links/import/preview", undefined, { raw: fileForm(buf, "bin.csv", "text/csv") });
  assert.equal(pv.status, 200, pv.text);
  assert.equal(pv.body.summary.ok, 1000);
  const tPreview = Date.now() - t0;
  t0 = Date.now();
  const cm = await U.editor.call("POST", "/admin/links/import/commit", { rows: pv.body.rows.map((r) => ({ line: r.line, ...r.data })) });
  assert.equal(cm.body.created, 1000, cm.text);
  const tCommit = Date.now() - t0;
  const total = C.listItems("link").length;
  assert.ok(total > 1000);
  t0 = Date.now();
  const list = await U.editor.call("GET", "/admin/links?sort=az&offset=950&limit=50");
  const tList = Date.now() - t0;
  assert.equal(list.body.total, total);
  assert.equal(list.body.items.length, 50, "sunucu tek sayfa döndürür");
  t0 = Date.now();
  const q = await U.editor.call("GET", `/admin/links?q=${encodeURIComponent("KAYNAK 0999 calismalari")}`);
  const tSearch = Date.now() - t0;
  assert.deepEqual(q.body.items.map((x) => x.name), ["Kaynak 0999 Çalışmaları"]);
  const filtered = await U.editor.call("GET", `/admin/links?cat=${L.cats().find((c) => c.name === cats[0]).key}&limit=1`);
  assert.equal(filtered.body.total, 250, "kategori süzgeci");
  t0 = Date.now();
  await realRun();
  const tBuild = Date.now() - t0;
  assert.ok(rebuild.state.ok, rebuild.state.log);
  const page = site("baglantilar.html");
  assert.ok(linkRows(page).length >= 1000);
  assert.ok(Buffer.byteLength(page) < 2.5 * 1024 * 1024, `sayfa ${Buffer.byteLength(page)} bayt`);
  console.log(`1000 bağlantı: ön izleme ${tPreview} ms, kayıt ${tCommit} ms, liste ${tList} ms, arama ${tSearch} ms, site üretimi ${tBuild} ms, sayfa ${(Buffer.byteLength(page) / 1024).toFixed(0)} KB`);
  assert.ok(tList < 1500 && tSearch < 1500, "panel listesi ve arama");
  assert.ok(tPreview < 5000 && tCommit < 10000, "içe aktarma");
});

test("haber ve yazı modülleri etkilenmez", async () => {
  const r = await U.editor.call("POST", "/admin/items/topic", { data: { title: "Bağlantılar modülünden sonra haber", forum: "haber", body: "<p>Metin</p>" } });
  assert.equal(r.status, 200, r.text);
  assert.equal(C.getItem("topic", r.body.id).forum, "haber");
  const w = await U.editor.call("POST", "/admin/items/work", { data: { title: "Deneme Eser", author: "Yazar Deneme", category: "Kitaplar", type: "Telif" } });
  assert.equal(w.status, 200, w.text);
  await realRun();
  assert.ok(rebuild.state.ok, rebuild.state.log);
  assert.ok(site("haberler.html").includes("Bağlantılar modülünden sonra haber"));
  assert.ok(fs.existsSync(path.join(cfg.SITE_DIR, `eser/${w.body.id}.html`)));
});
