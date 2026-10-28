"""Mezhep.Org statik site üreteci.

Kullanım:  python scripts/build.py
data/*.json dosyalarını okur ve sitenin tüm HTML sayfalarını proje köküne yazar.
Veriyi güncellemek için JSON dosyalarını düzenleyip betiği yeniden çalıştırmanız yeterlidir.

Sunucu (server/) aynı betiği ortam değişkenleriyle çağırır:
  MZ_DATA      JSON klasörü (varsayılan: data/)
  MZ_OUT       çıktı klasörü (varsayılan: proje kökü)
  MZ_DYNAMIC=1 üyelik özellikleri: giriş düğmesi, yorumlar, düzeltme önerisi bağlantıları
  MZ_MEDIA_DIR / MZ_UPLOAD_DIR  media/ ve uploads/ yollarının diskteki yeri (dosya var mı denetimi için)
"""
import json, os, re, html, random, unicodedata
from collections import Counter, defaultdict
from datetime import date
from urllib.parse import quote

PROJECT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.environ.get("MZ_OUT") or PROJECT
DATA = os.environ.get("MZ_DATA") or os.path.join(PROJECT, "data")
DYNAMIC = os.environ.get("MZ_DYNAMIC") == "1"
FILE_ROOTS = {"media/": os.environ.get("MZ_MEDIA_DIR") or os.path.join(ROOT, "media"),
              "uploads/": os.environ.get("MZ_UPLOAD_DIR") or os.path.join(ROOT, "uploads")}
# Sayfalardaki tek satır içi betik; sunucu CSP'si bunun özetine izin verir (server/src/index.js THEME_SCRIPT).
THEME_SCRIPT = 'document.documentElement.className="js";try{var t=localStorage.getItem("mz-theme");if(t)document.documentElement.dataset.theme=t}catch(e){}'
SITE = "Mezhep.Org"
SITE_URL = os.environ.get("MZ_SITE_URL", "https://mezhep.net/")
TODAY = date.today()


def load(name):
    with open(os.path.join(DATA, name + ".json"), encoding="utf-8") as f:
        return json.load(f)


members, works, topics = load("members"), load("works"), load("topics")
links, files, albums, pages = load("links"), load("files"), load("albums"), load("pages")

# Panelden yönetilen site ayarları (sunucu dışa aktarır: settings.json). Dosya yoksa (statik sürüm) varsayılanlar geçerli.
ST = {
    "site_name": "Mezhep.Org", "site_tagline": "İslam Mezhepleri Tarihi",
    "site_description": "İlahiyat ve İslami İlimler Fakülteleri İslam Mezhepleri Tarihi Anabilim Dalı Koordinasyon Sitesi: akademisyenler, tezler, kitaplar, makaleler, haberler ve etkinlikler.",
    "footer_about": "İlahiyat ve İslami İlimler Fakülteleri İslam Mezhepleri Tarihi Anabilim Dalı Koordinasyon Sitesi. 2006'dan beri alanın akademik hafızası.",
    "footer_note": "Ahmet İshak DEMİR adına", "contact_person": "Prof. Dr. Ahmet İshak DEMİR",
    "contact_institution": "Recep Tayyip Erdoğan Üniversitesi İlahiyat Fakültesi", "contact_email": "",
    "facebook_url": "https://www.facebook.com/Mezhep.Org/", "youtube_url": "https://www.youtube.com/@mezheporg",
    "x_url": "https://x.com/MezhepOrg",
    "banner_enabled": False, "banner_text": "", "banner_link": "", "banner_style": "bilgi",
    "home_eyebrow": "İslam Mezhepleri Tarihi Anabilim Dalı", "home_title": "Mezhepler tarihi çalışmalarının *ortak hafızası*",
    "home_lead": "Türkiye'deki İlahiyat ve İslami İlimler fakültelerinin İslam Mezhepleri Tarihi akademisyenlerini, tezlerini, kitaplarını ve makalelerini tek çatı altında, özetleriyle birlikte derliyoruz.",
    "home_quote": "Gelişmesi ve zenginleşmesi için İslam Mezhepleri ile ilgilenen herkesin katkılarını bekliyoruz.",
    "home_quote_sign": "Ahmet İshak DEMİR", "home_show_news": True, "home_news_count": 6,
    "home_show_coord": True, "home_show_works": True, "home_show_members": True,
    "home_show_youtube": True, "home_show_videos": False, "videos_eyebrow": "Prof. Dr. Ahmet İshak Demir",
    "videos_title": "Konuşmalar ve videolar", "videos_more_url": "https://www.ahmetishak.com/galeri/videolar/",
    "videos_channel_url": "https://www.youtube.com/@mezheporg",
    "gallery_show_videos": True, "gallery_channel": "UCGFN07whsFRvjvB7TzK-bKg",
}
if os.path.exists(os.path.join(DATA, "settings.json")):
    ST.update({k: v for k, v in load("settings").items() if v is not None})
SITE = ST["site_name"] or "Mezhep.Org"
# Ana sayfa video modülü (scripts/videolar.py ya da sunucu üretir)
_V = load("videos") if os.path.exists(os.path.join(DATA, "videos.json")) else {}
VIDEOS = _V.get("playlists") or []
# Galerinin Videolar sekmesi: Mezhep.Org YouTube kanalı (server/src/videos.js ya da scripts/videolar.py doldurur)
CHANNEL_VIDEOS = ((_V.get("channel") or {}).get("videos") or []) if ST.get("gallery_show_videos") else []
E = lambda s: html.escape(str(s or ""), quote=True)
def exists(p):
    for prefix, base in FILE_ROOTS.items():
        if p.startswith(prefix):
            return os.path.exists(os.path.join(base, *p[len(prefix):].split("/")))
    return os.path.exists(os.path.join(ROOT, *p.split("/")))
AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"]
AY_KISA = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"]


def fold(s):
    s = (s or "").replace("İ", "i").replace("I", "ı").lower()
    s = s.replace("ı", "i")
    s = unicodedata.normalize("NFKD", s)
    return re.sub(r"\s+", " ", "".join(c for c in s if not unicodedata.combining(c))).strip()


def parse_date(d):
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", d or "")
    return (int(m.group(3)), int(m.group(2)), int(m.group(1))) if m else (0, 0, 0)


def tr_date(d, short=False):
    y, m, g = parse_date(d)
    if not y: return ""
    return "%d %s %d" % (g, (AY_KISA if short else AYLAR)[m - 1], y)


def initials(name):
    p = [w for w in re.split(r"\s+", name or "") if w and w[0].isalpha()]
    return (p[0][0] + (p[-1][0] if len(p) > 1 else "")).upper() if p else "?"


def avatar(m, cls=""):
    inner = '<img src="{ROOT}%s" alt="" loading="lazy">' % E(m["photo"]) if m.get("photo") else initials(m["name"])
    return '<span class="avatar %s">%s</span>' % (cls, inner)


def _local_file(p):
    for prefix, base in FILE_ROOTS.items():
        if p.startswith(prefix):
            return os.path.join(base, *p[len(prefix):].split("/"))
    return os.path.join(ROOT, *p.split("/"))


_SIZES = {}


def img_size(p):
    """Yerel görselin piksel ölçüsü (genişlik, yükseklik) ya da None. Dosyanın yalnızca başlığı okunur."""
    if p in _SIZES:
        return _SIZES[p]
    size = None
    try:
        with open(_local_file(p), "rb") as f:
            head = f.read(32)
            if head[:8] == b"\x89PNG\r\n\x1a\n":
                size = (int.from_bytes(head[16:20], "big"), int.from_bytes(head[20:24], "big"))
            elif head[:6] in (b"GIF87a", b"GIF89a"):
                size = (int.from_bytes(head[6:8], "little"), int.from_bytes(head[8:10], "little"))
            elif head[:4] == b"RIFF" and head[8:12] == b"WEBP":
                f.seek(12); chunk = f.read(30)
                if chunk[:4] == b"VP8 ":
                    size = (int.from_bytes(chunk[14:16], "little") & 0x3FFF, int.from_bytes(chunk[16:18], "little") & 0x3FFF)
                elif chunk[:4] == b"VP8L":
                    b = chunk[9:13]
                    size = (1 + (((b[1] & 0x3F) << 8) | b[0]), 1 + (((b[3] & 0xF) << 10) | (b[2] << 2) | ((b[1] & 0xC0) >> 6)))
                elif chunk[:4] == b"VP8X":
                    size = (1 + int.from_bytes(chunk[12:15], "little"), 1 + int.from_bytes(chunk[15:18], "little"))
            elif head[:2] == b"\xff\xd8":
                f.seek(2)
                while True:
                    m = f.read(2)
                    if len(m) < 2 or m[0] != 0xFF:
                        break
                    if m[1] in (0xD8, 0x01) or 0xD0 <= m[1] <= 0xD7:
                        continue
                    ln = int.from_bytes(f.read(2), "big")
                    if m[1] in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                        d = f.read(5)
                        size = (int.from_bytes(d[3:5], "big"), int.from_bytes(d[1:3], "big"))
                        break
                    f.seek(ln - 2, 1)
    except OSError:
        size = None
    _SIZES[p] = size if size and all(size) else None
    return _SIZES[p]


def size_imgs(doc):
    """Yerel görsellere width/height (yer ayrılır, sayfa yüklenirken kaymaz) ve decoding="async" ekler."""
    def add(m):
        tag = m.group(0)
        if " width=" in tag:
            return tag
        wh = img_size(m.group(1))
        body = tag[:-2] if tag.endswith("/>") else tag[:-1]
        return body + (' width="%d" height="%d"' % wh if wh else "") + ' decoding="async">'
    return re.sub(r'<img src="\{ROOT\}((?:media|uploads)/[^"]+)"[^>]*>', add, doc)


def drop_missing(h):
    """Eski sunucuda bulunmayan yerel medya dosyalarına giden <img> ve bağlantıları temizler."""
    h = re.sub(r'<img src="\{ROOT\}(media/[^"]+)"[^>]*>', lambda m: m.group(0) if exists(m.group(1)) else "", h or "")
    return re.sub(r'<a href="\{ROOT\}(media/[^"]+)"[^>]*>(.*?)</a>', lambda m: m.group(0) if exists(m.group(1)) else m.group(2), h, flags=re.S)


def strip_tags(h):
    return html.unescape(re.sub(r"<[^>]+>", " ", h or "")).replace("\xa0", " ").strip()


# ---------------------------------------------------------------- ikonlar
I = {
    "search": '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    "users": '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    "book": '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
    "news": '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>',
    "calendar": '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
    "image": '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    "link": '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>',
    "info": '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
    "arrow": '<path d="M5 12h14M12 5l7 7-7 7"/>',
    "chev": '<path d="m9 18 6-6-6-6"/>',
    "moon": '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    "sun": '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
    "menu": '<path d="M4 6h16M4 12h16M4 18h16"/>',
    "x": '<path d="M18 6 6 18M6 6l12 12"/>',
    "left": '<path d="m15 18-6-6 6-6"/>',
    "up": '<path d="m18 15-6-6-6 6"/>',
    "ext": '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
    "file": '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    "grad": '<path d="M22 10 12 5 2 10l10 5 10-5Z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
    "pin": '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    "edit": '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    "copy": '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    "share": '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
    "mail": '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 5L2 7"/>',
    "yt": '<rect x="2" y="5" width="20" height="14" rx="4"/><path d="m10 9 5 3-5 3z" fill="currentColor"/>',
    "play": '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
    "fb": '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
    "download": '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    "star": '<path d="M12 2 14.6 9.4 22 12l-7.4 2.6L12 22l-2.6-7.4L2 12l7.4-2.6z"/>',
    "quote": '<path d="M3 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2H4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .01-1 1.03V20c0 1 0 1 1 1zM15 21c3 0 7-1 7-8V5c0-1.25-.76-2.02-2-2h-4c-1.25 0-2 .75-2 1.97V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z"/>',
}


def ic(n, cls=""):
    return '<svg class="%s" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">%s</svg>' % (cls, I[n])


STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.5l2.8 2.7h3.9v3.9l2.8 2.9-2.8 2.8v3.9h-3.9L12 21.5l-2.8-2.8H5.3v-3.9L2.5 12l2.8-2.9V5.2h3.9z"/><circle cx="12" cy="12" r="3.2"/></svg>'

PATTERN = '''<svg class="hero-pattern" width="100%" height="100%" aria-hidden="true"><defs><pattern id="girih" width="96" height="96" patternUnits="userSpaceOnUse"><g fill="none" stroke="currentColor" stroke-width="1.2"><path d="M48 8l11.3 28.7L88 48 59.3 59.3 48 88 36.7 59.3 8 48l28.7-11.3z"/><path d="M19.7 19.7h56.6v56.6H19.7z" transform="rotate(45 48 48)"/><rect x="19.7" y="19.7" width="56.6" height="56.6"/><circle cx="48" cy="48" r="10"/><path d="M0 0l19.7 19.7M96 0 76.3 19.7M0 96l19.7-19.7M96 96 76.3 76.3"/></g></pattern></defs><rect width="100%" height="100%" fill="url(#girih)"/></svg>'''

