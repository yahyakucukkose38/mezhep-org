"""YouTube'un herkese açık RSS akışından video listelerini çeker → data/videos.json.

Kullanım:  python scripts/videolar.py [PLAYLIST_ID ...]
Galerinin Videolar sekmesi için Mezhep.Org kanalı (CHANNEL) da çekilir; önceki videolar korunur.
Liste verilmezse Prof. Dr. Ahmet İshak Demir'in iki listesi kullanılır (ahmetishak.com/galeri/videolar).
API anahtarı gerekmez; YouTube her liste için en yeni 15 videoyu verir.
Sunucu aynı işi server/src/videos.js ile kendiliğinden ve düzenli olarak yapar.
"""
import json, os, re, sys, html, urllib.request

sys.stdout.reconfigure(encoding="utf-8")
DEFAULT = ["PL2dGbrxqbayq3xI8tzCdfaF2SmIYw-sut", "PL2dGbrxqbayr22qpI3k0MAjPYjHV6NRHX"]
CHANNEL = "UCGFN07whsFRvjvB7TzK-bKg"  # Mezhep.Org (youtube.com/@mezheporg)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "videos.json")


def fetch(pid, param="playlist_id"):
    req = urllib.request.Request("https://www.youtube.com/feeds/videos.xml?%s=%s" % (param, pid), headers={"User-Agent": "Mozilla/5.0"})
    xml = urllib.request.urlopen(req, timeout=30).read().decode("utf-8")
    title = html.unescape(re.search(r"<title>(.*?)</title>", xml).group(1)).strip()
    videos = []
    for e in re.findall(r"<entry>(.*?)</entry>", xml, re.S):
        vid = re.search(r"<yt:videoId>([\w-]{11})</yt:videoId>", e)
        if not vid:
            continue
        videos.append({
            "id": vid.group(1),
            "title": html.unescape(re.search(r"<title>(.*?)</title>", e, re.S).group(1)).strip(),
            "published": (re.search(r"<published>([^<]+)</published>", e) or [None, ""])[1][:10],
        })
    return {"id": pid, "title": title, "videos": videos}


if __name__ == "__main__":
    ids = sys.argv[1:] or DEFAULT
    lists = [fetch(p) for p in ids]
    old = {}
    if os.path.exists(OUT):
        with open(OUT, encoding="utf-8") as f:
            old = json.load(f)
    ch = fetch(CHANNEL, "channel_id")
    prev = {v["id"]: v for v in ((old.get("channel") or {}).get("videos") or [])}
    prev.update({v["id"]: v for v in ch["videos"]})
    ch["videos"] = sorted(prev.values(), key=lambda v: v["published"], reverse=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"playlists": lists, "channel": ch}, f, ensure_ascii=False, indent=1)
    print(f"Kanal {ch['title']}: {len(ch['videos'])} video")
    for l in lists:
        print(f"{l['title']}: {len(l['videos'])} video")
