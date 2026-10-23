"""Önbelleğe alınmış mezhep.org sayfalarını yapılandırılmış JSON'a çevirir."""
import sys, os, re, json, html, hashlib, glob
from html.parser import HTMLParser
sys.stdout.reconfigure(encoding="utf-8")
CACHE, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)


def key(u):
    s = re.sub(r"[^A-Za-z0-9]+", "_", u)[:120]
    return os.path.join(CACHE, s + "_" + hashlib.md5(u.encode()).hexdigest()[:6] + ".html")


def load(u):
    p = key(u.replace("&amp;", "&").lstrip("/"))
    return open(p, encoding="utf-8", errors="replace").read() if os.path.exists(p) else ""


def text(h):
    h = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", "", h or "")
    h = re.sub(r"(?i)<br\s*/?>|</p>|</div>|</li>", "\n", h)
    h = re.sub(r"<[^>]+>", "", h)
    h = html.unescape(h).replace("\xa0", " ")
    h = re.sub(r"[ \t]+", " ", h)
    h = re.sub(r"\n\s*\n+", "\n\n", h)
    return h.strip()


def one(pat, h, d=""):
    m = re.search(pat, h, re.S | re.I)
    return m.group(1).strip() if m else d


# ---------- HTML temizleyici (haber gövdeleri, özetler) ----------
ALLOW = {"p", "br", "strong", "b", "em", "i", "u", "a", "img", "ul", "ol", "li", "h2", "h3", "h4",
         "blockquote", "table", "thead", "tbody", "tr", "td", "th", "sup", "sub"}
MAP = {"b": "strong", "i": "em", "h1": "h2", "font": None, "span": None, "div": "p"}
MEDIA = set()


def fix_url(u):
    u = html.unescape(u or "").strip()
    if not u or u.lower().startswith(("javascript", "mailto:mail")):
        return ""
    m = re.match(r"(?i)^(?:https?://(?:www\.)?mezhep\.org)?/?(files/.+)$", u)
    if m:
        MEDIA.add(m.group(1))
        return "{ROOT}media/" + m.group(1)
    if re.match(r"(?i)^(?:https?://(?:www\.)?mezhep\.org)?/?link\.asp\?TOPIC_ID=(\d+)", u):
        return "{ROOT}haber/%s.html" % re.search(r"TOPIC_ID=(\d+)", u, re.I).group(1)
    if re.match(r"(?i)^(?:https?://(?:www\.)?mezhep\.org)?/?eleman_read\.asp\?item=(\d+)", u):
        return "{ROOT}akademisyen/%s.html" % re.search(r"item=(\d+)", u, re.I).group(1)
    if re.match(r"(?i)^(?:https?://(?:www\.)?mezhep\.org)?/?eser_read\.asp\?item=(\d+)", u):
        return "{ROOT}eser/%s.html" % re.search(r"item=(\d+)", u, re.I).group(1)
    if u.startswith("http") or u.startswith("www."):
        return u if u.startswith("http") else "http://" + u
    return ""


class Clean(HTMLParser):
    def __init__(s):
        super().__init__(convert_charrefs=True); s.out = []; s.stack = []; s.skip = 0

    def handle_starttag(s, t, a):
        if t in ("script", "style", "o:p", "xml"): s.skip += 1; return
        t2 = MAP.get(t, t)
        if t2 is None or t2 not in ALLOW: return
        a = dict(a)
        if t2 == "a":
            u = fix_url(a.get("href"))
            if not u: s.stack.append(None); return
            ext = "" if u.startswith("{ROOT}") else ' target="_blank" rel="noopener"'
            s.out.append('<a href="%s"%s>' % (html.escape(u), ext)); s.stack.append("a"); return
        if t2 == "img":
            u = fix_url(a.get("src"))
            if u: s.out.append('<img src="%s" alt="%s" loading="lazy">' % (html.escape(u), html.escape(a.get("alt") or "")))
            return
        if t2 == "br": s.out.append("<br>"); return
        s.out.append("<%s>" % t2); s.stack.append(t2)

    def handle_endtag(s, t):
        if t in ("script", "style", "o:p", "xml"): s.skip = max(0, s.skip - 1); return
        t2 = MAP.get(t, t)
        if t2 is None or t2 not in ALLOW or t2 in ("img", "br"): return
        if t2 in s.stack:
            while s.stack:
                x = s.stack.pop()
                if x: s.out.append("</%s>" % x)
                if x == t2 or (t2 == "a" and x is None): break

    def handle_data(s, d):
        if not s.skip: s.out.append(html.escape(d, quote=False))

    def result(s):
        while s.stack:
            x = s.stack.pop()
            if x: s.out.append("</%s>" % x)
        h = "".join(s.out).replace("\xa0", " ")
        h = re.sub(r"<(strong|em|u|p|a[^>]*)>\s*</(strong|em|u|p|a)>", "", h)
        h = re.sub(r"(<br>\s*){3,}", "<br><br>", h)
        h = re.sub(r"<p>\s*(<br>\s*)*</p>", "", h)
        h = re.sub(r"[ \t]{2,}", " ", h)
        return h.strip()


