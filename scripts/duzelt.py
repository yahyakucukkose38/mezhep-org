"""Editoryal düzeltmeler: data/*.json üzerinde tekrar çalıştırılabilir (idempotent) temizlik.

Kullanım:  python scripts/duzelt.py [veri-klasörü]
Eski siteden gelen kodlama kalıntılarını, yer tutucuları, başlık yazımını ve unvan tutarsızlıklarını giderir.
Değişen her kayıt ekrana yazılır. Sunucuda içerik veritabanına aktarmak için: npm run yonetici -- icerik-yenile
"""
import json, os, re, sys

sys.stdout.reconfigure(encoding="utf-8")
DATA = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
load = lambda n: json.load(open(os.path.join(DATA, n + ".json"), encoding="utf-8"))
changes = []

# Tümü büyük harfli ya da yazım hatalı başlıklar (elle gözden geçirilmiş karşılıklar)
TITLE_FIX = {
    ("work", 650): "İslamofobinin İslâm Araştırmaları Üzerindeki Etkisi",
    ("topic", 192): "İmam Zeyd b. Ali Sempozyumu Ertelendi",
    ("topic", 190): "Uluslararası İmam Zeyd b. Ali Sempozyumu Ertelendi",
    ("topic", 181): "İslam Mezhepleri Sempozyumu, Mart 2016",
    ("topic", 170): "Yeni Doçentler",
    ("topic", 149): "2013 Koordinasyon ve Sempozyum Sonuç Bildirgesi",
    ("topic", 148): "2013 Şiî-Sünnî İlişkileri Sempozyumu",
    ("topic", 133): "Din-Kimlik, Alevilik-Bektaşilik Sempozyumu",
    ("topic", 76): "Uluslararası Türk Dünyasında Din Anlayışları Sempozyumu",
    ("topic", 1): "Mezhep.Org hakkında",
}
# Aynı eserin yinelenen kayıtları: {kalan: silinen}. Kalan kayıttaki boş alanlar silinenden doldurulur.
DUPLICATES = {360: 362, 504: 500}
RANK_FIX = {
    "Dr. Öğretim Üyesi": "Dr. Öğr. Üyesi", "Öğr. Grv. Dr.": "Öğr. Gör. Dr.", "YL. Öğrencisi": "Yüksek Lisans Öğrencisi",
    "Dr. Öğrencisi": "Doktora Öğrencisi", "Prof.": "Prof. Dr.",
}
TEXT_FIX = [("’;", "’"), ("&#59;", ";"), ("Transkiripsiyon", "Transkripsiyon"), ("SEMPZYUMU", "SEMPOZYUMU")]


def note(kind, oid, field, old, new):
    if old != new:
        changes.append((kind, oid, field, str(old)[:70], str(new)[:70]))
    return new


def text_fix(s):
    s = re.sub(r"[​‌‍⁠﻿]", "", s)  # görünmez karakterler (ör. e-posta içinde)
    for a, b in TEXT_FIX:
        s = s.replace(a, b)
    return s


def html_fix(h):
    h = text_fix(h)
    h = re.sub(r"(?<=\w)''(?=\w)", "'", h)                     # SQL kaçışından kalan çift kesme
    h = re.sub(r"^(\s*(<p>\s*</p>|<br>|<strong>\s*(<br>\s*)*</strong>))+", "", h)  # baştaki boş öğeler
    h = re.sub(r"(<br>\s*){3,}", "<br><br>", h)
    h = re.sub(r"<p>\s*</p>", "", h)
    h = re.sub(r"\s*<a [^>]*>\s*Geri Dön\s*</a>", "", h)
    if re.sub(r"<[^>]+>|\s", "", h).lower() in ("vy", "n/a", "-"):   # yalnızca yer tutucudan oluşan alan
        return ""
    return h.strip()


def title_fix(t):
    t = text_fix(t).strip()
    t = re.sub(r"^[\"“”]\s*(.*?)\s*[\"“”]\s*,?$", r"\1", t)   # baştan sona tırnak
    t = re.sub(r"\s*,$", "", t)
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"(?<=[A-Za-zÇĞİÖŞÜçğıöşüâîûÂÎÛ'])- (?=[A-Za-zÇĞİÖŞÜçğıöşüâîûÂÎÛ])", "-", t)  # "el- Hilli" → "el-Hilli"
    t = re.sub(r" (Ve|İle|Veya) ", lambda m: " " + {"Ve": "ve", "İle": "ile", "Veya": "veya"}[m.group(1)] + " ", t)
    t = re.sub(r"(?<=[a-zçğıöşüâîû]) B\. (?=[A-ZÇĞİÖŞÜÂÎ])", " b. ", t)          # "Ali B. Ebî" → "Ali b. Ebî"
    t = re.sub(r"(?<= )El-(?=[A-ZÇĞİÖŞÜÂÎ])", "el-", t)
    t = re.sub(r"(?<=[a-zçğıöşüâîû]):(?=[A-ZÇĞİÖŞÜa-zçğıöşü])", ": ", t)          # "İttifakı:Abdullah"
    t = re.sub(r"(?<=[a-zçğıöşüâîû])\((?=\d)", " (", t)                            # "Muaviye(129"
    t = re.sub(r"\bHz\.(?=[A-ZÇĞİÖŞÜ])", "Hz. ", t)
    return t