BIG_STAR = '<svg class="pattern" viewBox="0 0 100 100" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M50 4l13 33 33 13-33 13-13 33-13-33L4 50l33-13z"/><rect x="21" y="21" width="58" height="58" transform="rotate(45 50 50)"/><rect x="21" y="21" width="58" height="58"/><circle cx="50" cy="50" r="14"/><circle cx="50" cy="50" r="30"/></svg>'

# Menüdeki sabit sayfalar (categories.json "pages" yoksa); Haberler ve Etkinlikler birer kategoridir (bkz. kategoriler ve menü).
FIXED_PAGES = [dict(name="Ana Sayfa", href="index.html", menu_order=10), dict(name="Akademisyenler", href="akademisyenler.html", menu_order=20),
               dict(name="Eserler", href="eserler.html", menu_order=30), dict(name="Galeri", href="galeri.html", menu_order=60),
               dict(name="Kaynaklar", href="kaynaklar.html", menu_order=70), dict(name="Hakkında", href="hakkinda.html", menu_order=80)]


WRITTEN = set()


def remove_stale():
    """Silinen kayıtların eski detay sayfalarını kaldırır (ör. birleştirilen ya da panelden silinen eserler)."""
    removed = 0
    for d in ("akademisyen", "eser", "haber", "galeri", "kategori"):
        folder = os.path.join(ROOT, d)
        if not os.path.isdir(folder):
            continue
        for f in os.listdir(folder):
            if f.endswith(".html") and f"{d}/{f}" not in WRITTEN:
                os.remove(os.path.join(folder, f))
                removed += 1
    return removed


def abs_url(path):
    """Site içi yolu (ör. "{ROOT}uploads/a.jpg", "haber/5.html") mutlak HTTPS adrese çevirir; Türkçe karakterler kodlanır."""
    p = (path or "").replace("{ROOT}", "").strip()
    if not p:
        return ""
    if re.match(r"https?://", p):
        return p if p.startswith("https://") else ""
    return SITE_URL + quote(p.lstrip("/"), safe="/")


def iso_date(d):
    m = re.match(r"(\d{1,2})\.(\d{1,2})\.(\d{4})", d or "")
    return "%s-%02d-%02d" % (m.group(3), int(m.group(2)), int(m.group(1))) if m else ""


def x_handle():
    m = re.search(r"(?:x|twitter)\.com/([A-Za-z0-9_]{1,15})", ST.get("x_url") or "")
    return "@" + m.group(1) if m else ""


def meta_tags(path, title, desc, share):
    """Sosyal medya botlarının okuduğu önizleme etiketleri (HTML çıktısında; JavaScript gerektirmez)."""
    share = share or {}
    canon = SITE_URL + ("" if path == "index.html" else quote(path, safe="/"))
    img = share.get("image") or ""
    default = not img
    if default:
        img = SITE_URL + "assets/img/og-%s.jpg" % share.get("og", "genel")
    alt = share.get("alt") or title
    tags = [
        f'<link rel="canonical" href="{E(canon)}">',
        f'<meta property="og:type" content="{"article" if share.get("article") else "website"}">',
        f'<meta property="og:url" content="{E(canon)}">',
        f'<meta property="og:title" content="{E(title)}">',
        f'<meta property="og:description" content="{E(desc)}">',
        f'<meta property="og:site_name" content="{E(SITE)}">',
        '<meta property="og:locale" content="tr_TR">',
        f'<meta property="og:image" content="{E(img)}">',
        f'<meta property="og:image:alt" content="{E(alt)}">',
    ]
    if default:
        tags += ['<meta property="og:image:width" content="1200">', '<meta property="og:image:height" content="630">', '<meta property="og:image:type" content="image/jpeg">']
    if share.get("published"):
        tags.append(f'<meta property="article:published_time" content="{share["published"]}">')
    tags += ['<meta name="twitter:card" content="summary_large_image">']
    if x_handle():
        tags.append(f'<meta name="twitter:site" content="{x_handle()}">')
    tags += [f'<meta name="twitter:title" content="{E(title)}">', f'<meta name="twitter:description" content="{E(desc)}">',
             f'<meta name="twitter:image" content="{E(img)}">', f'<meta name="twitter:image:alt" content="{E(alt)}">']
    return "\n".join(tags)


# ---------------------------------------------------------------- paylaşım bileşeni (tüm ayrıntı sayfalarında ortak)
SHARE_ICONS = {
    "whatsapp": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#25D366" d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"/></svg>',
    "telegram": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#26A5E4" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/></svg>',
    "linkedin": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0A66C2" d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>',
    "pinterest": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#BD081C" d="M12.017 0C5.396 0 .029 5.367.029 11.987c0 5.079 3.158 9.417 7.618 11.162-.105-.949-.199-2.403.041-3.439.219-.937 1.406-5.957 1.406-5.957s-.359-.72-.359-1.781c0-1.663.967-2.911 2.168-2.911 1.024 0 1.518.769 1.518 1.688 0 1.029-.653 2.567-.992 3.992-.285 1.193.6 2.165 1.775 2.165 2.128 0 3.768-2.245 3.768-5.487 0-2.861-2.063-4.869-5.008-4.869-3.41 0-5.409 2.562-5.409 5.199 0 1.033.394 2.143.889 2.741.099.12.112.225.085.345-.09.375-.293 1.199-.334 1.363-.053.225-.172.271-.401.165-1.495-.69-2.433-2.878-2.433-4.646 0-3.776 2.748-7.252 7.92-7.252 4.158 0 7.392 2.967 7.392 6.923 0 4.135-2.607 7.462-6.233 7.462-1.214 0-2.354-.629-2.758-1.379l-.749 2.848c-.269 1.045-1.004 2.352-1.498 3.146 1.123.345 2.306.535 3.55.535 6.607 0 11.985-5.365 11.985-11.987C23.97 5.39 18.592.026 11.985.026L12.017 0z"/></svg>',
}


def share_block(path, title, desc="", image="", target=""):
    """Paylaş alanı: bağlantılar JavaScript olmadan da çalışır; kopyalama, mobil paylaşım menüsü ve
    (sunucu sürümünde) tıklama sayımı app.js tarafından eklenir. Instagram web üzerinden gönderi paylaşımına
    izin vermediği için yer almaz; mobilde sistemin paylaşım menüsü Instagram'ı da sunar."""
    url = SITE_URL + quote(path, safe="/")
    q = lambda v: quote(v, safe="")
    t, u = q(title), q(url)
    via = x_handle()[1:]
    # (anahtar, açıklama: bilgi balonu ve ekran okuyucu adı, adres, simge)
    nets = [
        ("whatsapp", "WhatsApp'ta Paylaş", "https://wa.me/?text=%s" % q(title + " " + url), SHARE_ICONS["whatsapp"]),
        ("facebook", "Facebook'ta Paylaş", "https://www.facebook.com/sharer/sharer.php?u=%s" % u, BRAND["facebook"][1]),
        ("x", "X'te Paylaş", "https://x.com/intent/tweet?text=%s&url=%s%s" % (t, u, ("&via=" + via) if via else ""), BRAND["x"][1]),
        ("telegram", "Telegram'da Paylaş", "https://t.me/share/url?url=%s&text=%s" % (u, t), SHARE_ICONS["telegram"]),
        ("linkedin", "LinkedIn'de Paylaş", "https://www.linkedin.com/sharing/share-offsite/?url=%s" % u, SHARE_ICONS["linkedin"]),
    ]
    if image:
        nets.append(("pinterest", "Pinterest'te Paylaş", "https://www.pinterest.com/pin/create/button/?url=%s&media=%s&description=%s" % (u, q(image), t), SHARE_ICONS["pinterest"]))
    # Düğmelerde yalnızca simge var; adları aria-label (ekran okuyucu, dokunmatik) ve data-tip (fareyle bilgi balonu) taşır.
    btn = lambda tag, cls, label, inner, attrs: f'<{tag} class="share-btn is-{cls}" {attrs} aria-label="{label}" data-tip="{label}">{inner}</{tag}>'
    links = "".join(btn("a", k, label, svg, f'href="{E(h)}" target="_blank" rel="noopener" data-share="{k}"') for k, label, h, svg in nets)
    mail = "mailto:?subject=%s&body=%s" % (t, q((desc + "\n\n" if desc else "") + url))
    return (f'<section class="share" data-share-box data-url="{E(url)}" data-title="{E(title)}" data-text="{E(desc)}" data-target="{E(target)}" aria-label="Bu sayfayı paylaşın">'
            f'<div class="share-head"><span class="share-title">{ic("share")} Paylaş</span></div>'
            f'<div class="share-list">'
            + btn("button", "native", "Diğer uygulamalarla paylaş", ic("share"), 'type="button" data-share-native hidden')
            + links
            + btn("a", "email", "E-posta ile Paylaş", ic("mail"), f'href="{E(mail)}" data-share="eposta"')
            + btn("button", "copy", "Bağlantıyı Kopyala", ic("link"), 'type="button" data-share-copy data-share="kopyala"')
            + '</div><span class="share-status" data-share-status role="status" aria-live="polite"></span></section>')


def nav_html(r, active):
    """Ana menü: masaüstünde açılır alt menü, tablet ve telefonda aynı yapı alt alta (style.css .nav-item)."""
    out = ""
    for e in MENU:
        here = bool(active) and (e["href"] == active or any(x["href"] == active for x in e["children"]))
        cur = (' aria-current="page"' if e["href"] == active else ' aria-current="true"') if here else ""
        a = '<a href="%s%s"%s>%s</a>' % (r, e["href"], cur, E(e["name"]))
        if not e["children"]:
            out += a
            continue
        subs = "".join('<a href="%s%s"%s>%s</a>' % (r, x["href"], ' aria-current="page"' if x["href"] == active else "", E(x["name"])) for x in e["children"])
        out += (f'<div class="nav-item">{a}<button class="nav-sub-btn" type="button" aria-expanded="false" aria-label="{E(e["name"])}: alt menü">{ic("chev")}</button>'
                f'<div class="nav-sub">{subs}</div></div>')
    return out


def footer_current(r):
    """Alt bilgi "Güncel" sütunu: menüdeki kategoriler (alt kategorileriyle), galeri ve kaynaklar."""
    links = [(cat_url(c), c["name"]) for c in CAT_LIST if in_menu(c)]
    links += [("galeri.html", "Fotoğraf Galerisi"), ("kaynaklar.html", "Kaynaklar")]
    return "".join('<li><a href="%s%s">%s</a></li>' % (r, h, E(t)) for h, t in links)