def clean(h):
    c = Clean(); c.feed(h or ""); return c.result()


def para(h):
    """Kaçışlı HTML içeren alanları (özet vb.) güvenli paragraf HTML'ine çevirir."""
    raw = html.unescape(h or "")
    c = clean(raw)
    c = re.sub(r"^(\s*<br>)+|(<br>\s*)+$", "", c).strip()
    if c and not c.startswith("<p>"):
        c = "<p>" + re.sub(r"(<br>\s*){2,}", "</p><p>", c) + "</p>"
    return "" if not text(c) or text(c).lower() in ("abstract", "özet", "n/a") else c


# ---------- yardımcı: unvan ----------
RANKS = ["Prof. Dr.", "Doç. Dr.", "Dr. Öğr. Üyesi", "Yrd. Doç. Dr.", "Dr.", "Arş. Gör. Dr.", "Arş. Gör.", "Öğr. Gör. Dr.", "Öğr. Gör."]

# ---------- ELEMANLAR ----------
members = {}
groups = {}
for f in glob.glob(os.path.join(CACHE, "eleman_asp_cmd_2_*")):
    h = open(f, encoding="utf-8", errors="replace").read()
    for item, rest in re.findall(r'eleman_read\.asp\?item=(\d+)">(.*?)</a>', h):
        pass
for f in glob.glob(os.path.join(CACHE, "eleman_read_asp_item_*")):
    h = open(f, encoding="utf-8", errors="replace").read()
    mid = int(re.search(r"item_(\d+)_", f).group(1))
    crumbs = re.findall(r'href="eleman\.asp\?cmd=(\d)&amp;cid=(\d+)(?:&amp;sid=(\d+))?">([^<]+)</a>', h)
    group = next((c[3] for c in crumbs if c[0] == "1"), "")
    rank_cat = next((c[3] for c in crumbs if c[0] == "2"), "")
    name = text(one(r'print\.gif[^>]*></a>(.*?)</h4>', h))
    full = text(one(r'<font size="4">(.*?)</font>', h))
    title = full[: -len(name)].strip() if name and full.endswith(name) else ""
    uc = text(one(r"Üniversite \| İl :</b></td>\s*<td[^>]*>(.*?)</td>", h))
    uni, _, city = uc.partition("|")
    bio_raw = one(r"Öz Geçmiş</b>.*?<td class=\"fnorm\"[^>]*>(.*?)</td>", h)
    bio = clean(bio_raw)
    photo = one(r'<img src="\{ROOT\}(media/files/[^"]+)"', bio)
    if photo:
        bio = re.sub(r'<img src="\{ROOT\}%s"[^>]*>' % re.escape(photo), "", bio, count=1)
    bio = re.sub(r"<table>.*?</table>", lambda mm: mm.group(0) if len(text(mm.group(0))) > 40 else "", bio, flags=re.S)
    bio = re.sub(r"^(\s*(<br>|<strong>\s*</strong>|<strong>\s*<br>\s*</strong>))+", "", bio).strip()
    if "bilgilerinizi buraya" in bio or len(text(bio)) < 3: bio = ""
    web = one(r'Web:</b></td>\s*<td[^>]*>.*?<a href="([^"]*)"', h)
    web = web if re.match(r"https?://.+\..+", web or "") and web not in ("http://", "https://") else ""
    mail = one(r'href="mailto:([^"]*)"', h)
    mail = mail if "@" in mail else ""
    added = text(one(r"Ekl\. Tarihi:</b></td>\s*<td[^>]*>(.*?)</td>", h))
    hits = text(one(r"Tık:</b></td>\s*<td[^>]*>(.*?)</td>", h))
    members[mid] = dict(id=mid, name=name, title=title or rank_cat, rank=rank_cat, group=group,
                        university=uni.strip(), city=city.strip(), bio=bio, photo=photo, web=web, email=mail,
                        added=added, hits=int(hits) if hits.isdigit() else 0)
