"""data/media.json içindeki mezhep.org dosyalarını <proje>/media/ altına indirir."""
import sys, os, json, time, urllib.request, urllib.parse
from concurrent.futures import ThreadPoolExecutor
sys.stdout.reconfigure(encoding="utf-8")
proj = sys.argv[1]
paths = json.load(open(os.path.join(proj, "data", "media.json"), encoding="utf-8"))
ok = fail = skip = 0


def get(p):
    global ok, fail, skip
    out = os.path.join(proj, "media", *p.split("/"))
    if os.path.exists(out) and os.path.getsize(out) > 0:
        skip += 1; return
    os.makedirs(os.path.dirname(out), exist_ok=True)
    url = "http://www.mezhep.org/" + urllib.parse.quote(p)
    for i in range(3):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            b = urllib.request.urlopen(req, timeout=40).read()
            open(out, "wb").write(b); ok += 1; time.sleep(0.1); return
        except Exception as e:
            err = e; time.sleep(1.5)
    fail += 1; print("FAIL", p, err)


with ThreadPoolExecutor(4) as ex:
    list(ex.map(get, paths))
print("ok", ok, "skip", skip, "fail", fail)