def contributor_fix(c):
    c = re.sub(r"(^|[,;]\s*)(Dr\.\s*)?vy\b\s*[,;]?\s*", r"\1", c).strip(" ,;")
    c = re.sub(r",\s*vy$", "", c)
    c = re.sub(r"Prof\.Dr\.", "Prof. Dr. ", c).replace("  ", " ")
    return "" if c in ("Dr.", "Prof. Dr.", "Doç. Dr.") else c


def first_email(e):
    found = re.findall(r"[^\s,;<>\"]+@[^\s,;<>\"]+\.[a-z]{2,}", text_fix(e or ""), re.I)
    return found[0] if found else ""


members, works, topics = load("members"), load("works"), load("topics")
files, links, albums = load("files"), load("links"), load("albums")

for m in members:
    oid = m["id"]
    m["name"] = note("akademisyen", oid, "name", m["name"], re.sub(r"\s{2,}", " ", m["name"].strip()))
    title = RANK_FIX.get(m["title"], m["title"])
    # 2018'de kaldırılan unvan: aktif öğretim elemanlarında yasal karşılığıyla gösterilir
    if title == "Yrd. Doç. Dr." and m["group"] == "Öğretim Elemanları":
        title = "Dr. Öğr. Üyesi"
    m["title"] = note("akademisyen", oid, "title", m["title"], title)
    m["rank"] = note("akademisyen", oid, "rank", m["rank"], RANK_FIX.get(m["rank"], m["rank"]))
    m["email"] = note("akademisyen", oid, "email", m["email"], first_email(m["email"]))
    m["bio"] = note("akademisyen", oid, "bio", m["bio"], html_fix(m["bio"]))
    for f in ("university", "city"):
        m[f] = note("akademisyen", oid, f, m[f], re.sub(r"\s{2,}", " ", text_fix(m[f]).strip()))

for w in works:
    oid = w["id"]
    w["title"] = note("eser", oid, "title", w["title"], TITLE_FIX.get(("work", oid)) or title_fix(w["title"]))
    w["contributor"] = note("eser", oid, "contributor", w["contributor"], contributor_fix(text_fix(w["contributor"])))
    for f in ("author", "place", "institution", "pages"):
        w[f] = note("eser", oid, f, w[f], re.sub(r"\s{2,}", " ", text_fix(w[f]).strip()))
    for f in ("ozet", "abstract"):
        w[f] = note("eser", oid, f, w[f], html_fix(w[f]))
by_id = {w["id"]: w for w in works}
for keep, drop in DUPLICATES.items():
    if keep in by_id and drop in by_id:
        k, d = by_id[keep], by_id[drop]
        for f, v in d.items():
            if f not in ("id", "hits", "added") and v and not k.get(f):
                k[f] = note("eser", keep, f, k.get(f), v)
        k["hits"] = k.get("hits", 0) + d.get("hits", 0)
        changes.append(("eser", drop, "-", "yinelenen kayıt", f"{keep} ile birleştirildi"))
works = [w for w in works if w["id"] not in DUPLICATES.values()]
# Eski sitede kalmış test kaydı (başlığı ve yazarı "deneme")
for w in [w for w in works if w["title"].strip().lower() == "deneme" and w["author"].strip().lower() == "deneme"]:
    changes.append(("eser", w["id"], "-", "test kaydı", "kaldırıldı"))
    works.remove(w)

for t in topics:
    oid = t["id"]
    t["title"] = note("konu", oid, "title", t["title"], TITLE_FIX.get(("topic", oid)) or title_fix(t["title"]))
    for i, p in enumerate(t["posts"]):
        p["html"] = note("konu", oid, f"posts[{i}]", p["html"], html_fix(p["html"]))
    if not t.get("summary") and t["posts"]:
        # ilk gönderi yalnızca görselse özet sonraki gönderilerden alınır
        txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", " ".join(p["html"] for p in t["posts"]))).strip()
        t["summary"] = note("konu", oid, "summary", "", txt[:260])

for f in files:
    f["name"] = note("dosya", f["id"], "name", f["name"], text_fix(f["name"]))
for a in albums:
    for p in a["photos"]:
        p["title"] = note("foto", p["id"], "title", p["title"], text_fix(p["title"]).strip())

for name, obj in [("members", members), ("works", works), ("topics", topics), ("files", files), ("links", links), ("albums", albums)]:
    with open(os.path.join(DATA, name + ".json"), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, indent=1)

for c in changes:
    print(" · ".join(str(x) for x in c))
print(f"\n{len(changes)} düzeltme uygulandı.")