print("members", len(members))

# ---------- ESERLER ----------
works = {}
for f in glob.glob(os.path.join(CACHE, "eser_read_asp_item_*")):
    h = open(f, encoding="utf-8", errors="replace").read()
    wid = int(re.search(r"item_(\d+)_", f).group(1))
    crumbs = re.findall(r'href="eser\.asp\?cmd=(\d)&amp;cid=(\d+)(?:&amp;sid=(\d+))?">([^<]+)</a>', h)
    cat = next((c[3] for c in crumbs if c[0] == "1"), "")
    sub = next((c[3] for c in crumbs if c[0] == "2"), "")
    title = text(one(r'print\.gif[^>]*></a>(.*?)</h4>', h))

    def fld(label):
        v = one(r"<b>&nbsp;" + re.escape(label) + r"</b></td>\s*<td[^>]*>(.*?)</td>", h)
        parts = [p for p in text(v).split("|")]
        return "|".join("" if re.fullmatch(r"\s*(vy|n/a|-|yok|vy\s*,\s*vy|,)?\s*", p, re.I) else p for p in parts)

    place, _, year = text(fld("Basım Yeri | Yılı:")).partition("|")
    inst, _, pages = text(fld("Kurum (Dergi) | Sayfa:")).partition("|")
    author, _, email = text(fld("Yazar | E-posta:")).partition("|")
    contrib, _, ctype = text(fld("Emeği Geçen | Emek Türü:")).partition("|")
    url = text(fld("Tam Metin Adresi:"))
    notes = text(fld("Notlar:"))
    date, _, by = text(fld("Tarih | Gönderen:")).partition("|")
    hits = text(fld("Tık:"))
    ozet = para(one(r'Özet</td>\s*</tr>\s*<tr>\s*<td[^>]*>(.*?)</td>\s*</tr>', h))
    abstract = para(one(r'Abstract</td>\s*</tr>\s*<tr>\s*<td[^>]*>(.*?)</td>\s*</tr>', h))
    contrib = contrib.strip().strip(",").strip()
    # "Yrd. Doç. Dr., Ahmet Bağlıoğlu" -> "Yrd. Doç. Dr. Ahmet Bağlıoğlu"
    contrib = re.sub(r"^(.*?Dr\.|.*?Gör\.)\s*,\s*", r"\1 ", contrib)
    year = year.strip()
    works[wid] = dict(id=wid, title=title, author=author.strip(), category=cat, type=sub,
                      place=place.strip(), year=int(year) if year.isdigit() else None,
                      institution=inst.strip(), pages=pages.strip(),
                      contributor=contrib if contrib not in (",", "n/a") else "",
                      contribType=ctype.strip(), url=url if url.startswith("http") else "",
                      ozet=ozet, abstract=abstract, added=date.strip(), hits=int(hits) if hits.isdigit() else 0)
print("works", len(works))

# ---------- FORUM KONULARI (haber, etkinlik, kitap, sss...) ----------
FORUMS = {3: "haber", 2: "etkinlik", 4: "kitap", 7: "eser-tr", 6: "eser-ar", 8: "eser-en", 1: "sss", 5: "anket"}
topics = {}
for f in glob.glob(os.path.join(CACHE, "forum_asp_FORUM_ID_*")):
    h = open(f, encoding="utf-8", errors="replace").read()
    fid = int(re.search(r"FORUM_ID_(\d+)", f).group(1))
    rows = re.findall(r'forum_topic\.asp\?TOPIC_ID=(\d+)&(?:amp;)?FORUM_ID=\d+[^"]*">([^<]+)</a>(.*?)Gönderen:', h, re.S)
    for tid, t, rest in rows:
        tid = int(tid)
        nums = re.findall(r"<td[^>]*>\s*(?:<[^>]+>\s*)*(\d+)\s*(?:<[^>]+>\s*)*</td>", rest)
        topics.setdefault(tid, dict(id=tid, title=html.unescape(t).strip(), forum=FORUMS.get(fid, "diger"),
                                    sticky="Sabit:" in rest[:0] or False))
