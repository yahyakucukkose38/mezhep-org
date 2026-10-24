// Hanefî Fıkhı Asistanı testleri: OpenITI indeksleyici (sayfa, başlık, tekilleştirme, hariç eserler) ve
// sahte OpenAI ile iki aşamalı akış (Türkçe soru → Arapça terimler → kaynaklı Türkçe yanıt).
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mezhep-hanefi-"));
const KEY = "sk-test-GIZLIANAHTAR-1234567890abcdef";
Object.assign(process.env, {
  MZ_DATA_DIR: TMP, PUBLIC_ORIGIN: "http://127.0.0.1", OPENAI_API_KEY: KEY,
  AI_DAILY_REQUESTS_PER_USER: "50", AI_RATE_PER_MINUTE: "100", AI_MONTHLY_BUDGET_USD: "5",
});
delete process.env.OPENAI_MODEL;

// ---- sahte OpenAI: biçimli (json_schema) istek terim çağrısıdır, diğeri yanıt çağrısı
const calls = [];
let termsReply = JSON.stringify({ groups: [["مسح", "يمسح"], ["خف", "خفين"], ["يوم وليله", "مده"]] });
const mock = http.createServer((req, res) => {
  let body = "";
  req.on("data", (d) => (body += d));
  req.on("end", () => {
    const j = JSON.parse(body || "{}");
    calls.push(j);
    const text = j.text?.format ? termsReply : "Mukîm bir gün bir gece, misafir üç gün üç gece mesh eder [1].";
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({
      status: "completed",
      output: [{ type: "message", role: "assistant", content: [{ type: "output_text", text }] }],
      usage: { input_tokens: 500, input_tokens_details: { cached_tokens: 0 }, output_tokens: 100, output_tokens_details: { reasoning_tokens: 0 } },
    }));
  });
});

const { createApp } = require("../src/index");
const { db, seedIfEmpty } = require("../src/db");
const A = require("../src/auth");
const hanefi = require("../src/ai/hanefi");
const ai = require("../src/ai/service");
require("../src/rebuild").schedule = () => {};

const MESH = "المسح علي الخفين جائز بالسنة والاخبار فيه مستفيضة ويمسح المقيم يوما وليلة والمسافر ثلاثة ايام ولياليها وابتداؤها عقيب الحدث وهو قول ابي حنيفة وابي يوسف ومحمد رحمهم الله تعالي والمسح علي ظاهرهما خطوطا بالاصابع يبدا من قبل الاصابع الي الساق";
const ZEKAT = "ولا زكاة في الحلي عند الشافعي وعندنا تجب الزكاة في حلي النساء من الذهب والفضة اذا بلغ النصاب وحال عليه الحول لان النص لم يفصل بين المصوغ وغيره والذهب والفضة خلقا اثمانا فتجب الزكاة فيهما كيفما كانا";
const filler = (n) => Array.from({ length: n }, (_, i) => `# مسالة ${i} في البيع والاجارة والرهن والكفالة والحوالة والصلح والوكالة والشركة والمضاربة والوديعة والعارية والهبة`).join("\n");

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
    return { status: r.status, text, body: JSON.parse(text || "{}") };
  }
}
const admin = new Client(), uye = new Client();
let built;

