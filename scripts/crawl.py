import sys, os, re, time, hashlib, urllib.request, http.cookiejar
from concurrent.futures import ThreadPoolExecutor
sys.stdout.reconfigure(encoding="utf-8")
BASE = "http://www.mezhep.org/"
CACHE = sys.argv[1]
os.makedirs(CACHE, exist_ok=True)
cj = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
op.addheaders = [("User-Agent", "Mozilla/5.0 (archive crawler)")]

def key(u):
    s = re.sub(r"[^A-Za-z0-9]+", "_", u)[:120]
    return os.path.join(CACHE, s + "_" + hashlib.md5(u.encode()).hexdigest()[:6] + ".html")

def get(u):
    u = u.replace("&amp;", "&").lstrip("/")
    p = key(u)
    if os.path.exists(p):
        return open(p, encoding="utf-8", errors="replace").read()
    for i in range(3):
        try:
            b = op.open(BASE + urllib.parse.quote(u, safe="?&=/:%+.,-_"), timeout=40).read()
            open(p, "wb").write(b)
            time.sleep(0.15)
            return b.decode("utf-8", "replace")
        except Exception as e:
            print("ERR", u, e); time.sleep(2)
    return ""

def pmap(f, xs):
    with ThreadPoolExecutor(4) as ex:
        return list(ex.map(f, xs))

def paged(first, pat):
    h = get(first)
    pages = [int(x) for x in re.findall(pat, h)]
    pages += [int(a or b) for a, b in re.findall(r"(?:Sayfa \d+ / |Page \d+ of )(\d+)|- (\d+) sayfa", h)]
    n = max(pages) if pages else 1
    return [h] + pmap(get, [re.sub(r"page=1\b", "page=%d" % i, first) if "page=1" in first else first + "&page=%d" % i for i in range(2, n + 1)])

def ids(htmls, pat):
    out = []
    for h in htmls:
        for x in re.findall(pat, h):
            if x not in out: out.append(x)
    return out

# ---- elemanlar
mem_sids = [(7, 9), (7, 10), (7, 11), (7, 12), (7, 14), (8, 15), (8, 16), (8, 17), (8, 18), (9, 19), (11, 20), (11, 21)]
mem_ids = []
for c, s in mem_sids:
    hs = paged("eleman.asp?cmd=2&cid=%d&sid=%d&page=1&mode=0&daysago=0" % (c, s), r"sid=%d&(?:amp;)?page=(\d+)" % s)
    mem_ids += ids(hs, r"eleman_read\.asp\?item=(\d+)")
hs = paged("eleman.asp?cmd=6&cid=0&sid=0&page=1&mode=0&daysago=0", r"cmd=6&(?:amp;)?cid=0&(?:amp;)?sid=0&(?:amp;)?page=(\d+)")
mem_ids = list(dict.fromkeys(mem_ids + ids(hs, r"eleman_read\.asp\?item=(\d+)")))
print("members", len(mem_ids))
pmap(lambda i: get("eleman_read.asp?item=" + i), mem_ids)

# ---- eserler
eser_sids = [(6, 8), (6, 9), (6, 10), (7, 11), (7, 12), (7, 13), (7, 14), (8, 15), (8, 16), (9, 17), (9, 18)]
eser_ids = []
for c, s in eser_sids:
    hs = paged("eser.asp?cmd=2&cid=%d&sid=%d&page=1&mode=0&daysago=0" % (c, s), r"sid=%d&(?:amp;)?page=(\d+)" % s)
    eser_ids += ids(hs, r"eser_read\.asp\?item=(\d+)")
hs = paged("eser.asp?cmd=6&cid=0&sid=0&page=1&mode=0&daysago=0", r"cmd=6&(?:amp;)?cid=0&(?:amp;)?sid=0&(?:amp;)?page=(\d+)")
eser_ids = list(dict.fromkeys(eser_ids + ids(hs, r"eser_read\.asp\?item=(\d+)")))
print("works", len(eser_ids))
pmap(lambda i: get("eser_read.asp?item=" + i), eser_ids)

# ---- haberler & forumlar
news_pages = pmap(get, ["fnews.asp?page=%d" % i for i in range(1, 15)])
topic_ids = ids(news_pages, r"link\.asp\?TOPIC_ID=(\d+)")
forums = [(3, 2), (2, 2), (4, 3), (7, 5), (6, 5), (8, 5), (1, 1), (5, 4)]
for f, c in forums:
    h = get("forum.asp?FORUM_ID=%d&CAT_ID=%d&whichpage=1" % (f, c))
    pages = [int(x) for x in re.findall(r"whichpage=(\d+)", h)] + [int(x) for x in re.findall(r"uzunlu\S* (\d+) sayfa", h)]
    hs = [h] + pmap(get, ["forum.asp?FORUM_ID=%d&CAT_ID=%d&whichpage=%d" % (f, c, i) for i in range(2, max(pages + [1]) + 1)])
    topic_ids += ids(hs, r"forum_topic\.asp\?TOPIC_ID=(\d+)")
topic_ids = list(dict.fromkeys(topic_ids))
print("topics", len(topic_ids))
pmap(lambda i: get("link.asp?TOPIC_ID=" + i), topic_ids)

# ---- yazılar, bağlantılar, dosyalar
for c, s in [(2, 9), (2, 10), (3, 3), (3, 4), (3, 5), (4, 2), (4, 1), (6, 13), (6, 12), (6, 11), (7, 14), (7, 15), (5, 6), (5, 8), (5, 7)]:
    get("links.asp?cmd=2&cid=%d&sid=%d" % (c, s))
pmap(lambda i: get("links.asp?cmd=6&cid=%d" % i), range(1, 12))
get("dl.asp?cmd=2&cid=9&sid=30")
for i in (1, 2, 3): get("dl.asp?cmd=6&cid=%d" % i)
get("article.asp?cmd=6")

# ---- resimler
h = get("pic.asp")
albums = list(dict.fromkeys(re.findall(r"pic\.asp\?cmd=2&(?:amp;)?cid=(\d+)&(?:amp;)?sid=(\d+)", h)))
for c, s in albums:
    paged("pic.asp?cmd=2&cid=%s&sid=%s&page=1" % (c, s), r"sid=%s&(?:amp;)?page=(\d+)" % s)
print("albums", len(albums))
get("policy.asp"); get("privacy.asp"); get("default.asp")
print("DONE")