def layout(path, title, body, desc="", active="", data=None, share=None):
    depth = path.count("/")
    r = "../" * depth
    nav = nav_html(r, active)
    data_tag = ""
    if data is not None:
        data_tag = '<script type="application/json" id="page-data">%s</script>' % json.dumps(data, ensure_ascii=False).replace("</", "<\\/")
    full_title = "%s · %s" % (title, SITE) if title != SITE else "%s · İslam Mezhepleri Tarihi Koordinasyon Sitesi" % SITE
    doc = f'''<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{E(full_title)}</title>
<meta name="description" content="{E(desc or ST["site_description"])}">
{meta_tags(path, title, desc or ST["site_description"], share) if path != "404.html" else '<meta name="robots" content="noindex">'}
<meta name="theme-color" content="#2a4862">
<link rel="icon" href="{r}assets/img/favicon.png" type="image/png">
<link rel="apple-touch-icon" href="{r}assets/img/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Amiri:wght@400;700&family=Fraunces:ital,opsz,wght@0,9..144,400..700;1,9..144,400..600&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{r}assets/css/style.css">
<script>{THEME_SCRIPT}</script>{'<meta name="mz-dynamic" content="1">' if DYNAMIC else ""}
</head>
<body data-root="{r}">
<a class="skip" href="#main">İçeriğe geç</a>{banner_html()}
<header class="site-header">
  <div class="container">
    <a class="brand" href="{r}index.html" aria-label="{SITE} ana sayfa"><img class="brand-logo" src="{r}assets/img/logo.jpg" alt="" width="59" height="40"><span>{E(SITE)}<small>{E(ST["site_tagline"])}</small></span></a>
    <nav class="nav" aria-label="Ana menü">{nav}</nav>
    <div class="header-actions">
      <button class="search-trigger" data-open-search type="button" aria-label="Sitede ara">{ic("search")}<span>Sitede ara…</span><kbd>Ctrl K</kbd></button>
      <button class="icon-btn theme-toggle" type="button" aria-label="Temayı değiştir">{ic("moon", "moon")}{ic("sun", "sun")}</button>
      {'<div class="account" data-account><a class="btn btn-primary btn-sm acc-login" href="/panel/#/giris" aria-label="Giriş yap / Üye ol">' + ic("users") + '<span>Giriş</span></a></div>' if DYNAMIC else ""}
      <button class="icon-btn menu-btn" type="button" aria-label="Menüyü aç" aria-expanded="false">{ic("menu")}</button>
    </div>
  </div>
</header>
<main id="main">
{body}
</main>
{social_rail()}
<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div>
        <a class="brand" href="{r}index.html"><img class="brand-logo" src="{r}assets/img/logo.jpg" alt="Mezhep.Org logosu" width="59" height="40"><span>{E(SITE)}<small>{E(ST["site_tagline"])}</small></span></a>
        <p>{E(ST["footer_about"])}</p>
        <div class="socials">{social_links()}</div>
      </div>
      <div><h4>Keşfet</h4><ul><li><a href="{r}akademisyenler.html">Akademisyenler</a></li><li><a href="{r}eserler.html">Eserler</a></li><li><a href="{r}eserler.html#tur=Doktora">Doktora Tezleri</a></li><li><a href="{r}eserler.html#tur=Yüksek Lisans">Yüksek Lisans Tezleri</a></li></ul></div>
      <div><h4>Güncel</h4><ul>{footer_current(r)}</ul></div>
      <div><h4>Site</h4><ul><li><a href="{r}hakkinda.html">Hakkında</a></li><li><a href="{r}hakkinda.html#sss">Sık Sorulanlar</a></li><li><a href="{r}hakkinda.html#kosullar">Kullanım Koşulları</a></li><li><a href="{r}hakkinda.html#iletisim">İletişim</a></li>{'<li><a href="/panel/#/kayit">Üye ol</a></li><li><a href="/panel/">Üye paneli</a></li>' if DYNAMIC else ""}</ul></div>
    </div>
    <div class="footer-bottom"><span>© 2006–{TODAY.year} {E(SITE)} · Tüm hakları saklıdır.</span><span>{E(ST["footer_note"])}</span></div>
  </div>
</footer>
<button class="icon-btn to-top" type="button" aria-label="Yukarı çık">{ic("up")}</button>
<div class="cmdk" role="dialog" aria-modal="true" aria-label="Sitede ara">
  <div class="cmdk-box">
    <div class="cmdk-input">{ic("search")}<input type="search" placeholder="Akademisyen, eser, haber ara…" autocomplete="off" aria-label="Arama"><kbd>Esc</kbd></div>
    <div class="cmdk-list" role="listbox"></div>
    <div class="cmdk-foot"><span>↑↓ gezin</span><span>↵ aç</span><span>Esc kapat</span></div>
  </div>
</div>
{data_tag}
<script src="{r}assets/js/app.js" defer></script>
</body>
</html>'''
    doc = size_imgs(doc).replace("{ROOT}", r)
    WRITTEN.add(path)
    out = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(doc)


def banner_html():
    """Panelden açılan duyuru şeridi (tüm sayfaların en üstünde)."""
    if not ST["banner_enabled"] or not ST["banner_text"]:
        return ""
    text = E(ST["banner_text"])
    if ST["banner_link"]:
        text += ' <a href="%s">Ayrıntılar →</a>' % E(ST["banner_link"])
    return '<div class="site-banner sb-%s" role="note"><div class="container">%s</div></div>' % (E(ST["banner_style"]), text)


def youtube_band():
    """Mezhep.Org YouTube kanalı: ana sayfada kartların hemen altında belirgin şerit."""
    url = ST["youtube_url"]
    if not (url and ST["home_show_youtube"]):
        return ""
    m = re.search(r"youtube\.com/(@[\w.-]+)", url)
    handle = m.group(1) if m else "YouTube"
    sub = url + ("&" if "?" in url else "?") + "sub_confirmation=1"
    return (f'<section class="yt-wrap"><div class="container"><div class="yt-band reveal">'
            f'<span class="yt-logo" aria-hidden="true">{ic("yt")}</span>'
            f'<div class="yt-text"><div class="yt-kicker">YouTube kanalımız</div><h2>{E(handle)}</h2>'
            f'<p>Sempozyum, panel ve koordinasyon toplantılarının kayıtları; ders ve söyleşiler. {E(SITE)}\'un yayın organı.</p></div>'
            f'<div class="yt-actions"><a class="btn yt-btn" href="{E(url)}" target="_blank" rel="noopener">{ic("play")} Kanala git</a>'
            f'<a class="btn btn-ghost" href="{E(sub)}" target="_blank" rel="noopener">Abone ol</a></div></div></div></section>')


def tr_short_date(iso):
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", iso or "")
    return "%d %s %s" % (int(m.group(3)), AY_KISA[int(m.group(2)) - 1], m.group(1)) if m else ""


def vid_card(v):
    """Video kartı: tıklanınca sayfa içinde oynatılır (app.js); JavaScript yoksa YouTube'da açılır."""
    return (f'<a class="vid-card" href="https://www.youtube.com/watch?v={E(v["id"])}" target="_blank" rel="noopener" data-yt="{E(v["id"])}" data-title="{E(v["title"])}">'
            f'<span class="vid-thumb"><img src="https://i.ytimg.com/vi/{E(v["id"])}/hqdefault.jpg" alt="" loading="lazy"><span class="vid-play">{ic("play")}</span></span>'
            f'<span class="vid-title">{E(v["title"])}</span><span class="vid-date">{tr_short_date(v.get("published"))}</span></a>')


def video_module():
    """Video modülü: oynatma listeleri sekme sekme; karta tıklayınca sayfada oynatılır (JS yoksa YouTube'a gider)."""
    lists = [l for l in VIDEOS if l.get("videos")]
    if not (lists and ST["home_show_videos"]):
        return ""
    label = lambda t: {"Konuşmaları": "Konuşmalar"}.get(re.sub(r"^Ahmet İshak DEMİR\s*", "", t, flags=re.I).strip(), re.sub(r"^Ahmet İshak DEMİR\s*", "", t, flags=re.I).strip() or t)
    tabs = "".join('<button class="chip" type="button" role="tab" aria-selected="%s" data-vid-tab="%d">%s <span class="n">%d</span></button>'
                   % ("true" if i == 0 else "false", i, E(label(l["title"])), len(l["videos"])) for i, l in enumerate(lists))
    panels = ""
    for i, l in enumerate(lists):
        cards = "".join(vid_card(v) for v in l["videos"][:8])
        panels += f'<div class="vid-grid" role="tabpanel" data-vid-panel="{i}"{"" if i == 0 else " hidden"}>{cards}</div>'
    more = ('<a class="link-arrow" href="%s" target="_blank" rel="noopener">Tüm videolar %s</a>' % (E(ST["videos_more_url"]), ic("arrow"))) if ST["videos_more_url"] else ""
    sub = ('<a class="btn btn-ghost btn-sm" href="%s" target="_blank" rel="noopener">%s Kanala abone olun</a>'
           % (E(ST["videos_channel_url"] + ("&" if "?" in ST["videos_channel_url"] else "?") + "sub_confirmation=1"), ic("yt"))) if ST["videos_channel_url"] else ""
    return (f'<section class="section{{ALT}}" id="videolar"><div class="container">'
            f'<div class="section-head reveal"><div><div class="eyebrow">{E(ST["videos_eyebrow"])}</div><h2>{E(ST["videos_title"])}</h2>'
            f'<p>Konferans, panel ve televizyon programlarından seçmeler; kısa söyleşiler.</p></div>{more}</div>'
            f'<div class="chips vid-tabs" role="tablist" aria-label="Video listeleri">{tabs}</div>{panels}'
            f'<div class="vid-foot">{sub}</div></div></section>')


# Sosyal medya: markaların özgün logoları (Facebook mavisi, YouTube kırmızısı, X siyah/beyaz).
BRAND = {
    "facebook": ("Facebook", '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#0866FF" d="M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z"/></svg>'),
    "youtube": ("YouTube", '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814Z"/><path fill="#fff" d="M9.545 15.568V8.432L15.818 12z"/></svg>'),
    "x": ("X", '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932ZM17.61 20.644h2.039L6.486 3.24H4.298Z"/></svg>'),
}


def social_list():
    return [(k, BRAND[k][0], ST[k + "_url"]) for k in ("facebook", "youtube", "x") if ST.get(k + "_url")]


def social_links(cls="social-btn"):
    """Alt bilgi ve yan şerit için özgün logolu sosyal medya bağlantıları (Ayarlar → Genel'den yönetilir)."""
    return "".join(f'<a class="{cls} is-{k}" href="{E(url)}" target="_blank" rel="noopener" aria-label="{E(SITE)} {label}" title="{label}">{BRAND[k][1]}</a>'
                   for k, label, url in social_list())


def social_rail():
    """Geniş ekranlarda sayfanın sol kenarında sabit sosyal medya şeridi."""
    links = social_links("rail-btn")
    return f'<nav class="social-rail" aria-label="Sosyal medya hesaplarımız">{links}</nav>' if links else ""


def emph(t):
    """'*vurgu*' → <em>vurgu</em> (önce kaçışlanır)."""
    return re.sub(r"\*(.+?)\*", r"<em>\1</em>", E(t))


def dyn_button(href, label, icon="star", primary=False):
    """Yalnızca sunucu (üyelik) modunda görünen panel bağlantısı."""
    if not DYNAMIC:
        return ""
    return '<a class="btn %s btn-sm" href="/panel/#/%s" data-needs-login>%s %s</a>' % ("btn-primary" if primary else "btn-ghost", href, ic(icon), E(label))


def own_button(kind, oid):
    """Düzenle düğmesi (başlığın altında): varsayılan gizli; tarayıcı, kayıt sahibine (akademisyen) ya da
    o içerik türünü düzenleme yetkisi olan yöneticiye gösterir. Sunucu kaydederken yetkiyi ayrıca denetler."""
    if not DYNAMIC:
        return ""
    return ('<a class="btn btn-primary btn-sm" href="/panel/#/duzenle/%s/%d" data-own="%s:%d" hidden>%s Düzenle</a>'
            % (kind, oid, kind, oid, ic("edit")))


def claim_button(mid):
    """'Bu profil benim': profili zaten bir hesaba bağlı olan kişiye gizlenir (tarayıcı karar verir)."""
    if not DYNAMIC:
        return ""
    return ('<a class="btn btn-primary btn-sm" href="/panel/#/sahiplen/%d" data-claim="%d">%s Bu profil benim</a>'
            % (mid, mid, ic("users")))


def comments_block(target):
    if not DYNAMIC:
        return ""
    return ('<section class="panel comments" id="yorumlar" data-comments="%s"><h3>Yorumlar</h3>'
            '<div data-comment-list><p class="muted">Yorumlar yükleniyor…</p></div><div data-comment-form></div></section>' % target)


def page_hero(title, lead="", crumbs=(), eyebrow="", actions=""):
    cr = ""
    if crumbs:
        cr = '<nav class="crumbs" aria-label="Konum">' + ic("chev").join(
            '<a href="{ROOT}%s">%s</a>' % (h, E(t)) if h else "<span>%s</span>" % E(t) for h, t in crumbs) + "</nav>"
    return f'''<section class="page-hero">{PATTERN}<div class="container">{cr}{('<div class="eyebrow">%s</div>' % E(eyebrow)) if eyebrow else ""}<h1>{E(title)}</h1>{('<p>%s</p>' % lead) if lead else ""}{('<div class="hero-actions" style="margin-top:20px">%s</div>' % actions) if actions else ""}</div></section>'''


# ---------------------------------------------------------------- veri hazırlığı
GROUP_LABEL = {"Öğretim Elemanları": "Öğretim Elemanı", "Üniversite Dışı Elemanlar": "Üniversite Dışı",
               "Emekliler": "Emekli", "Rahmetle Andıklarımız": "Rahmetle Andıklarımız"}
RANK_ORDER = ["Prof. Dr.", "Doç. Dr.", "Dr. Öğr. Üyesi", "Dr.", "Arş. Gör."]


def member_filter(m):
    if m["group"] == "Öğretim Elemanları": return m["rank"] or "Diğer"
    return GROUP_LABEL.get(m["group"], m["group"] or "Diğer")


for m in members:
    m["slug"] = "akademisyen/%d.html" % m["id"]
    m["filter"] = member_filter(m)
    m["display"] = ("%s %s" % (m["title"], m["name"])).strip() if m["title"] not in ("Klasik Dönem", "Yakın Dönem", "Emekliler") else m["name"]
    m["key"] = fold(m["name"])
    m["photo"] = m.get("photo") if m.get("photo") and exists(m["photo"]) else ""
    m["bio"] = drop_missing(m["bio"])


def work_type(w):
    if w["category"] == "Tezler": return w["type"] or "Tez"
    return {"Kitaplar": "Kitap", "Makaleler": "Makale", "Tebliğler": "Tebliğ"}.get(w["category"], w["category"] or "Diğer")


TYPE_BADGE = {"Doktora": "b-brand", "Yüksek Lisans": "b-indigo", "Doçentlik": "b-gold", "Kitap": "b-gold", "Makale": "b-rose", "Tebliğ": ""}
for w in works:
    w["kind"] = work_type(w)
    w["slug"] = "eser/%d.html" % w["id"]
    w["key"] = fold(w["author"])

