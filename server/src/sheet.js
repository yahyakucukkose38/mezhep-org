// CSV ve Excel (.xlsx) okuma / yazma; ek kütüphane gerekmez (.xlsx, içinde XML dosyaları bulunan bir ZIP arşividir).
// Okuma yalnızca ilk çalışma sayfasının hücre metinlerini döndürür: [[hücre, hücre…], …]
const zlib = require("node:zlib");

const MAX_UNZIPPED = 40 * 1024 * 1024; // sıkıştırma bombasına karşı açılmış dosya üst sınırı

// ---------------------------------------------------------------- CSV
// Türkçe Excel, CSV'yi çoğunlukla Windows-1254 kodlamasıyla ve ";" ayırıcıyla kaydeder: kodlama ve ayırıcı kendiliğinden bulunur.
function decodeText(buf) {
  if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString("utf8");
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder("utf-16le").decode(buf.subarray(2));
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("windows-1254").decode(buf); }
}

function parseCsv(input) {
  const text = (Buffer.isBuffer(input) ? decodeText(input) : String(input)).replace(/^﻿/, "");
  const first = text.split(/\r?\n/, 1)[0];
  const delim = [";", ",", "\t"].map((d) => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') cell += ch;
      else if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
    } else if (ch === '"' && cell === "") quoted = true;
    else if (ch === delim) { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// Excel formül enjeksiyonuna karşı: =, +, -, @ ile başlayan hücreler metin olarak işaretlenir
function toCsv(header, rows) {
  const cell = (v) => {
    let s = v == null ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}

// ---------------------------------------------------------------- ZIP
function unzip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error("ZIP arşivi değil");
  const count = buf.readUInt16LE(eocd + 10), files = {};
  let p = buf.readUInt32LE(eocd + 16), total = 0;
  for (let k = 0; k < count; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("Bozuk ZIP");
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf8", p + 46, p + 46 + nlen);
    p += 46 + nlen + xlen + clen;
    total += usize;
    if (total > MAX_UNZIPPED) throw new Error("Dosya çok büyük");
    const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    files[name] = () => {
      const raw = buf.subarray(start, start + csize);
      if (method === 0) return raw;
      if (method !== 8) throw new Error("Desteklenmeyen sıkıştırma");
      return zlib.inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED });
    };
  }
  return files;
}

function dosTime(d = new Date()) {
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

function zip(files) {
  const parts = [], central = [], t = dosTime();
  let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content, "utf8"), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data), nm = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(8, 8);
    lh.writeUInt16LE(t.time, 10); lh.writeUInt16LE(t.date, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18);
    lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(8, 10);
    ch.writeUInt16LE(t.time, 12); ch.writeUInt16LE(t.date, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20);
    ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    parts.push(lh, nm, comp);
    central.push(ch, nm);
    off += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22), n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

// ---------------------------------------------------------------- XLSX
const xmlDecode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_m, e) => {
  if (e[0] === "#") return String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" }[e.toLowerCase()];
});
const xmlEsc = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Hücre metni: biçimli parçalar (<r><t>…</t></r>) birleştirilir, okunuş (rPh) parçaları atılır
const runsText = (x) => [...String(x).replace(/<rPh\b[\s\S]*?<\/rPh>/g, "").replace(/<t\b[^>]*\/>/g, "").matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlDecode(m[1])).join("");
const colIndex = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+/g, "").toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

function parseXlsx(buf) {
  let z;
  try { z = unzip(buf); } catch { throw new Error("Excel dosyası okunamadı"); }
  const read = (n) => (z[n] ? z[n]().toString("utf8") : "");
  const shared = [...read("xl/sharedStrings.xml").matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => runsText(m[1]));
  // ilk çalışma sayfasının yolu: workbook.xml → ilişki kimliği → workbook.xml.rels
  let sheetPath = "xl/worksheets/sheet1.xml";
  const rid = (read("xl/workbook.xml").match(/<sheet\b[^>]*\br:id="([^"]+)"/) || [])[1];
  if (rid) {
    const rel = [...read("xl/_rels/workbook.xml.rels").matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => r.includes(`Id="${rid}"`));
    const target = rel && (rel.match(/Target="([^"]+)"/) || [])[1];
    if (target) sheetPath = target.startsWith("/") ? target.slice(1) : "xl/" + target.replace(/^\.\//, "");
  }
  const sheet = read(sheetPath);
  if (!sheet) throw new Error("Excel dosyasında çalışma sayfası bulunamadı");
  const rows = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1], inner = cm[2] || "";
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1], type = (attrs.match(/\bt="([^"]+)"/) || [])[1] || "n";
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let text = "";
      if (type === "s") text = shared[Number(v)] ?? "";
      else if (type === "inlineStr") text = runsText((inner.match(/<is>([\s\S]*?)<\/is>/) || [])[1] || "");
      else if (type === "b") text = v === "1" ? "1" : "0";
      else text = v != null ? xmlDecode(v) : "";
      const i = ref ? colIndex(ref) : row.length;
      while (row.length < i) row.push("");
      row[i] = text;
    }
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ""));
}

// Metin hücreleri satır içi (inlineStr) yazılır: Excel bunları formül olarak çalıştırmaz.
function toXlsx(header, rows, sheetName = "Sayfa1") {
  const col = (i) => { let s = ""; i++; while (i) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = (i - 1 - m) / 26; } return s; };
  const widths = header.map((h, i) => Math.min(60, Math.max(8, String(h).length + 2, ...rows.slice(0, 500).map((r) => String(r[i] ?? "").length + 2))));
  const cell = (v, ci, ri) => {
    const r = `${col(ci)}${ri + 1}`;
    if (v == null || v === "") return "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${r}"${ri === 0 ? ' s="1"' : ""}><v>${v}</v></c>`;
    return `<c r="${r}" t="inlineStr"${ri === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xmlEsc(v)}</t></is></c>`;
  };
  const data = [header, ...rows].map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => cell(v, ci, ri)).join("")}</row>`).join("");
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"', REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  return zip({
    "[Content_Types].xml": head + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    "_rels/.rels": head + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": head + `<workbook ${NS} xmlns:r="${REL}"><sheets><sheet name="${xmlEsc(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": head + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": head + `<styleSheet ${NS}><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>',
    "xl/worksheets/sheet1.xml": head + `<worksheet ${NS}><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` +
      `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols><sheetData>${data}</sheetData></worksheet>`,
  });
}

// Dosya adına ve içeriğe göre tablo okur
function readTable(buf, filename) {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  if (isZip || /\.xlsx$/i.test(filename || "")) return parseXlsx(buf);
  if (/\.xls$/i.test(filename || "") || (buf[0] === 0xd0 && buf[1] === 0xcf)) throw new Error("Eski Excel biçimi (.xls) desteklenmiyor; dosyayı Excel'de “.xlsx” ya da CSV olarak kaydedin");
  return parseCsv(buf);
}

module.exports = { parseCsv, toCsv, parseXlsx, toXlsx, readTable, unzip, zip };