test.before(async () => {
  await new Promise((r) => mock.listen(0, r));
  process.env.OPENAI_BASE_URL = `http://127.0.0.1:${mock.address().port}/v1`;
  const src = path.join(TMP, "hanefi");
  fs.mkdirSync(src);
  // XML'den dönüştürülmüş neşir: sayfa işareti sayfa BAŞINDA
  fs.writeFileSync(path.join(src, "593MerginaniHidaye.md"),
    "######OpenITI#\r\n#META# 010.BookTITLE :: الهداية\r\n#META#Header#End#\r\nPageV01P001\r\n= كتاب الطهارات قال الله تعالي يا ايها الذين امنوا\r\n" + filler(8) +
    "\r\nPageV01P028\r\n# | باب المسح علي الخفين\r\n# " + MESH + "\r\nPageV01P029\r\n# " + filler(3));
  // Shamela kökenli neşir (LibURI): sayfa işareti sayfa SONUNDA; Mebsût'un iki neşri — ikincisindeki aynı metin atlanmalı
  fs.writeFileSync(path.join(src, "483IbnAhmadSarahsi.Mabsut.1.md"),
    "######OpenITI#\n#META# 030.LibURI\t:: JK_000266\n#META#Header#End#\n# | كتاب الزكاة\n# " + ZEKAT + "\n" + filler(6) + " PageV02P191\n# " + filler(6) + "\n");
  fs.writeFileSync(path.join(src, "483SerahsiMebsutC2.md"),
    "######OpenITI#\n#META# 010.BookTITLE :: المبسوط\n#META#Header#End#\nPageV02P190\n# " + ZEKAT + "\n" + filler(6) + "\n");
  // Hanbelî eser: indekse alınmaz
  fs.writeFileSync(path.join(src, "1135IbnCumarTaglibiŞaybani.NaylMaarib.md"), "######OpenITI#\n#META#Header#End#\n# " + MESH + "\n" + filler(4));
  built = hanefi.buildIndex(src, hanefi.INDEX_FILE, () => {});

  seedIfEmpty();
  const mk = (email, role, status) => db.prepare("INSERT INTO users (email, name, password_hash, role, role_key, status) VALUES (?, ?, ?, ?, ?, ?)")
    .run(email, email.split("@")[0] + " Kişi", A.hashPassword("SifreDeneme123"), role, role === "admin" ? "super" : "uye", status);
  mk("admin@t.local", "admin", "active"); mk("uye@t.local", "member", "active");
  server = createApp().listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [c, e] of [[admin, "admin@t.local"], [uye, "uye@t.local"]]) {
    assert.equal((await c.call("POST", "/auth/login", { email: e, password: "SifreDeneme123" })).status, 200);
  }
});
test.after(() => {
  server.close(); mock.close(); hanefi.closeIndex(); db.close();
  fs.rmSync(TMP, { recursive: true, force: true });
});

test("Arapça normalleştirme: hareke, elif çeşitleri ve harf-i tarif", () => {
  assert.equal(hanefi.arNorm("الصَّلاةُ"), "الصلاه");
  assert.equal(hanefi.arNorm("أَإِآ"), "ااا");
  assert.equal(hanefi.indexText("والصلاة بالمسجد للمسافر الله"), "صلاه مسجد مسافر الله");
});

test("indeks: Hanefî olmayan eser alınmaz, aynı eserin ikinci neşrindeki tekrar metin atlanır", () => {
  assert.equal(built.files, 3);
  assert.ok(built.duplicates >= 1);
  const { DatabaseSync } = require("node:sqlite");
  const d = new DatabaseSync(hanefi.INDEX_FILE, { readOnly: true });
  const titles = d.prepare("SELECT DISTINCT title FROM docs").all().map((r) => r.title).sort();
  assert.deepEqual(titles, ["el-Hidâye", "el-Mebsût"]);
  const zekat = d.prepare("SELECT d.file FROM chunks c JOIN docs d ON d.id = c.doc_id WHERE c.body LIKE '%حلي النساء%'").all();
  assert.equal(zekat.length, 1);
  d.close();
});

test("arama: kavram grupları, cilt/sayfa (iki işaret düzeni) ve bab başlığı", () => {
  const r = hanefi.search([["مسح"], ["خفين"], ["يوم وليله"]]);
  assert.ok(r.length >= 1);
  assert.equal(r[0].title, "el-Hidâye");
  assert.equal(r[0].author, "Merğînânî");
  assert.match(r[0].heading, /باب المسح علي الخفين/);
  assert.match(hanefi.citeOf(r[0].page), /^c\. 1, s\. 28/);
  // sayfa sonu düzeni: işaretten önceki metin o sayfadır
  const z = hanefi.search([["زكاه"], ["حلي"]]);
  assert.equal(z[0].title, "el-Mebsût");
  assert.match(hanefi.citeOf(z[0].page), /^c\. 2, s\. 191/);
  assert.match(z[0].heading, /كتاب الزكاة/);
  assert.deepEqual(hanefi.search([["لا يوجد ابدا"]]), []);
});