by_member_works = defaultdict(list)
mkeys = {m["key"]: m for m in members if m["key"]}
for w in works:
    if w["key"] in mkeys: by_member_works[mkeys[w["key"]]["id"]].append((w, "Yazar"))
    ck = fold(re.sub(r"^.*?(Dr\.|Gör\.)\s*", "", w["contributor"]))
    if ck in mkeys: by_member_works[mkeys[ck]["id"]].append((w, "Danışman" if "Dan" in w["contribType"] else (w["contribType"] or "Katkı")))


# ---------------------------------------------------------------- kategoriler ve menü
# Haberin "forum" alanı kategori anahtarıdır. Kategoriler, menü ve sayfalardaki kategori bölümleri panelden yönetilir
# (sunucu categories.json'u dışa aktarır; statik sürümde data/categories.json). Bir haberin kategorisini seçmek onu
# kategori sayfasına, bölümü eklenmiş sayfalara ve menüye kendiliğinden taşır; içerikleri elle seçmek gerekmez.
CAT_DEF = dict(name="", label="", slug="", parent="", description="", menu_show=False, menu_order=100, home_show=False, count=6,
               sort="new", style="kart", pages=[], block_eyebrow="", block_title="", seo_title="", seo_desc="", page="", old_slugs=[])
_CJ = load("categories") if os.path.exists(os.path.join(DATA, "categories.json")) else {}
CATS = {c["key"]: dict(CAT_DEF, **c) for c in _CJ.get("categories", [])}


def slugify(s):
    return re.sub(r"[^a-z0-9]+", "-", fold(s)).strip("-")[:60].strip("-")


# Tanımsız kategorideki haberler kaybolmasın: gizli bir kategori olarak sayfası üretilir (sunucu da aynısını yapar).
for _t in topics:
    if _t["forum"] not in CATS:
        _s, _i = slugify(_t["forum"]) or "kategori", 2
        while any(c["slug"] == _s for c in CATS.values()):
            _s, _i = "%s-%d" % (slugify(_t["forum"]) or "kategori", _i), _i + 1
        CATS[_t["forum"]] = dict(CAT_DEF, key=_t["forum"], name=_t["forum"], slug=_s, menu_order=200)
for _c in CATS.values():
    if _c["parent"] not in CATS or _c["parent"] == _c["key"] or CATS[_c["parent"]]["parent"]:
        _c["parent"] = ""  # menü iki düzeylidir
_corder = lambda c: (c["menu_order"], fold(c["name"]))
CAT_LIST = []  # ağaç sırası: üst kategori, ardından alt kategorileri
for _c in sorted((c for c in CATS.values() if not c["parent"]), key=_corder):
    CAT_LIST += [_c] + sorted((c for c in CATS.values() if c["parent"] == _c["key"]), key=_corder)


def children(key):
    return [c for c in CAT_LIST if c["parent"] == key]


def cat_url(c):
    """Kategori sayfası: haberler.html ve etkinlikler.html sitenin ana bölümleri; diğerleri kategori/<slug>.html."""
    return c["page"] or "kategori/%s.html" % c["slug"]


def cat_label(c):
    return c["label"] or c["name"]


def cat_root(c):
    return CATS[c["parent"]] if c["parent"] else c


def in_menu(c):
    return c["menu_show"] and (not c["parent"] or CATS[c["parent"]]["menu_show"])


def nav_active(c):
    """Menüde işaretlenecek adres: kategori ya da üst kategorisi menüdeyse o; değilse bölümünün gösterildiği sayfa."""
    for x in (c, cat_root(c)):
        if in_menu(x): return cat_url(x)
    for x in (c, cat_root(c)):
        if x["pages"]: return x["pages"][0] + ".html"
    return ""


def tr_lower(s):
    return (s or "").replace("I", "ı").replace("İ", "i").lower()


def _menu():
    entries = [dict(name=p["name"], href=p["href"], order=p.get("menu_order", 0), children=[])
               for p in (_CJ.get("pages") or FIXED_PAGES) if p.get("menu_show", True)]
    for c in CAT_LIST:
        if not c["parent"] and c["menu_show"]:
            entries.append(dict(name=c["name"], href=cat_url(c), order=c["menu_order"],
                                children=[dict(name=x["name"], href=cat_url(x)) for x in children(c["key"]) if x["menu_show"]]))
    return sorted(entries, key=lambda e: e["order"])


MENU = _menu()


def topic_tag(t):
    if t["forum"] != "haber" and t["forum"] in CATS: return cat_label(CATS[t["forum"]])
    m = re.match(r"^\s*([^:]{3,28}):", t["title"])
    if m:
        tag = m.group(1).strip()
        tag = {"Yeni Dr. Öğr. Üyesi": "Atama", "Yer Değişimi": "Atama", "Yeni Profesör": "Profesörlük", "Yeni Doçent": "Doçentlik",
               "Yeni Doktor": "Yeni Doktor", "Vefat": "Vefat"}.get(tag, tag)
        if tag in ("Atama", "Profesörlük", "Doçentlik", "Yeni Doktor", "Vefat"): return tag
    tl = fold(t["title"])
    if "sempozyum" in tl or "kongre" in tl or "panel" in tl or "calistay" in tl or "toplanti" in tl: return "Etkinlik"
    if "vefat" in tl: return "Vefat"
    if "docent" in tl: return "Doçentlik"
    if "profesor" in tl: return "Profesörlük"
    if "doktor" in tl or "tez" in tl: return "Yeni Doktor"
    if "dergi" in tl or "makalat" in tl or "kitap" in tl: return "Yayın"
    return "Duyuru"


TAG_BADGE = {"Yeni Doktor": "b-brand", "Doçentlik": "b-gold", "Profesörlük": "b-gold", "Atama": "b-indigo", "Vefat": "b-rose", "Etkinlik": "b-brand", "Yayın": "b-indigo", "Kitap": "b-gold",
             "Sempozyum": "b-indigo", "Koordinasyon": "b-gold", "Yeni Kitap": "b-gold"}
for t in topics:
    t["tag"] = topic_tag(t)
    t["slug"] = "haber/%d.html" % t["id"]
    for p in t["posts"]:
        p["html"] = drop_missing(p["html"])
    img = (t.get("image") or "").replace("{ROOT}", "")
    t["image"] = img if img.startswith(("media/", "uploads/")) and exists(img) else ""
    t["sort"] = parse_date(t.get("date", ""))
    t["order"] = t["order"] if isinstance(t.get("order"), int) and not isinstance(t.get("order"), bool) else None
BY_CAT = defaultdict(list)
for t in topics:
    BY_CAT[t["forum"]].append(t)


def sort_topics(items, how="new"):
    newest = sorted(items, key=lambda t: (t["sort"], t["id"]), reverse=True)
    if how == "old": return newest[::-1]
    if how == "title": return sorted(items, key=lambda t: fold(t["title"]))
    if how == "manual": return sorted(newest, key=lambda t: (t["order"] is None, t["order"] or 0))  # sıra verilenler önce
    return newest


def cat_items(key, how=None):
    """Kategorinin (alt kategorileri dahil) bütün yayımlanmış içerikleri, kategorinin sıralama ayarıyla."""
    keys = [key] + [c["key"] for c in children(key)]
    return sort_topics([t for k in keys for t in BY_CAT[k]], how or CATS[key]["sort"])


news = cat_items("haber", "new") if "haber" in CATS else []
events = cat_items("etkinlikler", "new") if "etkinlikler" in CATS else []

COORD = [(1, "Ankara", 2007), (2, "Elazığ", 2010), (3, "Isparta", 2012), (4, "Çorum", 2013), (5, "Sivas", 2014),
         (6, "Konya", 2015), (7, "Antalya", 2019), (8, "Rize", 2023), (9, "İstanbul", 2025)]
if os.path.isdir(FILE_ROOTS["media/"]):
    # sunucuda bulunmayan (indirilemeyen) fotoğrafları ayıkla, tam boyu yoksa küçük resmi kullan
    for a in albums:
        a["photos"] = [dict(p, src=p["src"] if exists(p["src"]) else p["thumb"]) for p in a["photos"] if exists(p["thumb"])]
    albums[:] = [a for a in albums if a["photos"]]
album_groups = defaultdict(list)
for a in albums:
    a["slug"] = "galeri/%d-%d.html" % (a["cid"], a["sid"])
    album_groups[a["event"]].append(a)
n_photos = sum(len(a["photos"]) for a in albums)
STATS = dict(members=len(members), works=len(works), theses=sum(1 for w in works if w["category"] == "Tezler"),
             news=len(news), events=len(events), photos=n_photos,
             universities=len({m["university"] for m in members if m["university"]}))


def news_card(t, cls=""):
    img = '<img src="{ROOT}%s" alt="" loading="lazy">' % E(t["image"].replace("{ROOT}", "")) if t.get("image") else ic("news")
    return f'''<a class="card news-card {cls}" href="{{ROOT}}{t["slug"]}"><div class="thumb">{img}</div><div class="meta"><span class="badge {TAG_BADGE.get(t["tag"], "")}">{E(t["tag"])}</span><span>{tr_date(t.get("date"))}</span></div><h3 class="clamp-2">{E(t["title"])}</h3><p class="clamp-3">{E(t.get("summary", ""))}</p></a>'''


def feed_topic(t):
    y, m, d = t["sort"]
    chip = f'<div class="date-chip"><b>{d}</b><span>{AY_KISA[m-1] if m else ""} {str(y)[2:] if y else ""}</span></div>'
    return f'''<a class="feed-item" href="{{ROOT}}{t["slug"]}">{chip}<div class="body"><span class="badge {TAG_BADGE.get(t["tag"], "")}">{E(t["tag"])}</span><h3>{E(t["title"])}</h3><p class="clamp-2">{E(t.get("summary", ""))}</p></div><span class="chev">{ic("chev")}</span></a>'''


def work_item(w):
    bits = [E(w["author"])]
    if w["year"]: bits.append(str(w["year"]))
    if w["institution"]: bits.append(E(w["institution"]))
    elif w["place"]: bits.append(E(w["place"]))
    return f'''<a class="feed-item" href="{{ROOT}}{w["slug"]}"><div class="body"><span class="badge {TYPE_BADGE.get(w["kind"], "")}">{E(w["kind"])}</span><h3>{E(w["title"])}</h3><p>{' · '.join(bits)}</p></div><span class="chev">{ic("chev")}</span></a>'''


# ---------------------------------------------------------------- KATEGORİ BÖLÜMLERİ
def cat_block(c):
    """Bir sayfadaki kategori bölümü: kategorinin ilk N içeriği (sıralama kategori ayarından) ve kategori sayfasına bağlantı.
    Bölümde gösterilmeyen içerikler kategori sayfasında listelenmeye devam eder; bölüm ile arşiv birbirinden bağımsızdır."""
    items = cat_items(c["key"])
    if not items:
        return ""
    shown = items[:c["count"]] if c["count"] else items
    eyebrow = c["block_eyebrow"] or (CATS[c["parent"]]["name"] if c["parent"] else "")
    eyebrow = '<div class="eyebrow">%s</div>' % E(eyebrow) if eyebrow else ""
    lead = "<p>%s</p>" % E(c["description"]) if c["description"] else ""
    more = "Tümünü gör" + (" (%d)" % len(items) if len(shown) < len(items) else "")
    if c["style"] == "liste":
        inner = '<div class="feed reveal">%s</div>' % "".join(feed_topic(t) for t in shown)
    else:
        inner = '<div class="grid grid-3">%s</div>' % "".join(news_card(t, "reveal") for t in shown)
    return (f'<section class="section{{ALT}}" data-category="{E(c["key"])}"><div class="container">'
            f'<div class="section-head reveal"><div>{eyebrow}<h2>{E(c["block_title"] or c["name"])}</h2>{lead}</div>'
            f'<a class="link-arrow" href="{{ROOT}}{cat_url(c)}">{more} {ic("arrow")}</a></div>{inner}</div></section>')


def page_blocks(page):
    """Sayfaya eklenmiş kategori bölümleri (panel: Kategoriler → "Ana sayfada göster" / "Diğer sayfalarda göster"), menü sırasıyla."""
    return [h for h in (cat_block(c) for c in CAT_LIST if (c["home_show"] if page == "index" else page in c["pages"])) if h]


def with_blocks(body, page):
    return body + "".join(h.replace("{ALT}", " alt" if n % 2 == 0 else "") for n, h in enumerate(page_blocks(page)))


