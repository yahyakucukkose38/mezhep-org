# Mezhep.Org — yeni tasarım

www.mezhep.org sitesinin içeriği alınarak modern, hızlı ve mobil uyumlu statik bir site olarak yeniden oluşturuldu.
Sunucu gerektirmez: `index.html` dosyasını çift tıklayarak açabilir ya da klasörü herhangi bir statik barındırmaya
(GitHub Pages, Netlify, Cloudflare Pages, Plesk/IIS) olduğu gibi yükleyebilirsiniz.

## İçerik

| Bölüm | Sayfa | Kaynak |
|---|---|---|
| Ana sayfa | `index.html` | özet, son haberler, koordinasyon toplantıları, öne çıkan eserler |
| Akademisyenler | `akademisyenler.html`, `akademisyen/<no>.html` | 149 kişi, fotoğraf, özgeçmiş, eserleri ve danışmanlıkları |
| Eserler | `eserler.html`, `eser/<no>.html` | 318 tez/kitap/makale/tebliğ, Türkçe özet + İngilizce abstract |
| Haberler | `haberler.html`, `haber/<no>.html` | 212 haber ve tüm yanıtları |
| Etkinlikler | `etkinlikler.html` | 47 sempozyum/toplantı duyurusu, 9 koordinasyon toplantısı |
| Galeri | `galeri.html`, `galeri/<albüm>.html` | fotoğraf albümleri, ışık kutusu |
| Kaynaklar | `kaynaklar.html` | bağlantılar, kitap haberleri, dosyalar |
| Hakkında | `hakkinda.html` | amaç, SSS, kullanım koşulları, iletişim |

Özellikler: Ctrl+K (veya `/`) ile site geneli anlık arama, açık/koyu tema, listelerde filtre/sıralama,
kaynak gösterimi kopyalama, mobil menü, erişilebilir yapı ve yazdırma görünümü.

## Klasör yapısı

```
data/          Sitenin tüm verisi (JSON) — içerik düzenlemesi burada yapılır
media/         mezhep.org'dan indirilen görseller (galeri, haber, akademisyen fotoğrafları)
assets/        CSS, JavaScript, simge
scripts/       build.py (siteyi üretir), crawl.py / parse.py / media.py (canlı siteden veri çeker)
*.html, akademisyen/, eser/, haber/, galeri/   üretilmiş sayfalar (elle düzenlemeyin)
```

## İçerik güncelleme

1. `data/` içindeki ilgili JSON dosyasını düzenleyin (ör. `works.json` içine yeni bir eser ekleyin).
2. Siteyi yeniden üretin:

   ```
   python scripts/build.py
   ```

## Canlı siteden yeniden veri çekme (isteğe bağlı)

```
python scripts/crawl.py  <önbellek-klasörü>
python scripts/parse.py  <önbellek-klasörü> data
python scripts/media.py  .
python scripts/build.py
```

## Notlar

- Bağlantılar bölümündeki sitelerin gerçek adresleri ve "indir" bölümündeki 2 dosya (transkripsiyon yazı tipleri)
  eski sitede yalnızca üyelere açık olduğu için alınamadı. Bilinen dergi/site adresleri (e‑Makalat, KADER, Kelam.Org, İSAM)
  `scripts/build.py` içindeki `KNOWN_URLS` ile eklendi.
- Eski sunucuda artık bulunmayan birkaç fotoğraf galeriden otomatik olarak çıkarılır.
