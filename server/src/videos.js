// Ana sayfadaki video modülü: YouTube oynatma listelerinin herkese açık RSS akışını düzenli olarak çeker.
// Sonuç DATA_DIR/videos.json'a yazılır; liste değişince site yeniden üretilir. API anahtarı gerekmez.
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config");

const FILE = path.join(cfg.DATA_DIR, "videos.json");
const SEED = path.join(cfg.SEED_DIR, "videos.json");
const PLAYLIST = /^PL[\w-]{10,40}$/;

const unescape = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

function parseFeed(pid, xml) {
  const title = unescape((xml.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim();
  const videos = [];
  for (const e of xml.match(/<entry>[\s\S]*?<\/entry>/g) || []) {
    const id = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    if (!id) continue;
    videos.push({
      id,
      title: unescape((e.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim(),
      published: ((e.match(/<published>([^<]+)<\/published>/) || [])[1] || "").slice(0, 10),
    });
  }
  return { id: pid, title, videos };
}

async function fetchPlaylist(pid) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch("https://www.youtube.com/feeds/videos.xml?playlist_id=" + encodeURIComponent(pid), { signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return parseFeed(pid, await r.text());
  } finally { clearTimeout(t); }
}

function load() {
  for (const f of [FILE, SEED]) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  }
  return { playlists: [] };
}

// Ayarlardaki listeleri çeker; bir liste alınamazsa onun eski kopyası korunur. Değişiklik varsa true döner.
async function refresh(ids) {
  ids = (ids || []).map((s) => String(s).trim()).filter((s) => PLAYLIST.test(s));
  const old = load();
  const lists = [];
  for (const pid of ids) {
    try { lists.push(await fetchPlaylist(pid)); } catch (e) {
      const prev = old.playlists.find((p) => p.id === pid);
      if (prev) lists.push(prev);
      console.error(`[video] ${pid} alınamadı: ${e.message}`);
    }
  }
  const next = { playlists: lists, updated: new Date().toISOString() };
  const changed = JSON.stringify(old.playlists) !== JSON.stringify(lists);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next));
  return changed;
}

module.exports = { load, refresh, parseFeed, PLAYLIST };