# ---------------------------------------------------------------- ANA SAYFA
def build_home():
    pop = sorted(works, key=lambda w: -w["hits"])[:6]
    recent_members = sorted(members, key=lambda m: (parse_date(m["added"]), m["id"]), reverse=True)[:8]
    s = STATS
    people = "".join(f'''<a class="card person reveal" href="{{ROOT}}{m["slug"]}">{avatar(m)}<div class="info"><div class="rank">{E(m["title"])}</div><h3>{E(m["name"])}</h3><div class="uni">{E(m["university"])}</div></div></a>''' for m in recent_members)
    # Kategori bölümleri (Son haberler, Koordinasyon toplantıları…) panelden; ardından eserler ve akademisyenler
    optional = [(True, h) for h in page_blocks("index")] + [
        (ST['home_show_works'], f'''<section class="section{{ALT}}">
  <div class="container">
    <div class="section-head reveal"><div><div class="eyebrow">En çok okunanlar</div><h2>Öne çıkan eserler</h2></div><a class="link-arrow" href="{{ROOT}}eserler.html">Tüm eserler {ic("arrow")}</a></div>
    <div class="feed reveal">{"".join(work_item(w) for w in pop)}</div>
  </div>
</section>'''),
        (ST['home_show_members'], f'''<section class="section{{ALT}}">
  <div class="container">
    <div class="section-head reveal"><div><div class="eyebrow">Aramıza katılanlar</div><h2>Yeni eklenen akademisyenler</h2></div><a class="link-arrow" href="{{ROOT}}akademisyenler.html">Tüm akademisyenler {ic("arrow")}</a></div>
    <div class="grid grid-4">{people}</div>
  </div>
</section>''')
    ]
    optional.insert(min(1, len(optional)), (True, video_module()))
    shown = [h for on, h in optional if on and h]
    optional_sections = "\n\n".join(h.replace("{ALT}", " alt" if n % 2 == 0 else "") for n, h in enumerate(shown))
    body = f'''
<section class="hero">
  {PATTERN}<div class="hero-glow"></div>
  <div class="container hero-grid">
    <div>
      <div class="eyebrow">{E(ST["home_eyebrow"])}</div>
      <h1>{emph(ST["home_title"])}</h1>
      <p class="hero-lead">{E(ST["home_lead"])}</p>
      <div class="hero-actions">
        <a class="btn btn-primary" href="{{ROOT}}eserler.html">{ic("book")} Eserleri keşfet</a>
        <button class="btn btn-ghost" type="button" data-open-search>{ic("search")} Sitede ara</button>
      </div>
    </div>
    <div class="hero-card">
      <img class="hero-logo" src="{{ROOT}}assets/img/logo.jpg" alt="Mezhep.Org logosu" width="100" height="68">
      <div class="arabic" lang="ar">المذاهب الإسلامية</div>
      {('<p class="quote">“%s”</p>' % E(ST["home_quote"])) if ST["home_quote"] else ""}
      {('<div class="sig">Saygılarımızla, <strong>%s</strong></div>' % E(ST["home_quote_sign"])) if ST["home_quote_sign"] else ""}
      <div class="hero-stats">
        <div class="stat"><b data-count="{s["members"]}">{s["members"]}</b><span>Akademisyen</span></div>
        <div class="stat"><b data-count="{s["works"]}">{s["works"]}</b><span>Akademik eser</span></div>
        <div class="stat"><b data-count="{s["theses"]}">{s["theses"]}</b><span>Tez</span></div>
        <div class="stat"><b data-count="{s["universities"]}">{s["universities"]}</b><span>Üniversite</span></div>
      </div>
    </div>
  </div>
</section>

<section class="section" style="padding-top:0">
  <div class="container">
    <div class="bento">
      <a class="tile feature wide tall reveal" href="{{ROOT}}eserler.html">{BIG_STAR}<span class="ic">{ic("book")}</span><h3 style="font-size:1.8rem">Eser Veritabanı</h3><p>Yüksek lisans ve doktora tezleri, telif ve tercüme kitaplar, makaleler ve tebliğler — Türkçe özet ve İngilizce abstract'larıyla.</p><div class="num">{s["works"]}</div></a>
      <a class="tile reveal" href="{{ROOT}}akademisyenler.html"><span class="ic">{ic("users")}</span><h3>Akademisyenler</h3><p>{s["members"]} öğretim elemanı, {s["universities"]} üniversite</p></a>
      <a class="tile gold reveal" href="{{ROOT}}haberler.html"><span class="ic">{ic("news")}</span><h3>Haberler</h3><p>Yeni doktorlar, atamalar, unvanlar</p></a>
      <a class="tile indigo reveal" href="{{ROOT}}etkinlikler.html"><span class="ic">{ic("calendar")}</span><h3>Etkinlikler</h3><p>{s["events"]} sempozyum ve toplantı</p></a>
      <a class="tile rose reveal" href="{{ROOT}}galeri.html"><span class="ic">{ic("image")}</span><h3>Galeri</h3><p>{s["photos"]} fotoğraf, {len(albums)} albüm</p></a>
    </div>
  </div>
</section>

{youtube_band()}

{optional_sections}

<section class="section" style="padding-top:0">
  <div class="container">
    <div class="cta reveal">{BIG_STAR}
      <div><h2>Katkılarınızı bekliyoruz</h2><p>Sitemizin temel amacı Mezhepler Tarihi çalışmalarını eksiksiz ve özetleriyle birlikte derlemek. Öncelikle kendi çalışmalarınız olmak üzere tashih ve eklemelerinizi bize iletin.</p></div>
      <div class="actions"><a class="btn btn-primary" href="{{ROOT}}hakkinda.html#iletisim">{ic("mail")} Bize ulaşın</a>{('<a class="btn btn-ghost" href="%s" target="_blank" rel="noopener">%s YouTube</a>' % (E(ST["youtube_url"]), ic("yt"))) if ST["youtube_url"] else ""}{('<a class="btn btn-ghost" href="%s" target="_blank" rel="noopener">%s Facebook</a>' % (E(ST["facebook_url"]), ic("fb"))) if ST["facebook_url"] else ""}</div>
    </div>
  </div>
</section>'''
    layout("index.html", SITE, body, active="index.html")


def member_card(m):
    works_n = len(by_member_works[m["id"]])
    return (f'<a class="card person" href="{{ROOT}}{m["slug"]}">{avatar(m)}<div class="info"><div class="rank">{E(m["title"])}</div>'
            f'<h3>{E(m["name"])}</h3><div class="uni">{E(m["university"] or "—")}{(" · %d eser" % works_n) if works_n else ""}</div></div></a>')


# ---------------------------------------------------------------- AKADEMİSYENLER
def build_members():
    order = RANK_ORDER + ["Üniversite Dışı", "Emekli", "Rahmetle Andıklarımız", "Diğer"]
    cnt = Counter(m["filter"] for m in members)
    chips = '<button class="chip" data-filter="tur" data-value="" aria-pressed="true">Tümü <span class="n">%d</span></button>' % len(members)
    chips += "".join('<button class="chip" data-filter="tur" data-value="%s" aria-pressed="false">%s <span class="n">%d</span></button>' % (E(k), E(k), cnt[k]) for k in order if cnt[k])
    unis = sorted({m["university"] for m in members if m["university"]}, key=fold)
    opts = '<option value="">Tüm üniversiteler</option>' + "".join('<option>%s</option>' % E(u) for u in unis)
    data = [dict(id=m["id"], n=m["name"], t=m["title"], u=m["university"], c=m["city"], f=m["filter"], s=m["slug"], w=len(by_member_works[m["id"]]), p=m.get("photo", "")) for m in members]
    body = page_hero("Akademisyenler", "İslam Mezhepleri Tarihi alanındaki öğretim elemanları, araştırmacılar ve rahmetle andığımız hocalarımız. Tashih ve eklemelerinizi bekliyoruz.", [("index.html", "Ana Sayfa"), ("", "Akademisyenler")], "%d kişi · %d üniversite" % (len(members), len(unis)),
                     dyn_button("oneri/member", "Eksik akademisyeni ekleyin", "users"))
    body += f'''
<div class="toolbar"><div class="container">
  <div class="row"><label class="input">{ic("search")}<input type="search" data-q placeholder="İsim, üniversite veya şehir ara…" aria-label="Akademisyen ara"></label>
  <select class="select" data-filter-select="uni" aria-label="Üniversite">{opts}</select></div>
  <div class="chips">{chips}</div>
</div></div>
<div class="container" style="padding-bottom:80px"><p class="result-info" data-info>{len(members)} kayıt</p><div class="grid grid-4" data-list="members">{"".join(member_card(m) for m in members[:48])}</div><div class="load-more"><button class="btn btn-ghost" data-more hidden>Daha fazla göster</button></div></div>'''
    layout("akademisyenler.html", "Akademisyenler", with_blocks(body, "akademisyenler"), "İslam Mezhepleri Tarihi akademisyenleri listesi", "akademisyenler.html", data)

    for m in members:
        ws = by_member_works[m["id"]]
        rel = [t for t in news if m["key"] and m["key"] in fold(t["title"] + " " + t.get("summary", ""))][:6]
        wl = "".join('<div class="feed-item" style="padding:0;border:0;margin-bottom:6px"></div>' for _ in [])
        works_html = ""
        if ws:
            works_html = '<div class="panel"><h2>Eserleri ve danışmanlıkları</h2><div class="feed" style="margin-top:16px">' + "".join(
                work_item(w).replace('<span class="badge', '<span class="badge b-gold" style="margin-right:6px">%s</span><span class="badge' % E(role), 1) for w, role in ws) + "</div></div>"
        news_html = ""
        if rel:
            news_html = '<div class="panel"><h2>İlgili haberler</h2><div class="feed" style="margin-top:16px">' + "".join(feed_topic(t) for t in rel) + "</div></div>"
        bio = m["bio"] or ""
        info = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in [
            ("Unvan", E(m["title"])), ("Grup", E(GROUP_LABEL.get(m["group"], m["group"]))), ("Üniversite", E(m["university"])),
            ("Şehir", E(m["city"])), ("Web", '<a href="%s" target="_blank" rel="noopener">Kişisel sayfa</a>' % E(m["web"]) if m["web"] else ""),
            ("E-posta", '<a href="mailto:%s">%s</a>' % (E(m["email"]), E(m["email"])) if m["email"] else ""),
            ("Eklenme", tr_date(m["added"]))] if v)
        m_desc = "%s — %s" % (m["display"], m["university"])
        body = page_hero(m["name"], "", [("index.html", "Ana Sayfa"), ("akademisyenler.html", "Akademisyenler"), ("", m["name"])], m["title"], own_button("member", m["id"]))
        body += f'''<div class="container detail">
  <div>
    <div class="panel" style="display:flex;gap:22px;align-items:center;flex-wrap:wrap">{avatar(m, "lg")}<div><div class="badge b-brand">{E(m["filter"])}</div><h2 style="margin:10px 0 4px">{E(m["display"])}</h2><div style="color:var(--muted)">{ic("pin").replace('class=""', 'style="width:16px;height:16px;vertical-align:-3px"')} {E(m["university"])}{(" · " + E(m["city"])) if m["city"] else ""}</div></div></div>
    {('<div class="panel"><h2>Özgeçmiş</h2><div class="prose">%s</div></div>' % bio) if bio else ""}
    {works_html}
    {news_html}
    {"" if (bio or ws or rel) else '<div class="panel empty">Bu akademisyen için henüz özgeçmiş veya eser bilgisi eklenmemiş. Katkıda bulunmak için <a href="{ROOT}hakkinda.html#iletisim">bize ulaşın</a>.</div>'}
    {share_block(m["slug"], m["name"], m_desc, abs_url(m.get("photo")), "member:%d" % m["id"])}
  </div>
  <aside><div class="panel"><h3>Bilgiler</h3><dl class="dl">{info}</dl></div>{claim_button(m["id"])}<a class="btn btn-ghost" href="{{ROOT}}akademisyenler.html">{ic("left")} Tüm akademisyenler</a></aside>
</div>'''
        layout(m["slug"], m["name"], body, m_desc, "akademisyenler.html",
               share={"og": "akademisyen", "image": abs_url(m.get("photo")), "alt": m["display"]})


# ---------------------------------------------------------------- ESERLER
TITLE_WORDS = r"(Prof\.|Doç\.|Dr\.|Yrd\.|Arş\.|Gör\.|Öğr\.|Üyesi|Grv\.)\s*"


def apa_author(name):
    """'Yrd. Doç. Dr. Nisa Gecekuşu Demirbaş' → 'Demirbaş, N. G.' (APA 7). Birden çok yazar ';' ya da ' ve ' ile ayrılır."""
    out = []
    for one in re.split(r"\s*;\s*|\s+ve\s+", name or ""):
        one = re.sub(TITLE_WORDS, "", one).strip(" ,.")
        parts = one.split()
        if len(parts) < 2:
            if one: out.append(one)
            continue
        last, given = parts[-1], parts[:-1]
        initials = " ".join(p[0].upper() + "." for p in given if p[0].isalpha())
        out.append(f"{last[0].upper() + last[1:]}, {initials}")
    if len(out) > 1:
        return ", ".join(out[:-1]) + " ve " + out[-1]
    return out[0] if out else ""