# fnews listesindeki başlıklar daha temiz
for f in glob.glob(os.path.join(CACHE, "fnews_asp_page_*")):
    h = open(f, encoding="utf-8", errors="replace").read()
    for tid, t in re.findall(r'link\.asp\?TOPIC_ID=(\d+)"[^>]*>(?:<[^>]+>)*([^<]{3,})<', h):
        tid, t = int(tid), html.unescape(t).strip()
        if tid not in topics and t not in ("Tamamını Oku",) and not t.startswith("Son Yorum"):
            topics[tid] = dict(id=tid, title=t, forum="haber")

POST_MAIN = re.compile(r"icon_mi_\d+\.gif[^>]*>\s*<span class=\"fSmall\">Posted&nbsp;-&nbsp;\s*([\d.]+)\s*&nbsp;:&nbsp;\s*([\d:]+).*?<hr noshade size=\"1\">\s*</td>\s*</tr>\s*<tr>\s*<td valign=\"top\">(.*?)</td>\s*</tr>\s*</table>", re.S)
POST_REPLY = re.compile(r"icon_mi_\d+\.gif[^>]*>\s*<span class=\"fSmall\">Tarih&nbsp;-&nbsp;([\d.]+)&nbsp;:&nbsp;([\d:]+)</span>\s*<hr noshade size=\"\">(.*?)<a href=\"#top\">", re.S)


class _Posts:
    def finditer(self, h):
        return sorted(list(POST_MAIN.finditer(h)) + list(POST_REPLY.finditer(h)), key=lambda m: m.start())


POST = _Posts()
AUTH = re.compile(r'cp_main\.asp\?cmd=8&(?:amp;)?member=\d+[\'"][^>]*>\s*(?:<[^>]+>\s*)*([^<]+?)\s*<', re.S)
for tid, t in list(topics.items()):
    h = load("link.asp?TOPIC_ID=%d" % tid)
    if not h:
        print("missing topic", tid); continue
    posts = []
    if not t.get("title") or t["title"].endswith("..."):
        tt = one(r"<title>(.*?) - www\.Mezhep\.Org", h)
        if tt: t["title"] = html.unescape(tt).strip()
    for m in POST.finditer(h):
        seg = h[max(0, m.start() - 6000): m.start()]
        authors = AUTH.findall(seg)
        body = clean(m.group(3))
        body = re.sub(r"^(\s*<br>)+|(<br>\s*)+$", "", body)
        if not text(body) and "<img" not in body: continue
        posts.append(dict(author=html.unescape(authors[-1]).strip() if authors else "", date=m.group(1), time=m.group(2), html=body))
    t["posts"] = posts
    if posts:
        t["date"], t["author"] = posts[0]["date"], posts[0]["author"]
        imgs = re.findall(r'<img src="([^"]+)"', posts[0]["html"])
        t["image"] = imgs[0] if imgs else ""
        t["summary"] = re.sub(r"\s+", " ", text(posts[0]["html"]))[:260]
topics = {k: v for k, v in topics.items() if v.get("posts")}
print("topics", len(topics), {f: sum(1 for t in topics.values() if t["forum"] == f) for f in set(FORUMS.values())})

