// Hanefî fıkhı kaynak arşivi: OpenITI biçimli Arapça metinleri (cilt/sayfa işaretli) parçalayıp SQLite FTS5 ile indeksler ve arar.
// İndeks ayrı bir veritabanındadır (DATA_DIR/hanefi.db); kaynak metinler depoya girmez.
// Aynı eserin farklı neşirleri (ör. iki ayrı Mebsût dosyası) parça düzeyinde tekilleştirilir.
const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const cfg = require("../config");

const INDEX_FILE = path.join(cfg.DATA_DIR, "hanefi.db");

// ---------------------------------------------------------------- eser kataloğu
// Dosya adındaki eser anahtarı → Türkçe künye. p: sıralama ağırlığı (mütûn ve fetva kitapları önde).
// Hanefî olmayan eserler (Hanbelî, Şâfiî, Mâlikî, İmâmî) ve mukayeseli fıkıh kitapları indekse alınmaz.
const EXCLUDE = /NaylMaarib|Kalvazani|HidayaIlaAvham|Saymari|AbiAzhari|IhtilafAimma/;
const BOOKS = [
  [/IhtilafAbiHanifa/, "İhtilâfü Ebî Hanîfe ve İbn Ebî Leylâ", "Ebû Yûsuf", 182, 1.1],
  [/Kasb/, "Kitâbü'l-Kesb", "İmam Muhammed eş-Şeybânî", 189, 1.0],
  [/MaharicFiHiyal/, "el-Mehâric fi'l-hiyel", "İmam Muhammed eş-Şeybânî", 189, 1.0],
  [/SiyarSagir/, "es-Siyerü's-sağîr", "İmam Muhammed eş-Şeybânî", 189, 1.1],
  [/Siyar/, "es-Siyer", "İmam Muhammed eş-Şeybânî", 189, 1.1],
  [/Asl/, "el-Asl", "İmam Muhammed eş-Şeybânî", 189, 1.3],
  [/Hassaf\.Hiyal/, "el-Hiyel", "Hassâf", 261, 1.0],
  [/Hassaf\.Nafakat/, "en-Nafakât", "Hassâf", 261, 1.0],
  [/IhtilafFukaha/, "İhtilâfü'l-fukahâ", "Tahâvî", 321, 1.0],
  [/Tahavi\.Muhtasar/,"Muhtasaru't-Tahâvî", "Tahâvî", 321, 1.3],
  [/SerhMuhtasarTahavi|ŞarhMuhtasarTahavi/, "Şerhu Muhtasari't-Tahâvî", "Cessâs", 370, 1.3],
  [/CuyunMasail/, "Uyûnü'l-mesâil", "Ebü'l-Leys es-Semerkandî", 373, 1.1],
  [/Kuduri\.Muhtasar/, "Muhtasaru'l-Kudûrî", "Kudûrî", 428, 1.5],
  [/Tacrid|Tecrid/, "et-Tecrîd", "Kudûrî", 428, 1.1],
  [/Nutaf/, "en-Nütef fi'l-fetâvâ", "Sugdî", 461, 1.1],
  [/Mabsut|Mebsut/, "el-Mebsût", "Serahsî", 483, 1.4],
  [/TuhfatFukaha|TuhfetulFukaha/, "Tuhfetü'l-fukahâ", "Alâeddin es-Semerkandî", 540, 1.3],
  [/Usmandi\.Tarika/, "Tarîkatü'l-hilâf", "Üsmendî", 552, 1.0],
  [/ŞarhNukat/, "Şerhu'n-Nüket", "Ebû Nasr el-Attâbî", 586, 1.0],
  [/BadaicSanai|BedaiusSanai/, "Bedâiu's-sanâi'", "Kâsânî", 587, 1.5],
  [/Hidaye/, "el-Hidâye", "Merğînânî", 593, 1.5],
  [/MuhitulBurhani/, "el-Muhîtü'l-Burhânî", "İbn Mâze", 616, 1.3],
  [/TuhfatMuluk/, "Tuhfetü'l-mülûk", "Zeynüddin er-Râzî", 666, 1.1],
  [/IhtiyarLiTaclil|Ihtiyar/, "el-İhtiyâr li-ta'lîli'l-Muhtâr", "Mevsılî", 683, 1.5],
  [/LubabFiCam/, "el-Lübâb fi'l-cem' beyne's-sünne ve'l-kitâb", "Menbicî", 686, 1.1],
  [/KanzDakaik/, "Kenzü'd-dekâik", "Nesefî", 710, 1.5],
  [/TabyinHakaik|TebyinulHakaik/, "Tebyînü'l-hakâik", "Zeylaî", 743, 1.4],
  [/Inaye|CinayaŞarhHidaya/, "el-İnâye şerhu'l-Hidâye", "Bâbertî", 786, 1.3],
  [/Tanbih/, "et-Tenbîh alâ müşkilâti'l-Hidâye", "İbn Ebi'l-İz", 792, 1.0],
  [/CavharaNayyira/, "el-Cevheretü'n-neyyira", "Haddâdî", 800, 1.3],
  [/BinayaŞarhHidaya/, "el-Binâye şerhu'l-Hidâye", "Bedreddin el-Aynî", 855, 1.3],
  [/MinhatSuluk/, "Minhatü's-sülûk", "Bedreddin el-Aynî", 855, 1.1],
  [/FathKadir/, "Fethu'l-Kadîr", "İbnü'l-Hümâm", 861, 1.4],
  [/MacmucRasail/, "Mecmûu resâil", "Kâsım b. Kutluboğa", 879, 1.0],
  [/TahricAhadith/, "Tahrîcü ehâdîsi'l-İhtiyâr", "Kâsım b. Kutluboğa", 879, 0.9],
  [/LisanHukkam/, "Lisânü'l-hükkâm", "İbnü'ş-Şıhne", 882, 1.1],
  [/DurarHukkam|DurerulHukkam/, "Dürerü'l-hükkâm şerhu Gureri'l-ahkâm", "Molla Hüsrev", 885, 1.4],
  [/MultekalEbhur/, "Mülteka'l-ebhur", "İbrâhim el-Halebî", 956, 1.5],
  [/TakmilatBahrRaik/, "Tekmiletü'l-Bahri'r-râik", "Tûrî", 1138, 1.2],
  [/BahrRaik|BahrurRaik/, "el-Bahru'r-râik", "İbn Nüceym", 970, 1.4],
  [/NahrFaik/, "en-Nehru'l-fâik", "Sirâceddin İbn Nüceym", 1005, 1.3],
  [/MacmacDamanat/, "Mecmau'd-damânât", "Bağdâdî", 1030, 1.1],
  [/MarakiFalah/, "Merâki'l-felâh şerhu Nûri'l-îzâh", "Şürünbülâlî", 1069, 1.5],
  [/NurIdah/, "Nûru'l-îzâh", "Şürünbülâlî", 1069, 1.5],
  [/MacmacAnhur|MecmeulEnhur/, "Mecmau'l-enhur", "Şeyhîzâde", 1078, 1.4],
  [/DurrMuhtar/, "ed-Dürrü'l-muhtâr", "Haskefî", 1088, 1.5],
  [/FatavaHindiyya/, "el-Fetâva'l-Hindiyye", "Şeyh Nizâm ve heyet", 1090, 1.5],
  [/CavharKulli/, "el-Cevherü'l-küllî", "Abdülganî en-Nablusî", 1143, 1.0],
  [/TakmilatRaddMuhtar/, "Kurretü uyûni'l-ahyâr (Tekmiletü Reddi'l-muhtâr)", "Alâeddin İbn Âbidîn", 1306, 1.3],
  [/RaddMuhtar|ReddulMuhtar/, "Reddü'l-muhtâr", "İbn Âbidîn", 1252, 1.6],
  [/LubabFiŞarhKitab/, "el-Lübâb fî şerhi'l-Kitâb", "Meydânî", 1298, 1.4],
  [/MurşidHayran/, "Mürşidü'l-hayrân", "Kadri Paşa", 1306, 1.2],
  // Abdülhay el-Leknevî'nin risâleleri (kısa adlarıyla)
  ...Object.entries({
    ImamKalam: "İmâmü'l-kelâm", TazkiratRaşid: "Tezkiretü'r-râşid", GayatMakal: "Gâyetü'l-makâl", AkamNafaiş: "el-Âkâmü'n-nefâis",
    FalakDavvar: "el-Felekü'd-devvâr", FalakMaşhun: "el-Felekü'l-meşhûn", Ibraz: "İbrâzü'l-gayy", InsafFiHukmIctikaf: "el-İnsâf fî hükmi'l-i'tikâf",
    KavlAşraf: "el-Kavlü'l-eşref", KavlCazim: "el-Kavlü'l-câzim", KavlManşur: "el-Kavlü'l-mensûr", KalamCamil: "el-Kelâmü'l-câmi'",
    RadcIhvan: "Rad'u'l-ihvân", TadvirFalak: "Tedvîrü'l-felek", TarvicCinan: "Tervîhu'l-cenân", TuhfatNubala: "Tuhfetü'n-nübelâ",
    TuhfatTalaba: "Tuhfetü't-talebe", HayrHabr: "Hayrü'l-haber", Ifsah: "el-İfsâh", IfadatHayr: "İfâdetü'l-hayr", RafcSatr: "Ref'u's-sitr",
    TahkikCacib: "Tahkîku'l-aceb", AhkamSivak: "Ahkâmü's-sivâk",
  }).map(([k, t]) => [new RegExp("Laknavi\\." + k), t, "Abdülhay el-Leknevî", 1304, 1.0]),
  [/Laknavi\./, null, "Abdülhay el-Leknevî", 1304, 0.95],
];