def cite(w):
    """APA 7 biçiminde kaynak gösterimi (tez, kitap, makale, tebliğ)."""
    who = apa_author(w["author"])
    year = "(%d)." % w["year"] if w["year"] else "(t.y.)."
    tidy = lambda s: re.sub(r"\s+", " ", (s or "").strip().rstrip(" ,;:"))
    dot = lambda s: s if s.endswith(".") else s + "."      # kısaltma noktası ("Bonn Ü.") korunur
    title, inst, place, pages = tidy(w["title"]), tidy(w["institution"]), tidy(w["place"]), tidy(w["pages"]).rstrip(".")
    if w["category"] == "Tezler":
        kind = {"Yüksek Lisans": "Yüksek lisans tezi", "Doktora": "Doktora tezi", "Doçentlik": "Doçentlik tezi"}.get(w["kind"], "Tez")
        tail = f"{title} [{kind}" + (f", {inst}" if inst else "") + "]."
    elif w["category"] == "Kitaplar":
        tail = dot(title) + (" " + dot(inst) if inst else (" " + dot(place) if place else ""))
    elif w["category"] == "Makaleler":
        tail = dot(title) + (" " + dot(inst + (f", {pages}" if pages else "")) if inst else "")
    else:
        tail = f"{title} [Bildiri]." + (" " + dot(inst) if inst else "")
    return f"{who} {year} {tail}".strip()


