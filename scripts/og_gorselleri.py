"""Sosyal medya paylaşım önizlemesi için varsayılan görseller (1200x630): kapak görseli olmayan içeriklerde kullanılır.
Çalıştırma: python scripts/og_gorselleri.py  →  assets/img/og-*.jpg"""
import os
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, "assets", "img")
FONTS = "C:/Windows/Fonts/" if os.name == "nt" else "/usr/share/fonts/truetype/dejavu/"
NAVY, NAVY2, GOLD, PALE = (42, 72, 98), (30, 54, 76), (201, 162, 77), (201, 214, 227)
TYPES = {"genel": "", "haber": "HABER", "etkinlik": "ETKİNLİK", "eser": "ESER", "akademisyen": "AKADEMİSYEN", "galeri": "FOTOĞRAF GALERİSİ"}


def font(name, size):
    for n in name:
        try:
            return ImageFont.truetype(FONTS + n, size)
        except OSError:
            pass
    return ImageFont.load_default()


def make(kind, label):
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), NAVY)
    d = ImageDraw.Draw(im)
    for y in range(H):  # hafif dikey geçiş
        t = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(NAVY[i] * (1 - t) + NAVY2[i] * t) for i in range(3)))
    logo = Image.open(os.path.join(IMG, "logo.jpg")).convert("RGB")
    lw = 300
    logo = logo.resize((lw, int(logo.height * lw / logo.width)), Image.LANCZOS).filter(ImageFilter.SMOOTH)
    # logo, köşeleri yuvarlatılmış bir rozet olarak (kendi zemin rengi arka plandan ayrışmasın diye)
    mask = Image.new("L", logo.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, logo.width - 1, logo.height - 1], radius=28, fill=255)
    ly = (H - logo.height) // 2
    d.rounded_rectangle([86, ly - 4, 90 + lw + 3, ly + logo.height + 3], radius=31, outline=(70, 102, 130), width=2)
    im.paste(logo, (90, ly), mask)
    x = 90 + lw + 60
    d.rectangle([x, 196, x + 70, 202], fill=GOLD)
    if label:
        d.text((x, 222), label, font=font(["segoeuib.ttf", "DejaVuSans-Bold.ttf"], 30), fill=GOLD)
    d.text((x, 262 if label else 230), "Mezhep.Org", font=font(["georgiab.ttf", "DejaVuSerif-Bold.ttf"], 86), fill=(255, 255, 255))
    d.text((x, 372 if label else 340), "İslam Mezhepleri Tarihi", font=font(["segoeui.ttf", "DejaVuSans.ttf"], 34), fill=PALE)
    d.text((x, 418 if label else 386), "Koordinasyon Sitesi", font=font(["segoeui.ttf", "DejaVuSans.ttf"], 34), fill=PALE)
    im.save(os.path.join(IMG, "og-%s.jpg" % kind), "JPEG", quality=88, optimize=True, progressive=True)


for k, l in TYPES.items():
    make(k, l)
print("ok:", ", ".join("og-%s.jpg" % k for k in TYPES))
