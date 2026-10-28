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
| Kategoriler | `kategori/<adres>.html` | her haber/yazı kategorisinin bütün içerikleri (ör. `kategori/koordinasyon.html`) |

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

## Kategoriler ve menü

Haber ve yazıların kategorisi `topics.json` içindeki `forum` alanıdır; kategorilerin kendisi `data/categories.json`'da
(sunucu sürümünde veritabanında, Panel → Yönetim → **Kategoriler ve menü**) tanımlıdır. Bir içeriğin kategorisini
seçmek yeterlidir; site üretilirken içerik

1. kategorinin sayfasına (`kategori/<adres>.html`; Haberler ve Etkinlikler için `haberler.html`, `etkinlikler.html`),
2. kategorinin "Ana sayfada göster" / "Diğer sayfalarda göster" ile eklendiği sayfalardaki bölüme (ayarlanan sayıda ve sırada),
3. menüdeki kategori bağlantısının açtığı sayfaya

kendiliğinden yerleşir. Sayfalardaki bölümler (ör. ana sayfada 6 içerik) arşivden bağımsızdır: kategori sayfası her zaman
bütün içerikleri listeler. Alt kategoriler menüde üst kategorinin altında açılır; adresi değişen kategorinin eski
adresi yeni sayfaya yönlendirilir.

## Ekran boyutları

Site ve panel tek kod tabanıyla 320 px telefondan geniş ekrana kadar çalışır (`assets/css/style.css` sonundaki
responsive katman, `server/panel/panel.css`). Telefonda ve tablette menü açıldığında arka plan kilitlenir, odak menüde
kalır, Esc ya da dışarı dokunma menüyü kapatır; panelde menü soldan açılan çekmece, tablolar kart görünümündedir.
`npm run test:ui` 8 ekran ölçüsünde ve gerçek cihaz profillerinde (iPhone, iPad, Pixel, Galaxy Tab) taşma, menü,
dokunma hedefi, listeleme ve telefondan haber yayımlamayı denetler; `MZ_UI_SHOTS=<klasör>` ekran görüntüsü kaydeder.
`node test-ui/audit.js <klasör> [chromium|firefox|webkit] --shots` ayrıntılı ölçüm raporu (JSON) üretir.

## Canlı siteden yeniden veri çekme (isteğe bağlı)

```
python scripts/crawl.py  <önbellek-klasörü>
python scripts/parse.py  <önbellek-klasörü> data
python scripts/media.py  .
python scripts/build.py
```

## Üyelik, yönetim paneli ve Akaid Asistanı (sunucu sürümü)

`server/` klasörü sitenin dinamik sürümüdür: üyelik (kayıt, giriş, yönetici onayı), üyelerin eser ekleme /
düzeltme önerisi / haber gönderme / profil sahiplenme / yorum yazma akışları, yönetici onay kuyruğu, içerik
düzenleme, üye yönetimi ve sağ alttaki asistanlar (OpenAI `gpt-6-luna`): **Akaid Asistanı** (Ehl-i Sünnet itikad
kaynakları) ve **Hanefî Fıkhı Asistanı** (klasik Arapça Hanefî metinleri; cilt/sayfa göstererek Türkçe yanıt).
Onaylanan her değişiklikten sonra site `scripts/build.py` ile birkaç saniyede yeniden üretilir.

Yorumlar zengin metin editörüyle yazılır (`assets/js/comment-editor.js`, yalnızca yorum yazabilen üyelere yüklenir):
kalın/italik, başlık, liste, alıntı, bağlantı, görsel yükleme (tarayıcıda küçültülür) ve YouTube/Vimeo videosu. Gelen HTML
sunucuda izin listesiyle temizlenir (`server/src/content.js` → `cleanCommentHtml`); eski düz metin yorumlar olduğu gibi gösterilir.

Yerelde çalıştırma:

```
cd server
npm install
MZ_ADMIN_EMAIL=siz@ornek.com npm start          # http://localhost:3000, panel: /panel/
npm run kaynak -- "<akaid markdown klasörü>"    # Akaid asistanı kaynak indeksi (isteğe bağlı)
npm run kaynak-hanefi -- "../HANEFİ FIKHI"      # Hanefî asistanı indeksi (isteğe bağlı)
npm test                                        # 78 uçtan uca test
npm run test:ui                                 # responsive arayüz testleri (Playwright: Chromium, Firefox, WebKit;
                                                #   ilk seferde: npx playwright install chromium firefox webkit)
```

Asistan için `OPENAI_API_KEY` ortam değişkeni gerekir (yalnızca sunucuda; bkz. `deploy/.env.example`).
Sunucuya yayın: [deploy/README.md](deploy/README.md).

## Notlar

- Bağlantılar bölümündeki sitelerin gerçek adresleri ve "indir" bölümündeki 2 dosya (transkripsiyon yazı tipleri)
  eski sitede yalnızca üyelere açık olduğu için alınamadı. Bilinen dergi/site adresleri (e‑Makalat, KADER, Kelam.Org, İSAM)
  `scripts/build.py` içindeki `KNOWN_URLS` ile eklendi.
- Eski sunucuda artık bulunmayan birkaç fotoğraf galeriden otomatik olarak çıkarılır.