def build_works():
    order = ["Doktora", "Yüksek Lisans", "Doçentlik", "Kitap", "Makale", "Tebliğ"]
    cnt = Counter(w["kind"] for w in works)
    chips = '<button class="chip" data-filter="tur" data-value="" aria-pressed="true">Tümü <span class="n">%d</span></button>' % len(works)
    chips += "".join('<button class="chip" data-filter="tur" data-value="%s" aria-pressed="false">%s <span class="n">%d</span></button>' % (E(k), E(k), cnt[k]) for k in order if cnt[k])
    decades = sorted({(w["year"] // 10) * 10 for w in works if w["year"]}, reverse=True)
    dopts = '<option value="">Tüm yıllar</option>' + "".join('<option value="%d">%d’ler</option>' % (d, d) for d in decades)
    sopts = '<option value="new">En yeni</option><option value="old">En eski</option><option value="az">Başlık (A–Z)</option><option value="pop">En çok okunan</option>'
    data = [dict(id=w["id"], t=w["title"], a=w["author"], k=w["kind"], y=w["year"], i=w["institution"], p=w["place"], h=w["hits"], s=w["slug"],
                 d=w["contributor"], x=1 if (w["ozet"] or w["abstract"]) else 0) for w in works]
    body = page_hero("Eserler", "İslam Mezhepleri ile ilgili akademik çalışmalar: tezler, kitaplar, makaleler ve tebliğler. Amacımız Mezhepler Tarihi çalışmalarını eksiksiz ve özetleriyle birlikte derlemek.", [("index.html", "Ana Sayfa"), ("", "Eserler")], "%d eser · %d tez" % (len(works), STATS["theses"]),
                     dyn_button("oneri/work", "Eser ekleyin", "book", True))
    body += f'''
<div class="toolbar"><div class="container">
  <div class="row"><label class="input">{ic("search")}<input type="search" data-q placeholder="Başlık, yazar, danışman veya kurum ara…" aria-label="Eser ara"></label>
  <select class="select" data-filter-select="decade" aria-label="Dönem">{dopts}</select><select class="select" data-sort aria-label="Sıralama">{sopts}</select></div>
  <div class="chips">{chips}</div>
</div></div>
<div class="container" style="padding-bottom:80px"><p class="result-info" data-info>{len(works)} kayıt</p><div class="feed" data-list="works">{"".join(work_item(w) for w in sorted(works, key=lambda w: (w["year"] or 0, w["id"]), reverse=True)[:40])}</div><div class="load-more"><button class="btn btn-ghost" data-more hidden>Daha fazla göster</button></div></div>'''
    layout("eserler.html", "Eserler", with_blocks(body, "eserler"), "İslam Mezhepleri Tarihi tezleri, kitapları, makaleleri ve tebliğleri", "eserler.html", data)

    mbyname = {m["key"]: m for m in members}
    for w in works:
        am = mbyname.get(w["key"])
        ck = fold(re.sub(r"^.*?(Dr\.|Gör\.)\s*", "", w["contributor"]))
        cm = mbyname.get(ck)
        author = '<a href="{ROOT}%s">%s</a>' % (am["slug"], E(w["author"])) if am else E(w["author"])
        contrib = ('<a href="{ROOT}%s">%s</a>' % (cm["slug"], E(w["contributor"])) if cm else E(w["contributor"])) if w["contributor"] else ""
        info = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in [
            ("Tür", E(w["kind"])), ("Yazar", author), (("Danışman" if "Dan" in w["contribType"] else "Emeği geçen"), contrib),
            ("Kurum", E(w["institution"])), ("Basım yeri", E(w["place"])), ("Yıl", w["year"] or ""), ("Sayfa", E(w["pages"])),
            ("Okunma", "{:,}".format(w["hits"]).replace(",", ".") if w["hits"] else ""), ("Eklenme", tr_date(w["added"]))] if v)
        tabs = ""
        if w["ozet"] and w["abstract"]:
            tabs = f'''<div class="abstract-tabs" role="tablist"><button role="tab" aria-selected="true" data-tab="oz">Özet</button><button role="tab" aria-selected="false" data-tab="ab">Abstract</button></div>
<div class="prose" data-pane="oz">{w["ozet"]}</div><div class="prose" data-pane="ab" lang="en" hidden>{w["abstract"]}</div>'''
        elif w["ozet"] or w["abstract"]:
            tabs = '<h2>%s</h2><div class="prose"%s>%s</div>' % ("Özet" if w["ozet"] else "Abstract", "" if w["ozet"] else ' lang="en"', w["ozet"] or w["abstract"])
        else:
            tabs = '<div class="empty">Bu eser için henüz özet eklenmemiş.</div>'
        similar = [x for x in works if x["kind"] == w["kind"] and x["id"] != w["id"]]
        random.Random(w["id"]).shuffle(similar)
        btn = '<a class="btn btn-primary" href="%s" target="_blank" rel="noopener">%s Tam metne git</a>' % (E(w["url"]), ic("ext")) if w["url"] else ""
        w_desc = strip_tags(w["ozet"] or w["abstract"])[:200] or "%s — %s%s" % (w["kind"], w["author"], (", %d" % w["year"]) if w["year"] else "")
        body = page_hero(w["title"], E(w["author"]) + ((" · %d" % w["year"]) if w["year"] else ""), [("index.html", "Ana Sayfa"), ("eserler.html", "Eserler"), ("eserler.html#tur=" + w["kind"], w["kind"])], w["kind"], own_button("work", w["id"]))
        body += f'''<div class="container detail">
  <div>
    <div class="panel">{tabs}</div>
    <div class="panel"><h3>Kaynak gösterimi <span class="badge" style="vertical-align:3px">APA 7</span></h3><p style="margin:0 0 14px;color:var(--ink-2)" data-cite>{E(cite(w))}</p><button class="btn btn-ghost btn-sm" type="button" data-copy>{ic("copy")} Kopyala</button></div>
    {share_block(w["slug"], w["title"], w_desc, "", "work:%d" % w["id"])}
    {comments_block("work:%d" % w["id"])}
    <div class="panel"><h3>Benzer eserler</h3><div class="feed" style="margin-top:14px">{"".join(work_item(x) for x in similar[:4])}</div></div>
  </div>
  <aside><div class="panel"><h3>Künye</h3><dl class="dl">{info}</dl></div>{btn}<a class="btn btn-ghost" href="{{ROOT}}eserler.html">{ic("left")} Tüm eserler</a></aside>
</div>'''
        layout(w["slug"], w["title"], body, w_desc[:160], "eserler.html", share={"og": "eser", "article": True, "alt": w["title"]})


# ---------------------------------------------------------------- HABERLER & KONULAR
def build_news():
    H = CATS.get("haber") or dict(CAT_DEF, name="Haberler")
    order = ["Yeni Doktor", "Doçentlik", "Profesörlük", "Atama", "Vefat", "Etkinlik", "Yayın", "Duyuru"]
    order += [cat_label(x) for x in children("haber") if cat_label(x) not in order]  # Haberler'in alt kategorileri
    cnt = Counter(t["tag"] for t in news)
    chips = '<button class="chip" data-filter="tur" data-value="" aria-pressed="true">Tümü <span class="n">%d</span></button>' % len(news)
    chips += "".join('<button class="chip" data-filter="tur" data-value="%s" aria-pressed="false">%s <span class="n">%d</span></button>' % (E(k), E(k), cnt[k]) for k in order if cnt[k])
    years = sorted({t["sort"][0] for t in news if t["sort"][0]}, reverse=True)
    yopts = '<option value="">Tüm yıllar</option>' + "".join("<option>%d</option>" % y for y in years)
    data = [dict(id=t["id"], t=t["title"], g=t["tag"], d=t.get("date", ""), y=t["sort"][0], m=t.get("summary", "")[:200], s=t["slug"], i=(t.get("image") or "").replace("{ROOT}", "")) for t in news]
    body = page_hero(H["name"], E(H["description"]), [("index.html", "Ana Sayfa"), ("", H["name"])], "%d haber" % len(news),
                     dyn_button("oneri/topic", "Haber gönderin", "news", True))
    body += f'''
<div class="toolbar"><div class="container">
  <div class="row"><label class="input">{ic("search")}<input type="search" data-q placeholder="Haberlerde ara…" aria-label="Haber ara"></label><select class="select" data-filter-select="year" aria-label="Yıl">{yopts}</select></div>
  <div class="chips">{chips}</div>
</div></div>
<div class="container" style="padding-bottom:80px"><p class="result-info" data-info>{len(news)} kayıt</p><div class="grid grid-3" data-list="news">{"".join(news_card(t) for t in news[:24])}</div><div class="load-more"><button class="btn btn-ghost" data-more hidden>Daha fazla göster</button></div></div>'''
    layout("haberler.html", H["seo_title"] or H["name"], with_blocks(body, "haberler"), H["seo_desc"] or H["description"][:160], "haberler.html", data)

    for t in topics:
        # Konum, menü işareti ve "Diğer …" listesi haberin kategorisinden gelir (kategori panelden seçilir).
        c = CATS[t["forum"]]
        root = cat_root(c)
        href, label = cat_url(root), root["name"]
        crumbs = [("index.html", "Ana Sayfa")] + ([(href, label)] if c["parent"] else []) + [(cat_url(c), c["name"])]
        if c["key"] == "haber":
            crumbs.append(("", t["tag"]))
        pool_cat = c if len(BY_CAT[c["key"]]) > 1 or not c["parent"] else root
        posts = ""
        for i, p in enumerate(t["posts"]):
            head = "" if i == 0 else f'<div class="post-head"><span class="avatar">{initials(p["author"])}</span><div><strong>{E(p["author"])}</strong><br>{tr_date(p["date"])} · {E(p["time"])}</div></div>'
            posts += f'<div class="{"post" if i else ""}">{head}<div class="prose">{p["html"]}</div></div>'
        lst = cat_items(pool_cat["key"], "new")
        idx = next((i for i, x in enumerate(lst) if x["id"] == t["id"]), 0)
        prev_t = lst[idx + 1] if idx + 1 < len(lst) else None
        next_t = lst[idx - 1] if idx > 0 else None
        nav = ""
        for x, lbl in ((next_t, "Daha yeni"), (prev_t, "Daha eski")):
            if x: nav += f'<a class="card hover" href="{{ROOT}}{x["slug"]}"><div class="meta">{lbl}</div><h3 class="clamp-2" style="font-size:1rem">{E(x["title"])}</h3></a>'
        more = [x for x in lst if x["id"] != t["id"]][:5]
        info = "".join(f"<dt>{k}</dt><dd>{v}</dd>" for k, v in [("Kategori", E(t["tag"])), ("Tarih", tr_date(t.get("date"))), ("Yazan", E(t.get("author"))), ("Mesaj", len(t["posts"]) if len(t["posts"]) > 1 else "")] if v)
        words = len(strip_tags(" ".join(p["html"] for p in t["posts"])).split())
        eyebrow = " · ".join(x for x in (t["tag"], tr_date(t.get("date")), "%d dk okuma" % max(1, round(words / 200))) if x)
        # kapak görseli metnin içinde yoksa yazının başında gösterilir
        cover = ""
        if t.get("image") and t["image"] not in (t["posts"][0]["html"] if t["posts"] else ""):
            cover = '<figure class="article-cover"><img src="{ROOT}%s" alt="%s"></figure>' % (E(t["image"]), E(t["title"]))
        body = page_hero(t["title"], "", crumbs, eyebrow, own_button("topic", t["id"]))
        body += f'''<div class="container detail">
  <div><article class="panel">{cover}{posts}</article>{share_block(t["slug"], t["title"], t.get("summary", "")[:200], abs_url(t.get("image")), "topic:%d" % t["id"])}{comments_block("topic:%d" % t["id"])}{('<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(240px,1fr));margin-top:18px">%s</div>' % nav) if nav else ""}</div>
  <aside><div class="panel"><h3>Ayrıntılar</h3><dl class="dl">{info}</dl></div><div class="panel"><h3>Diğer {E(tr_lower(pool_cat["name"]))}</h3><div class="feed" style="margin-top:12px">{"".join(feed_topic(x) for x in more)}</div></div><a class="btn btn-ghost" href="{{ROOT}}{href}">{ic("left")} {label}</a></aside>
</div>'''
        layout(t["slug"], t["title"], body, t.get("summary", "")[:160], nav_active(c),
               share={"og": "etkinlik" if root["key"] == "etkinlikler" else "haber", "article": True, "image": abs_url(t.get("image")), "published": iso_date(t.get("date"))})


# ---------------------------------------------------------------- ETKİNLİKLER
def build_events():
    coord_cards = ""
    for n, c, y in COORD:
        alb = next((a for a in albums if a["event"].startswith("Koordinasyon-%02d" % n)), None)
        ev = next((e for e in events if str(y) in e["title"] and ("koordinasyon" in fold(e["title"]) or "istisare" in fold(e["title"]) or "calistay" in fold(e["title"]))), None)
        links_ = ""
        if ev: links_ += f'<a class="link-arrow" href="{{ROOT}}{ev["slug"]}">Duyuru {ic("arrow")}</a>'
        if alb: links_ += f'<a class="link-arrow" href="{{ROOT}}{alb["slug"]}">Fotoğraflar {ic("arrow")}</a>'
        coord_cards += f'<div class="coord reveal"><div class="no">{n:02d}</div><div class="city">{c}</div><div class="yr">{y}</div><div style="display:flex;flex-direction:column;gap:4px;margin-top:10px;font-size:.85rem">{links_}</div></div>'
    by_year = defaultdict(list)
    for e in events: by_year[e["sort"][0]].append(e)
    tl = ""
    for y in sorted(by_year, reverse=True):
        tl += '<div class="year-label" data-year>%s</div>' % (y or "Tarihsiz")
        for e in by_year[y]:
            tl += f'<div class="tl-item reveal" data-tur="{E(e["tag"])}" data-cat="{E(e["forum"])}"><a class="card hover" href="{{ROOT}}{e["slug"]}"><div class="meta"><span class="badge {TAG_BADGE.get(e["tag"], "")}">{E(e["tag"])}</span><span>{tr_date(e.get("date"))}</span>{("<span class=dot></span><span>%d mesaj</span>" % len(e["posts"])) if len(e["posts"]) > 1 else ""}</div><h3>{E(e["title"])}</h3><p class="clamp-2">{E(e.get("summary", ""))}</p></a></div>'
    EV = CATS.get("etkinlikler") or dict(CAT_DEF, name="Etkinlikler")
    body = page_hero(EV["name"], E(EV["description"]), [("index.html", "Ana Sayfa"), ("", EV["name"])], "%d duyuru" % len(events))
    # Kategori menüsü: Etkinlikler'in alt kategorileri (panelden eklenen yeni alt kategoriler de kendiliğinden gelir).
    # #tur=Koordinasyon (kısa ad), #tur=koordinasyon (anahtar ya da adres) bağlantılarının hepsi çalışır.
    cnt = Counter(e["forum"] for e in events)
    menu = '<button class="chip" type="button" data-ev-filter="" aria-pressed="true">Tümü <span class="n">%d</span></button>' % len(events)
    menu += "".join('<button class="chip" type="button" data-ev-filter="%s" data-ev-key="%s" data-ev-slug="%s" data-ev-heading="%s" data-ev-url="%s" aria-pressed="false">%s <span class="n">%d</span></button>'
                    % (E(cat_label(x)), E(x["key"]), E(x["slug"]), E(x["name"]), E(cat_url(x)), E(cat_label(x)), cnt[x["key"]]) for x in children("etkinlikler") if cnt[x["key"]])
    body += f'<div class="toolbar"><div class="container"><nav class="chips" aria-label="Etkinlik kategorileri">{menu}</nav></div></div>'
    body += f'''<section class="section" id="koordinasyon" data-ev-for="koordinasyon"><div class="container"><div class="section-head"><div><div class="eyebrow">Gelenek</div><h2>Koordinasyon toplantıları</h2><p>Anabilim dalı öğretim elemanlarının düzenli olarak bir araya geldiği ulusal buluşmalar.</p></div></div><div class="coord-strip">{coord_cards}</div></div></section>
<section class="section alt"><div class="container" style="max-width:900px"><div class="section-head"><div><div class="eyebrow">Arşiv</div><h2 data-ev-title>Etkinlik, sempozyum ve koordinasyon duyuruları</h2></div><a class="link-arrow" href="#" data-ev-link hidden>Kategori sayfası {ic("arrow")}</a></div><p class="result-info" data-ev-info></p><div class="timeline" data-ev-list>{tl}</div></div></section>'''
    layout("etkinlikler.html", EV["seo_title"] or EV["name"], with_blocks(body, "etkinlikler"), EV["seo_desc"] or EV["description"][:160], "etkinlikler.html")


# ---------------------------------------------------------------- GALERİ
def build_gallery():
    sec = ""
    for ev, als in album_groups.items():
        cards = ""
        for a in als:
            ph = a["photos"][:3]
            cover = "".join('<img src="{ROOT}%s" alt="" loading="lazy">' % E(p["thumb"]) for p in ph)
            cards += f'<a class="card album-card reveal" href="{{ROOT}}{a["slug"]}"><div class="cover{" single" if len(ph) < 3 else ""}">{cover}</div><div class="txt"><h3>{E(a["name"])}</h3><div class="meta">{len(a["photos"])} fotoğraf</div></div></a>'
        sec += f'<div class="section-head" style="margin:44px 0 18px"><h2 style="font-size:1.6rem">{E(ev)}</h2></div><div class="grid grid-4">{cards}</div>'
    vids = CHANNEL_VIDEOS
    meta = "%d fotoğraf · %d albüm" % (n_photos, len(albums)) + (" · %d video" % len(vids) if vids else "")
    body = page_hero("Galeri", "Koordinasyon toplantıları, sempozyumlar ve anma programlarından fotoğraflar ve videolar.", [("index.html", "Ana Sayfa"), ("", "Galeri")], meta)
    if vids:
        # Sekmeler: JavaScript yoksa iki bölüm alt alta görünür; varsa #fotograflar / #videolar ile seçilir
        yt = ST["youtube_url"]
        sub = ('<a class="btn btn-ghost btn-sm" href="%s" target="_blank" rel="noopener">%s Kanala abone olun</a>'
               % (E(yt + ("&" if "?" in yt else "?") + "sub_confirmation=1"), ic("yt"))) if yt else ""
        tabs = (f'<div class="toolbar"><div class="container"><nav class="chips" role="tablist" aria-label="Galeri">'
                f'<button class="chip" type="button" role="tab" data-gal-tab="fotograflar" aria-selected="true">{ic("image")} Fotoğraflar <span class="n">{n_photos}</span></button>'
                f'<button class="chip" type="button" role="tab" data-gal-tab="videolar" aria-selected="false">{ic("play")} Videolar <span class="n">{len(vids)}</span></button></nav></div></div>')
        body += tabs + f'<div class="container" style="padding-bottom:80px" data-gal-panel="fotograflar" id="fotograflar">{sec}</div>'
        body += (f'<div class="container" style="padding:44px 24px 80px" data-gal-panel="videolar" id="videolar"><div class="section-head"><div><div class="eyebrow">Mezhep.Org YouTube kanalı</div>'
                 f'<h2 style="font-size:1.6rem">Videolar</h2><p>Koordinasyon toplantıları, paneller ve anma programlarının kayıtları. Videoya tıklayınca burada oynar.</p></div>{sub}</div>'
                 f'<div class="vid-grid gal-vids">{"".join(vid_card(v) for v in vids)}</div></div>')
    else:
        body += f'<div class="container" style="padding-bottom:80px">{sec}</div>'
    layout("galeri.html", "Galeri", with_blocks(body, "galeri"), "Mezhep.Org fotoğraf ve video galerisi", "galeri.html", share={"og": "galeri"})
    for a in albums:
        figs = "".join(f'<figure data-full="{{ROOT}}{E(p["src"])}" data-cap="{E(p["title"])}"><img src="{{ROOT}}{E(p["src"])}" alt="{E(p["title"])}" loading="lazy"><figcaption>{E(p["title"])}</figcaption></figure>' for p in a["photos"])
        others_ = "".join(f'<a class="chip" href="{{ROOT}}{x["slug"]}">{E(x["name"])}</a>' for x in album_groups[a["event"]] if x is not a)
        body = page_hero("%s — %s" % (a["event"], a["name"]), "%d fotoğraf" % len(a["photos"]), [("index.html", "Ana Sayfa"), ("galeri.html", "Galeri"), ("", a["event"])])
        body += f'''<div class="container" style="padding:32px 24px 80px">{('<div class="chips" style="margin:0 0 24px">%s</div>' % others_) if others_ else ""}<div class="masonry" data-gallery>{figs}</div>{share_block(a["slug"], "%s — %s" % (a["event"], a["name"]), "%d fotoğraf" % len(a["photos"]), abs_url(a["photos"][0]["src"]) if a["photos"] else "", "album:" + a["slug"].split("/")[-1][:-5])}</div>
<div class="lightbox" aria-hidden="true"><img alt=""><div class="cap"></div><button class="lb-close" aria-label="Kapat">{ic("x")}</button><button class="lb-prev" aria-label="Önceki">{ic("left")}</button><button class="lb-next" aria-label="Sonraki">{ic("chev")}</button></div>'''
        layout(a["slug"], "%s — %s" % (a["event"], a["name"]), body, "%s — %d fotoğraf" % (a["event"], len(a["photos"])), "galeri.html",
               share={"og": "galeri", "image": abs_url(a["photos"][0]["src"]) if a["photos"] else ""})


# ---------------------------------------------------------------- KAYNAKLAR
KNOWN_URLS = {"e-Makalat": "https://dergipark.org.tr/tr/pub/emakalat", "KADER": "https://dergipark.org.tr/tr/pub/kader",
              "Kelam.Org": "http://www.kelam.org", "TDV İSAM Devam Eden İlahiyat Tezleri": "https://ktp.isam.org.tr"}


def build_resources():
    groups = defaultdict(list)
    for l in links:
        groups[l["category"]].append(l)
    lk = ""
    for cat, ls in groups.items():
        items = ""
        for l in ls:
            url = KNOWN_URLS.get(l["name"])
            tag = "a" if url else "div"
            attr = ' href="%s" target="_blank" rel="noopener"' % url if url else ""
            foot = '<div class="foot"><span class="link-arrow">Siteye git %s</span></div>' % ic("ext") if url else ""
            items += f'<{tag} class="card{" hover" if url else ""}"{attr}><div class="meta"><span class="badge">{E(l["sub"])}</span></div><h3>{E(l["name"])}</h3><p>{E(l["desc"])}</p>{foot}</{tag}>'
        lk += f'<h3 style="margin:28px 0 14px">{E(cat)}</h3><div class="grid grid-3">{items}</div>'
    fl = "".join(f'<div class="card"><span class="ic" style="width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:var(--gold-soft);color:var(--gold)">{ic("file")}</span><h3>{E(f["name"])}</h3><p>{E(f["desc"])}</p><div class="foot"><span>{E(f["category"])}</span><span>{tr_date(f["date"])}</span></div></div>' for f in files)
    # "Yayınlar" ve kaynaklar sayfasına eklenen diğer kategoriler (panel: Kategoriler → Diğer sayfalarda göster → Kaynaklar)
    blocks = "".join(h.replace("{ALT}", " alt") for h in page_blocks("kaynaklar"))
    body = page_hero("Kaynaklar", "Mezhepler tarihçisinin bilmesi gereken siteler, dergiler, yeni kitap tanıtımları ve indirilebilir araçlar.", [("index.html", "Ana Sayfa"), ("", "Kaynaklar")])
    body += f'''<section class="section"><div class="container"><div class="section-head"><div><div class="eyebrow">Bağlantılar</div><h2>Önerilen siteler ve dergiler</h2><p>“Mezhepler tarihçisi bunu görmeli!” dediğiniz siteleri bize iletin.</p></div></div>{lk}</div></section>
{blocks}
<section class="section"><div class="container"><div class="section-head"><div><div class="eyebrow">Araçlar</div><h2>İndirilebilir dosyalar</h2><p>Transkripsiyon yazı tipleri ve yardımcı belgeler. Dosyaların kendisi için lütfen site yöneticisiyle iletişime geçin.</p></div></div><div class="grid grid-3">{fl}</div></div></section>'''
    layout("kaynaklar.html", "Kaynaklar", body, "Mezhepler tarihi kaynakları, bağlantılar ve dosyalar", "kaynaklar.html")


# ---------------------------------------------------------------- HAKKINDA
def build_about():
    sss = cat_items("sss") if "sss" in CATS else []
    faq = "".join(f'<details class="panel"><summary style="cursor:pointer;font-weight:600;font-family:var(--serif);font-size:1.1rem">{E(t["title"])}</summary><div class="prose" style="margin-top:14px">{t["posts"][0]["html"]}</div></details>' for t in sss)
    body = page_hero("Hakkında", "www.mezhep.org, İlahiyat ve İslami İlimler Fakülteleri İslam Mezhepleri Tarihi Anabilim Dalı Koordinasyon Sitesi olarak hizmet vermektedir.", [("index.html", "Ana Sayfa"), ("", "Hakkında")], "2006'dan beri")
    body += f'''<div class="container detail">
  <div>
    <div class="panel prose"><h2 style="margin-top:0">Amacımız</h2>
      <p>Mezhep.Org, Türkiye'deki ilahiyat fakültelerinde İslam Mezhepleri Tarihi alanında çalışan akademisyenleri, bu alanda hazırlanan tezleri, kitapları, makaleleri ve tebliğleri tek bir çatı altında toplamak amacıyla kurulmuştur.</p>
      <p>Sitemizin en temel amacı; <strong>Mezhepler Tarihi çalışmalarını eksiksiz ve özetleriyle birlikte derlemektir.</strong> Gelişmesi ve zenginleşmesi için İslam Mezhepleri ile ilgilenen herkesin katkılarını beklemekteyiz. Üyelerimizden, öncelikle kendi çalışmaları olmak üzere, tashih ve eklemeler bekliyoruz.</p>
      <p>Site ayrıca bilim dalına dair güncel haberleri (yeni doktorlar, unvan ve atamalar, vefatlar), sempozyum ve koordinasyon toplantısı duyurularını ve bu etkinliklerden fotoğrafları arşivlemektedir.</p>
      <blockquote>Saygılarımızla, Mezhep.Org adına Ahmet İshak DEMİR</blockquote>
    </div>
    <div class="bento" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));margin-top:18px">
      <div class="tile"><span class="ic">{ic("users")}</span><div class="num" style="font-size:2.2rem">{STATS["members"]}</div><p>Akademisyen</p></div>
      <div class="tile gold"><span class="ic">{ic("book")}</span><div class="num" style="font-size:2.2rem">{STATS["works"]}</div><p>Eser</p></div>
      <div class="tile indigo"><span class="ic">{ic("news")}</span><div class="num" style="font-size:2.2rem">{STATS["news"]}</div><p>Haber</p></div>
      <div class="tile rose"><span class="ic">{ic("image")}</span><div class="num" style="font-size:2.2rem">{STATS["photos"]}</div><p>Fotoğraf</p></div>
    </div>
    <h2 id="sss" style="margin:48px 0 18px">Sık sorulan sorular</h2>
    <div style="display:flex;flex-direction:column;gap:12px">{faq}</div>
    <h2 id="kosullar" style="margin:48px 0 18px">Kullanım koşulları</h2>
    <div class="panel prose">{pages["policy"]}</div>
  </div>
  <aside id="iletisim">
    <div class="panel"><h3>İletişim</h3><p style="color:var(--ink-2);margin:0 0 16px">Tashih, ekleme ve önerileriniz için site yöneticisine ulaşabilirsiniz.</p>
      <dl class="dl"><dt>Yönetici</dt><dd>{E(ST["contact_person"])}</dd><dt>Kurum</dt><dd>{E(ST["contact_institution"])}</dd>{('<dt>E-posta</dt><dd><a href="mailto:%s">%s</a></dd>' % (E(ST["contact_email"]), E(ST["contact_email"]))) if ST["contact_email"] else ""}</dl></div>
    {('<a class="btn btn-primary" href="%s" target="_blank" rel="noopener">%s YouTube kanalımız</a>' % (E(ST["youtube_url"]), ic("yt"))) if ST["youtube_url"] else ""}
    {('<a class="btn btn-ghost" href="%s" target="_blank" rel="noopener">%s Facebook sayfamız</a>' % (E(ST["facebook_url"]), ic("fb"))) if ST["facebook_url"] else ""}
    {('<a class="btn btn-ghost brand-x" href="%s" target="_blank" rel="noopener">%s X (Twitter) hesabımız</a>' % (E(ST["x_url"]), BRAND["x"][1])) if ST["x_url"] else ""}
    <a class="btn btn-ghost" href="{{ROOT}}akademisyen/10.html">{ic("users")} Yönetici profili</a>
  </aside>
</div>'''
    layout("hakkinda.html", "Hakkında", with_blocks(body, "hakkinda"), "Mezhep.Org hakkında", "hakkinda.html")


# ---------------------------------------------------------------- KATEGORİ SAYFALARI
def write_redirect(path, target):
    """Adresi değiştirilen kategorinin eski adresi: eski bağlantılar ve arama motorları yeni adrese yönlenir."""
    r = "../" * path.count("/")
    doc = (f'<!doctype html>\n<html lang="tr"><head><meta charset="utf-8"><title>{E(SITE)}</title>'
           f'<link rel="canonical" href="{E(SITE_URL + quote(target, safe="/"))}"><meta name="robots" content="noindex">'
           f'<meta http-equiv="refresh" content="0; url={r}{E(target)}"></head><body><p>Bu sayfa taşındı: <a href="{r}{E(target)}">{E(target)}</a></p></body></html>')
    WRITTEN.add(path)
    REDIRECTS.add(path)
    out = os.path.join(ROOT, path)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        f.write(doc)


REDIRECTS = set()


def build_sitemap():
    """sitemap.xml: üretilen bütün sayfalar (haberlerde yayın tarihi); robots.txt panel ve API'yi dışarıda tutar."""
    dates = {t["slug"]: iso_date(t.get("date")) for t in topics}
    order = lambda p: (p.count("/"), p != "index.html", p)
    rows = []
    for p in sorted((p for p in WRITTEN if p not in REDIRECTS and p != "404.html"), key=order):
        loc = SITE_URL + ("" if p == "index.html" else quote(p, safe="/"))
        rows.append("<url><loc>%s</loc>%s</url>" % (E(loc), ("<lastmod>%s</lastmod>" % dates[p]) if dates.get(p) else ""))
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + "\n".join(rows) + "\n</urlset>\n")
    with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8") as f:
        f.write("User-agent: *\nAllow: /\nDisallow: /panel/\nDisallow: /api/\n\nSitemap: %ssitemap.xml\n" % SITE_URL)
    return len(rows)


def build_categories():
    """Her kategori için arşiv sayfası: kategorideki (alt kategorileri dahil) bütün yayımlanmış içerikler, arama, yıl
    süzgeci, sıralama ve "Daha fazla göster" ile. İçerikler HTML'de de yer alır (JavaScript'siz ziyaretçi ve arama motorları)."""
    for c in CAT_LIST:
        if c["page"]:
            continue  # haberler.html ve etkinlikler.html kendi sayfalarında üretilir
        items = cat_items(c["key"])
        path = cat_url(c)
        cnt = Counter(t["tag"] for t in items)
        chips = ""
        if len(cnt) > 1:
            kids = [cat_label(x) for x in children(c["key"])]
            chips = '<button class="chip" data-filter="tur" data-value="" aria-pressed="true">Tümü <span class="n">%d</span></button>' % len(items)
            chips += "".join('<button class="chip" data-filter="tur" data-value="%s" aria-pressed="false">%s <span class="n">%d</span></button>' % (E(k), E(k), cnt[k])
                             for k in kids + sorted(k for k in cnt if k not in kids) if cnt[k])
        years = sorted({t["sort"][0] for t in items if t["sort"][0]}, reverse=True)
        yopts = '<option value="">Tüm yıllar</option>' + "".join("<option>%d</option>" % y for y in years)
        sorts = [("new", "En yeni"), ("old", "En eski"), ("title", "Başlık (A–Z)")] + ([("manual", "Önerilen sıra")] if c["sort"] == "manual" else [])
        sopts = "".join('<option value="%s"%s>%s</option>' % (k, " selected" if k == c["sort"] else "", l) for k, l in sorts)
        data = [dict(id=t["id"], t=t["title"], g=t["tag"], d=t.get("date", ""), y=t["sort"][0], m=t.get("summary", "")[:200], s=t["slug"],
                     i=(t.get("image") or "").replace("{ROOT}", ""), o=t["order"]) for t in items]
        crumbs = [("index.html", "Ana Sayfa")] + ([(cat_url(CATS[c["parent"]]), CATS[c["parent"]]["name"])] if c["parent"] else []) + [("", c["name"])]
        body = page_hero(c["name"], E(c["description"]), crumbs, "%d içerik" % len(items),
                         dyn_button("oneri/topic", "İçerik gönderin", "news", True) if c.get("open_submit") else "")
        if items:
            body += f'''
<div class="toolbar"><div class="container">
  <div class="row"><label class="input">{ic("search")}<input type="search" data-q placeholder="Bu kategoride ara…" aria-label="Kategoride ara"></label><select class="select" data-filter-select="year" aria-label="Yıl">{yopts}</select><select class="select" data-sort aria-label="Sıralama">{sopts}</select></div>
  {('<div class="chips">%s</div>' % chips) if chips else ""}
</div></div>'''
        cards = "".join(news_card(t) for t in items) or '<div class="empty" style="grid-column:1/-1">Bu kategoride henüz yayımlanmış içerik bulunmuyor.</div>'
        body += (f'<div class="container" style="padding:{"0" if items else "32px"} 24px 80px"><p class="result-info" data-info>{len(items)} kayıt</p>'
                 f'<div class="grid grid-3" data-list="news" data-empty="Bu kategoride henüz yayımlanmış içerik bulunmuyor.">{cards}</div>'
                 f'<div class="load-more"><button class="btn btn-ghost" data-more hidden>Daha fazla göster</button></div></div>')
        og = "etkinlik" if cat_root(c)["key"] == "etkinlikler" else "haber"
        layout(path, c["seo_title"] or c["name"], body, (c["seo_desc"] or c["description"] or "%s — %s" % (c["name"], SITE))[:160], nav_active(c), data, share={"og": og})
    live = {c["slug"] for c in CATS.values() if not c["page"]}
    for c in CATS.values():
        for old in c["old_slugs"]:
            if old not in live:
                write_redirect("kategori/%s.html" % old, cat_url(c))


# ---------------------------------------------------------------- ARAMA DİZİNİ
def build_index():
    idx = [["a", m["name"], "%s · %s" % (m["title"], m["university"]), m["slug"]] for m in members]
    idx += [["e", w["title"], "%s · %s%s" % (w["kind"], w["author"], (" · %d" % w["year"]) if w["year"] else ""), w["slug"]] for w in works]
    idx += [["h", t["title"], "%s · %s" % (t["tag"], tr_date(t.get("date"))), t["slug"]] for t in sorted(topics, key=lambda t: t["sort"], reverse=True)]
    idx += [["g", "%s — %s" % (a["event"], a["name"]), "%d fotoğraf" % len(a["photos"]), a["slug"]] for a in albums]
    os.makedirs(os.path.join(ROOT, "assets", "js"), exist_ok=True)
    with open(os.path.join(ROOT, "assets", "js", "search-index.js"), "w", encoding="utf-8") as f:
        f.write("window.MZ_INDEX=" + json.dumps(idx, ensure_ascii=False, separators=(",", ":")) + ";")


def build_404():
    # Sunucu her derinlikten bu sayfayı döndürür; göreli yollar yerine kök yolları kullanılır.
    body = f'''<section class="page-hero">{PATTERN}<div class="container" style="text-align:center;padding:40px 0">
<div class="eyebrow">404</div><h1>Aradığınız sayfa bulunamadı</h1><p style="margin:0 auto">Sayfa taşınmış ya da kaldırılmış olabilir. Ana sayfadan devam edebilir ya da sitede arama yapabilirsiniz.</p>
<div class="hero-actions" style="justify-content:center;margin-top:24px"><a class="btn btn-primary" href="/index.html">Ana sayfa</a><button class="btn btn-ghost" type="button" data-open-search>{ic("search")} Sitede ara</button></div></div></section>'''
    layout("404.html", "Sayfa bulunamadı", body)
    p = os.path.join(ROOT, "404.html")
    with open(p, encoding="utf-8") as f:
        doc = f.read()
    doc = doc.replace('href="assets/', 'href="/assets/').replace('src="assets/', 'src="/assets/').replace('data-root=""', 'data-root="/"')
    doc = re.sub(r'href="(?!https?:|/|#|mailto:)([^"]+\.html[^"]*)"', r'href="/\1"', doc)
    with open(p, "w", encoding="utf-8") as f:
        f.write(doc)


build_home(); build_members(); build_works(); build_news(); build_events(); build_gallery(); build_resources(); build_about(); build_categories(); build_index(); build_404()
_n_sitemap = build_sitemap()
_stale = remove_stale()
if _stale:
    print("Eski sayfa silindi:", _stale)
print("Tamam:", STATS)
