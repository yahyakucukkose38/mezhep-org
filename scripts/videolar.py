"""YouTube oynatma listelerinin herkese açık RSS akışından video listesini çeker → data/videos.json.

Kullanım:  python scripts/videolar.py [PLAYLIST_ID ...]
Liste verilmezse Prof. Dr. Ahmet İshak Demir'in iki listesi kullanılır (ahmetishak.com/galeri/videolar).
API anahtarı gerekmez; YouTube her liste için en yeni 15 videoyu verir.
Sunucu aynı işi server/src/videos.js ile kendiliğinden ve düzenli olarak yapar.
"""
import json, os, re, sys, html, urllib.request

sys.stdout.reconfigure(encoding="utf-8")
DEFAULT = ["PL2dGbrxqbayq3xI8tzCdfaF2SmIYw-sut", "PL2dGbrxqbayr22qpI3k0MAjPYjHV6NRHX"]
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "videos.json")


def fetch(pid):
    req = urllib.request.Request("https://www.youtube.com/feeds/videos.xml?playlist_id=" + pid, headers={"User-Agent": "Mozilla/5.0"})
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
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump({"playlists": lists}, f, ensure_ascii=False, indent=1)
    for l in lists:
        print(f"{l['title']}: {len(l['videos'])} video")