test("durum: iki asistan da listelenir", async () => {
  // Akaid indeksi yok: yalnızca Hanefî asistanı açık görünür
  const st = await uye.call("GET", "/ai/status");
  assert.equal(st.body.enabled, true);
  assert.deepEqual(st.body.assistants.map((a) => a.key), ["hanefi"]);
  assert.match(st.body.assistants[0].welcome, /Hanefî/);
  assert.ok(st.body.assistants[0].suggestions.length >= 1);
});

test("Hanefî sorusu: önce düşünmesiz terim çağrısı, sonra kaynaklı yanıt; tek kullanım kaydı", async () => {
  db.exec("DELETE FROM ai_usage"); calls.length = 0;
  const r = await uye.call("POST", "/ai/chat", { assistant: "hanefi", message: "Mest üzerine mesh süresi ne kadardır?" });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.body.assistant, "hanefi");
  assert.equal(calls.length, 2);
  const [terms, answer] = calls;
  assert.equal(terms.model, "gpt-6-luna");
  assert.deepEqual(terms.reasoning, { effort: "none" });
  assert.equal(terms.max_output_tokens, 200);
  assert.equal(terms.text.format.type, "json_schema");
  assert.equal(terms.store, false);
  assert.match(answer.instructions, /Hanefî Fıkhı Asistanı/);
  assert.match(answer.input.at(-1).content, /\[1\] el-Hidâye \(Merğînânî, ö\. 593\) — .*باب المسح.* — c\. 1, s\. 28[\s\S]*يوما وليلة/);
  assert.equal(r.body.sources[0].cite.startsWith("c. 1, s. 28"), true);
  assert.match(r.body.sources[0].title, /el-Hidâye — Merğînânî/);
  const rows = db.prepare("SELECT * FROM ai_usage").all();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].assistant, "hanefi");
  assert.equal(rows[0].input_tokens, 1000);
  assert.equal(rows[0].output_tokens, 200);
  assert.ok(Math.abs(rows[0].cost_usd - (1000 * 0.10 + 200 * 0.50) / 1e6) < 1e-12);
  assert.equal(r.body.remaining.requests, 49);
});

test("bozuk terim çıktısında metindeki Arapça kelimelerle aranır", async () => {
  calls.length = 0;
  termsReply = "مسح الخفين";
  const r = await uye.call("POST", "/ai/chat", { assistant: "hanefi", message: "mesh nedir" });
  termsReply = JSON.stringify({ groups: [["مسح"], ["خف", "خفين"]] });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.body.sources.length >= 1);
});

test("bilinmeyen asistan 400; panelden kapatılan asistan 503, rapor asistana göre ayrılır", async () => {
  assert.equal((await uye.call("POST", "/ai/chat", { assistant: "yok", message: "deneme" })).status, 400);
  const put = await admin.call("PUT", "/admin/settings", { values: { ai_hanefi_enabled: false } });
  assert.equal(put.status, 200, put.text);
  const off = await uye.call("POST", "/ai/chat", { assistant: "hanefi", message: "mesh nedir" });
  assert.equal(off.status, 503);
  assert.equal(off.body.reason, "kapali");
  assert.equal((await uye.call("GET", "/ai/status")).body.enabled, false);
  await admin.call("PUT", "/admin/settings", { values: { ai_hanefi_enabled: true } });
  const rep = await admin.call("GET", "/admin/ai/usage?days=7");
  assert.equal(rep.status, 200);
  assert.ok(!rep.text.includes(KEY));
  const h = rep.body.byAssistant.find((x) => x.assistant === "hanefi");
  assert.ok(h && h.requests >= 1 && h.name === "Hanefî Fıkhı Asistanı");
  const cfg = rep.body.config.assistants.find((x) => x.key === "hanefi");
  assert.equal(cfg.on, true);
  assert.equal(cfg.index.works, 2);
  assert.equal(rep.body.config.assistants.find((x) => x.key === "akaid").index.ready, false);
});

test("varsayılan asistan Akaid'dir (indeksi yoksa 503)", async () => {
  const r = await uye.call("POST", "/ai/chat", { message: "hudus nedir" });
  assert.equal(r.status, 503);
  assert.equal(r.body.reason, "indeks");
  assert.equal(typeof ai.chat, "function");
});