# ---------- BAĞLANTILAR ----------
links = []
for f in glob.glob(os.path.join(CACHE, "links_asp_cmd_2_*")):
    h = open(f, encoding="utf-8", errors="replace").read()
    crumbs = re.findall(r'href="links\.asp\?cmd=(\d)&amp;cid=\d+(?:&amp;sid=\d+)?">([^<]+)</a>', h)
    cat = next((c[1] for c in crumbs if c[0] == "1"), "")
    sub = next((c[1] for c in crumbs if c[0] == "2"), "")
    for lid, name, rest in re.findall(r'links_pop\.asp\?mode=4&amp;cid=(\d+)[^>]*>(.*?)</a>(.*?)Tık:\s*\d+', h, re.S):
        bits = [b for b in text(rest).split("\n") if b.strip()]
        desc = next((b.strip() for b in bits if not b.strip().startswith(("Gönderen", "(", "Tarih"))), "")
        links.append(dict(id=int(lid), name=text(name), desc=desc, category=cat, sub=sub))
print("links", len(links))

# ---------- DOSYALAR ----------
files = []
h = load("dl.asp?cmd=2&cid=9&sid=30")
for fid, name, rest in re.findall(r'dl\.asp\?cmd=6&amp;cid=(\d+)">(.*?)</a>(.*?)(?=dl\.asp\?cmd=6|dl_add_form)', h, re.S):
    name = text(name)
    if any(f["id"] == int(fid) for f in files): continue
    bits = [b.strip() for b in text(rest).split("\n") if b.strip()]
    desc = next((b for b in bits if not b.startswith(("Gönderen", "(", "Tarih"))), "")
    dh = load("dl.asp?cmd=6&cid=%s" % fid)
    dl = one(r'href="(dl\.asp\?cmd=\d+&amp;cid=%s[^"]*(?:dl|download)[^"]*)"' % fid, dh)
    files.append(dict(id=int(fid), name=html.unescape(name).strip(), desc=desc, category="Fontlar",
                      date=one(r"Tarih:\s*([\d.]+)", rest)))
print("files", len(files))

# ---------- GALERİ ----------
albums = []
h = load("pic.asp")
cats = [(c, text(n)) for c, n in re.findall(r'pic\.asp\?cmd=1&amp;cid=(\d+)">(.*?)</a>', h)]
for cid, sid, name in re.findall(r'pic\.asp\?cmd=2&amp;cid=(\d+)&amp;sid=(\d+)">(.*?)</a>', h):
    name = re.sub(r"\s*\(\d+\)\s*$", "", text(name))
    cname = next((n for c, n in cats if c == cid), "")
    photos = []
    for fpath in sorted(glob.glob(os.path.join(CACHE, "pic_asp_cmd_2_cid_%s_sid_%s_*" % (cid, sid)))):
        ph = open(fpath, encoding="utf-8", errors="replace").read()
        for pid, tt, src in re.findall(r'pic\.asp\?cmd=6&amp;cid=(\d+)"><span class="fSubTitle"><b>(.*?)</b></span></a>\s*</td>\s*</tr>\s*<tr>\s*<td height="100"[^>]*>\s*<a[^>]*><img src="([^"]+_sm\.[A-Za-z]+)"', ph):
            if any(p["id"] == int(pid) for p in photos): continue
            sm = re.sub(r"(?i)^https?://www\.mezhep\.org/", "", src)
            MEDIA.add(sm); MEDIA.add(sm.replace("_sm.", "."))
            photos.append(dict(id=int(pid), title=html.unescape(tt).strip(), thumb="media/" + sm, src="media/" + sm.replace("_sm.", ".")))
    if photos:
        albums.append(dict(cid=int(cid), sid=int(sid), event=html.unescape(cname).strip(), name=html.unescape(name).strip(), photos=photos))
print("albums", len(albums), "photos", sum(len(a["photos"]) for a in albums))

# ---------- ANA SAYFA / POLİTİKA ----------
home = load("default.asp")
welcome = clean(one(r"Ziyaretçi Hoşgeldin Mesajı.*?<td[^>]*>(.*?)</td>", home))
policy = clean(one(r"Site Politikası(.*?)</table>", load("policy.asp")))

for name, obj in [("members", sorted(members.values(), key=lambda m: m["name"])),
                  ("works", sorted(works.values(), key=lambda w: w["id"])),
                  ("topics", sorted(topics.values(), key=lambda t: -t["id"])),
                  ("links", links), ("files", files), ("albums", albums),
                  ("pages", dict(welcome=welcome, policy=policy)), ("media", sorted(MEDIA))]:
    json.dump(obj, open(os.path.join(OUT, name + ".json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("media", len(MEDIA))