function bookOf(file) {
  const base = file.replace(/\.md$/i, "");
  const died = parseInt(base, 10) || 0;
  for (const [re, title, author, d, p] of BOOKS) {
    if (re.test(base)) return { title, author, died: d || died, priority: p };
  }
  return { title: null, author: null, died, priority: 1.0 };
}

// Aynı neşrin ciltleri tek anahtarda toplanır (…C1, ….1 → kök).
const editionOf = (file) => file.replace(/\.md$/i, "").replace(/(C\d+|\.\d+)$/, "");

// ---------------------------------------------------------------- Arapça normalleştirme
const DIAC = /[ؐ-ًؚ-ٰٟۖ-ۭـ]/g;
function arNorm(s) {
  return String(s).replace(DIAC, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي");
}
// Harf-i tarif ve bitişik edatlar atılır (الصلاة، والصلاة، بالصلاة، للصلاة → صلاه); kısa kelimelere dokunulmaz.
const PREFIX = /^(?:وال|فال|بال|كال|ال|لل)/;
function arToken(w) {
  const m = w.match(PREFIX);
  return m && w.length - m[0].length >= 3 ? w.slice(m[0].length) : w;
}
const arWords = (s) => arNorm(s).match(/[ء-ي]+/g) || [];
const indexText = (s) => arWords(s).map(arToken).join(" ");

// ---------------------------------------------------------------- dosya ayrıştırma
const MARK = /PageV(\d+)P(\d+)/g;
const STRONG_HEAD = /^\s*(?:#{1,3}\s*\|+|##\||=)\s*(.*)$/;

// Başlık satırının ardından metin de gelebilir ("= كتاب الطهارات قال الله تعالي…"): ilk durak kelimesinde kesilir.
const HEAD_STOP = new Set("قال قوله اعلم وهو هو ان اذا لما الحمد وفيه وفي يا فان وان وقال لان".split(" "));
function cleanHeading(s, short) {
  const t = s.replace(/\b(?:CHECK|AUTO)\b/g, "").replace(/[[\]{}()"«»*_|#=0-9٠-٩]/g, " ").replace(/\s+/g, " ").trim();
  const out = [];
  for (const w of t.split(/[:،.؛]/)[0].split(" ")) {
    if (out.length && (HEAD_STOP.has(w) || arToken(w) === arToken(out[out.length - 1]))) break;
    out.push(w);
    if (out.length >= (short ? (out[0] === "كتاب" ? 3 : 4) : 7)) break;
  }
  const h = out.join(" ").slice(0, 80);
  return /^بسم الله/.test(h) ? "" : h;
}

// Metni tek bir akışa çevirir; sayfa işaretlerinin ve başlıkların akıştaki konumlarını ayrıca tutar.
function parseFile(text) {
  const head = text.split(/#META#Header#End#?/);
  const header = head.length > 1 ? head[0] : "";
  const bodyRaw = head.length > 1 ? head.slice(1).join("") : text;
  // Shamela kökenli OpenITI dosyalarında işaret sayfa SONUNDADIR; XML'den dönüştürülenlerde sayfa BAŞINDADIR.
  const markAtEnd = /LibURI|SortField/.test(header);
  const marks = [], heads = [];
  // Parçalar dizide biriktirilir (büyük dizgeye tekrar tekrar regex uygulamak dosya boyutunun karesiyle yavaşlar).
  const parts = [];
  let len = 0, lastCh = "\n";
  const push = (t) => { parts.push(t); len += t.length; lastCh = t[t.length - 1]; };
  const add = (t) => {
    t = t.replace(/\s+/g, " ").trim();
    if (!t) return;
    if (lastCh !== "\n" && lastCh !== " ") push(" ");
    push(t);
  };
  const newPara = () => { if (lastCh !== "\n") push("\n"); };
  for (let line of bodyRaw.split(/\r?\n/)) {
    line = line.replace(/<[^>]{0,200}>|@[A-Z]+\d*@|~~|\bms\d+\b|\[\d+\]/g, " ");
    const h = line.match(STRONG_HEAD);
    if (h) {
      const title = cleanHeading(h[1].replace(MARK, ""), /^\s*=/.test(line));
      newPara();
      if (title.length >= 3) heads.push({ pos: len, kitab: /^كتاب\s/.test(title), text: title });
      line = h[1].replace(/^\s*\|*\s*(?:CHECK|AUTO)\b\s*/, "").replace(/^\[([^\]]*?)\d*\]/, "$1");
    } else if (/^\s*#\s/.test(line)) {
      line = line.replace(/^\s*#\s/, "");
      newPara();
    }
    let last = 0;
    for (const m of line.matchAll(MARK)) {
      add(line.slice(last, m.index));
      marks.push({ pos: len, v: +m[1], p: +m[2] });
      last = m.index + m[0].length;
    }
    add(line.slice(last));
  }
  // Künyesiz risâlelerde eser adı ilk başlıkta köşeli parantez içinde durur: "### | CHECK [امام الكلام1]"
  const named = bodyRaw.slice(0, 3000).match(/CHECK\s*\[([^\]\d]{3,80})\d*\]/);
  const name = named && !/^مقدم/.test(named[1].trim()) ? named[1].trim() : "";
  return { header, stream: parts.join(""), marks, heads, markAtEnd, name };
}

function pageAt(marks, pos, atEnd) {
  if (!marks.length) return null;
  // ikili arama: pos'tan küçük ya da eşit son işaret
  let lo = 0, hi = marks.length - 1, k = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (marks[mid].pos <= pos) { k = mid; lo = mid + 1; } else hi = mid - 1; }
  if (!atEnd) return k >= 0 ? marks[k] : null;
  // işaret sayfa sonunda: pos'tan sonraki ilk işaretin sayfası; sonda kalan metin bir sonraki sayfadır
  const next = marks[k + 1];
  if (next) return next;
  return { v: marks[k].v, p: marks[k].p + 1 };
}

function headingAt(heads, pos) {
  let kitab = "", bab = "";
  for (const h of heads) {
    if (h.pos > pos) break;
    if (h.kitab) { kitab = h.text; bab = ""; } else bab = h.text;
  }
  return [kitab, bab].filter(Boolean).join(" › ");
}

const MIN_CHUNK = 700, TARGET = 1200, MAX_CHUNK = 1600;
// heads: başlık konumları; parça, içine düşen ilk başlıkta kesilir (parçanın başlığı doğru olsun diye).
function* chunksOf(stream, heads = []) {
  let a = 0, hi = 0;
  while (a < stream.length) {
    let b = Math.min(stream.length, a + MAX_CHUNK);
    while (hi < heads.length && heads[hi].pos <= a) hi++;
    if (hi < heads.length && heads[hi].pos < b && heads[hi].pos - a >= 200) b = heads[hi].pos;
    else if (b < stream.length) {
      // tercihen 900-1600. karakter arasındaki son paragraf sonunda, yoksa ~1200. karakterden önceki boşlukta böl
      const win = stream.slice(a + MIN_CHUNK, b);
      const nl = win.lastIndexOf("\n");
      const cut = nl >= 0 && nl + MIN_CHUNK >= 900 ? nl : win.lastIndexOf(" ", TARGET - MIN_CHUNK);
      if (cut > 0) b = a + MIN_CHUNK + cut;
    }
    const body = stream.slice(a, b).trim();
    if (body.length > 60) yield { start: a, end: b, body };
    a = b;
  }
}

// ---------------------------------------------------------------- tekilleştirme (neşirler arası)
// 6 kelimelik dizilerin özetlerinden örnek alınır; parçanın yarısından fazlası aynı eserde görülmüşse atlanır.
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
function shingles(words) {
  const out = [];
  for (let i = 0; i + 6 <= words.length; i++) {
    const h = fnv(words.slice(i, i + 6).join(" "));
    if (h % 8 === 0) out.push(h);
  }
  return out;
}

// ---------------------------------------------------------------- indeks
function listFiles(srcDir) {
  return fs.readdirSync(srcDir).filter((f) => f.toLowerCase().endsWith(".md") && !EXCLUDE.test(f));
}

function metaOf(header) {
  const m = {};
  for (const l of header.split(/\r?\n/)) {
    const x = l.match(/^#META#\s*\d+\.(\w+)\s*::\s*(.*)$/);
    if (x && !m[x[1]] && x[2].trim() && !/^(NODATA|NOTGIVEN)$/.test(x[2].trim())) m[x[1]] = x[2].trim();
  }
  return m;
}

function buildIndex(srcDir, outFile = INDEX_FILE, log = console.log) {
  const files = listFiles(srcDir);
  // Eser → neşirler; başlık işareti yoğun olan neşir önce işlenir (sonrakiler yalnızca eksik kısımlarıyla katılır).
  const works = new Map();
  for (const f of files) {
    const b = bookOf(f);
    const key = b.title || editionOf(f).replace(/^\d+/, "");
    if (!works.has(key)) works.set(key, new Map());
    const ed = editionOf(f);
    const eds = works.get(key);
    if (!eds.has(ed)) eds.set(ed, []);
    eds.get(ed).push(f);
  }
  const tmp = outFile + ".yeni";
  fs.rmSync(tmp, { force: true });
  const db = new DatabaseSync(tmp);
  db.exec(`
    PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF; PRAGMA page_size = 8192;
    CREATE TABLE docs (id INTEGER PRIMARY KEY, file TEXT NOT NULL, title TEXT NOT NULL, author TEXT NOT NULL, died INTEGER, priority REAL NOT NULL);
    CREATE TABLE chunks (id INTEGER PRIMARY KEY, doc_id INTEGER NOT NULL, heading TEXT NOT NULL, page TEXT NOT NULL, body TEXT NOT NULL);
    CREATE VIRTUAL TABLE fts USING fts5(body, content = '', tokenize = 'unicode61');
  `);
  // İçeriksiz (content='') indeks: metin chunks tablosunda bir kez tutulur; FTS yalnızca normalleştirilmiş kelime dizinidir.
  const insDoc = db.prepare("INSERT INTO docs (file, title, author, died, priority) VALUES (?, ?, ?, ?, ?)");
  const insChunk = db.prepare("INSERT INTO chunks (doc_id, heading, page, body) VALUES (?, ?, ?, ?)");
  const insFts = db.prepare("INSERT INTO fts (rowid, body) VALUES (?, ?)");
  let kept = 0, dup = 0, chars = 0;
  db.exec("BEGIN");
  for (const [, eds] of works) {
    const seen = new Set();
    const ordered = [];
    for (const [, list] of eds) {
      list.sort((x, y) => x.localeCompare(y, "en", { numeric: true }));
      const parsed = list.map((f) => ({ f, ...parseFile(fs.readFileSync(path.join(srcDir, f), "utf8")) }));
      const size = parsed.reduce((n, p) => n + p.stream.length, 0) || 1;
      const score = parsed.reduce((n, p) => n + p.heads.length, 0) / size + (parsed.every((p) => p.marks.length) ? 1e-3 : 0);
      ordered.push({ parsed, score });
    }
    ordered.sort((x, y) => y.score - x.score);
    for (const { parsed } of ordered) {
      for (const p of parsed) {
        const b = bookOf(p.f), meta = metaOf(p.header);
        const title = b.title || (meta.BookSHORTTITLE || meta.BookTITLE || p.name || editionOf(p.f).replace(/^\d+[^.]*\./, "").replace(/([a-zçşğıöü])([A-ZÇŞĞİÖÜ])/g, "$1 $2")).slice(0, 120);
        const author = b.author || meta.AuthorSHORTNAME || meta.AuthorAKA || "";
        const docId = Number(insDoc.run(p.f, title, author, b.died || null, b.priority).lastInsertRowid);
        for (const c of chunksOf(p.stream, p.heads)) {
          const words = arWords(c.body);
          if (words.length < 12) continue;
          const sh = shingles(words);
          if (sh.length >= 4 && sh.filter((h) => seen.has(h)).length * 2 > sh.length) { dup++; continue; }
          for (const h of sh) seen.add(h);
          const from = pageAt(p.marks, c.start, p.markAtEnd), to = pageAt(p.marks, Math.max(c.start, c.end - 1), p.markAtEnd);
          const page = from ? (to && (to.v !== from.v || to.p !== from.p) ? `${from.v}:${from.p}-${to.v === from.v ? "" : to.v + ":"}${to.p}` : `${from.v}:${from.p}`) : "";
          const id = Number(insChunk.run(docId, headingAt(p.heads, c.start), page, c.body).lastInsertRowid);
          insFts.run(id, indexText(c.body));
          kept++; chars += c.body.length;
        }
      }
    }
  }
  db.exec("COMMIT");
  db.exec("INSERT INTO fts(fts) VALUES ('optimize')");
  db.exec("VACUUM");
  db.close();
  fs.renameSync(tmp, outFile);
  log(`[hanefi] ${files.length} dosya, ${works.size} eser, ${kept} parça (${(chars / 1e6).toFixed(0)} M karakter), ${dup} tekrar parça atlandı → ${outFile}`);
  return { files: files.length, works: works.size, chunks: kept, duplicates: dup };
}

// ---------------------------------------------------------------- arama
// groups: [["مسح", "مسح الخف"], ["مده"], …] — her grup bir kavram, içindekiler eş anlamlılar.
// Önce bütün kavramlar birlikte aranır; yeterli sonuç çıkmazsa sondaki kavramlar tek tek bırakılır.
function termOf(phrase) {
  const toks = arWords(phrase).map(arToken).filter((t) => t.length >= 2).slice(0, 4);
  if (!toks.length) return "";
  // tek kelime: 4+ harfliyse önek araması (ekleri yakalar); çok kelime: öbek araması ("يوم وليله")
  if (toks.length === 1) return toks[0].length >= 4 ? `"${toks[0]}"*` : `"${toks[0]}"`;
  return `"${toks.join(" ")}"`;
}
function groupQuery(group) {
  const alts = [...new Set(group.map(termOf).filter(Boolean))].slice(0, 6);
  return alts.length ? (alts.length === 1 ? alts[0] : "(" + alts.join(" OR ") + ")") : "";
}
function queriesFor(groups) {
  const parts = groups.map(groupQuery).filter(Boolean).slice(0, 6);
  const out = [];
  for (let n = parts.length; n >= 1; n--) out.push(parts.slice(0, n).join(" AND "));
  if (parts.length > 1) out.push(parts.join(" OR "));
  return out;
}

let reader = null;
function openIndex() {
  if (reader) return reader;
  if (!fs.existsSync(INDEX_FILE)) return null;
  reader = new DatabaseSync(INDEX_FILE, { readOnly: true });
  return reader;
}

function search(groups, { limit = 6, maxChars = 9000, perWork = 2 } = {}) {
  const db = openIndex();
  if (!db || !Array.isArray(groups) || !groups.length) return [];
  const match = db.prepare("SELECT rowid AS id, bm25(fts) AS b FROM fts WHERE fts MATCH ? ORDER BY b LIMIT 120");
  const get = db.prepare(`SELECT c.id, c.heading, c.page, c.body, d.title, d.author, d.died, d.priority
                          FROM chunks c JOIN docs d ON d.id = c.doc_id WHERE c.id = ?`);
  const picked = new Map();
  for (const q of queriesFor(groups)) {
    let rows;
    try { rows = match.all(q); } catch { continue; }
    const scored = rows.map((r) => ({ ...get.get(r.id), score: r.b })).filter((r) => r.id && !picked.has(r.id))
      .map((r) => ({ ...r, score: r.score * r.priority })).sort((x, y) => x.score - y.score);
    for (const r of scored) picked.set(r.id, r);
    if (picked.size >= limit * 3) break;
  }
  const out = [], perDoc = {};
  let used = 0;
  // Sonuçlar sorgu katmanı sırasıyla gelir (önce tüm kavramları içerenler); aynı eserden en çok perWork parça.
  for (const r of picked.values()) {
    if ((perDoc[r.title] = (perDoc[r.title] || 0) + 1) > perWork) continue;
    if (used + r.body.length > maxChars && out.length) break;
    used += r.body.length;
    out.push({ title: r.title, author: r.author, died: r.died, page: r.page, heading: r.heading, body: r.body });
    if (out.length >= limit) break;
  }
  return out;
}

// "2:145-146" → "c. 2, s. 145-146"
function citeOf(page) {
  const m = String(page || "").match(/^(\d+):(\d+)(?:-(?:(\d+):)?(\d+))?$/);
  if (!m) return "";
  const [, v, p, v2, p2] = m;
  if (v2 && v2 !== v) return `c. ${+v}, s. ${+p} – c. ${+v2}, s. ${+p2}`;
  return `c. ${+v}, s. ${+p}${p2 ? "-" + +p2 : ""}`;
}

function indexInfo() {
  const db = openIndex();
  if (!db) return { ready: false };
  return {
    ready: true,
    files: db.prepare("SELECT count(*) AS n FROM docs").get().n,
    works: db.prepare("SELECT count(DISTINCT title) AS n FROM docs").get().n,
    built: fs.statSync(INDEX_FILE).mtime.toISOString(),
  };
}

function closeIndex() { if (reader) { reader.close(); reader = null; } }

module.exports = { buildIndex, search, indexInfo, closeIndex, citeOf, queriesFor, arNorm, arToken, indexText, parseFile, pageAt, bookOf, INDEX_FILE, EXCLUDE };

// Komut satırı: node src/ai/hanefi.js <kaynak-klasörü>
if (require.main === module) {
  const dir = process.argv[2] || process.env.MZ_HANEFI_DIR;
  if (!dir || !fs.existsSync(dir)) { console.error("Kullanım: npm run kaynak-hanefi -- <openiti-klasörü>"); process.exit(1); }
  fs.mkdirSync(cfg.DATA_DIR, { recursive: true });
  const t = Date.now();
  buildIndex(dir);
  console.log(`[hanefi] ${((Date.now() - t) / 1000).toFixed(0)} sn`);
}
