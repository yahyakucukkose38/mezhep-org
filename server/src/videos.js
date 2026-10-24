// Ana sayfa video modülü (oynatma listeleri) ve galerinin Videolar sekmesi (Mezhep.Org kanalı):
// YouTube'un herkese açık RSS akışını düzenli olarak çeker.
// Sonuç DATA_DIR/videos.json'a yazılır; liste değişince site yeniden üretilir. API anahtarı gerekmez.
const fs = require("node:fs");
const path = require("node:path");
const cfg = require("./config");

const FILE = path.join(cfg.DATA_DIR, "videos.json");
const SEED = path.join(cfg.SEED_DIR, "videos.json");
const PLAYLIST = /^PL[\w-]{10,40}$/;
const CHANNEL = /^UC[\w-]{22}$/;

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

async function fetchPlaylist(pid, param = "playlist_id") {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const r = await fetch(`https://www.youtube.com/feeds/videos.xml?${param}=` + encodeURIComponent(pid), { signal: ctrl.signal });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return parseFeed(pid, await r.text());
  } finally { clearTimeout(t); }
}

function load() {
  for (const f of [FILE, SEED]) {
    try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch {}
  }
  return { playlists: [], channel: null };
}

// Kanal akışı yalnızca en yeni 15 videoyu verir: önceki videolar korunup yenileri eklenir (arşiv zamanla tamamlanır).
function mergeVideos(oldList, newList) {
  const byId = new Map((oldList || []).map((v) => [v.id, v]));
  for (const v of newList) byId.set(v.id, v);
  return [...byId.values()].sort((a, b) => String(b.published).localeCompare(String(a.published)));
}

// Ayarlardaki listeleri (ve verilirse kanalı) çeker; alınamayanın eski kopyası korunur. Değişiklik varsa true döner.
// channelId verilmezse (undefined) kayıtlı kanal videolarına dokunulmaz; "" ise kanal kaldırılır.
async function refresh(ids, channelId) {
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
  let channel = old.channel || null;
  if (channelId !== undefined) {
    const cid = String(channelId || "").trim();
    if (!CHANNEL.test(cid)) channel = null;
    else {
      try {
        const feed = await fetchPlaylist(cid, "channel_id");
        const prev = old.channel && old.channel.id === cid ? old.channel.videos : [];
        channel = { id: cid, title: feed.title, videos: mergeVideos(prev, feed.videos) };
      } catch (e) {
        console.error(`[video] kanal ${cid} alınamadı: ${e.message}`);
      }
    }
  }
  const next = { playlists: lists, channel, updated: new Date().toISOString() };
  const changed = JSON.stringify(old.playlists) !== JSON.stringify(lists) || JSON.stringify(old.channel || null) !== JSON.stringify(channel);
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(next));
  return changed;
}

// Site ayarlarına göre: ana sayfa modülü açıksa oynatma listeleri, galeride video açıksa kanal.
function refreshFromSettings(SS) {
  return refresh(SS.get("home_show_videos") ? SS.get("videos_playlists") : [], SS.get("gallery_show_videos") ? SS.get("gallery_channel") : "");
}

module.exports = { load, refresh, refreshFromSettings, mergeVideos, parseFeed, PLAYLIST, CHANNEL };
