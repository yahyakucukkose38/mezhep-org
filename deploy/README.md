# Sunucuya yayın (Docker)

Uygulama (site + üye/yönetim paneli + API + Akaid Asistanı) tek bir Docker kapsayıcısıdır ve
`185.23.17.212` sunucusunda, ykk projesinin yanında, ondan bağımsız çalışır.

| | |
|---|---|
| Adres | https://mezhep.net (`www.mezhep.net` ve eski `mezhep.ihyadijital.com` → 301 ile buraya) |
| Alan adı ve DNS | Niobe Hosting cPanel (`https://luffy.trdns.com:2083`) → Zone Editor: `A mezhep.net → 185.23.17.212`, `CNAME www → mezhep.net`; e-posta Niobe'de kalır (`A mail → 77.245.149.76`, `MX → mail.mezhep.net`) |
| Sunucuda | `/opt/mezhep` (kod: `src/`, ayarlar: `.env`, asistan kaynakları: `kaynaklar/`, yedekler: `yedekler/`) |
| Compose projesi | `mezhep` (kapsayıcı `mezhep-app-1`, birim `mezhep_veri` → `/data`) |
| Uygulama portu | yalnızca `127.0.0.1:3400` |
| HTTPS | vebides nginx'i (80/443); site `vebides-nginx/` ile eklenir, vebides dosyaları değiştirilmez |

## İlk kurulum

1. **DNS:** ana alan adının A kaydını sunucuya (`185.23.17.212`) yönlendirin; `.env` içinde `ALAN_ADI` ana adres,
   `YONLENDIRILEN_ALANLAR` ise ana adrese 301 ile yönlenecek adlardır (www, eski alan adı). Sertifika hepsini kapsar.
2. **Ayarlar:** sunucuda `/opt/mezhep/.env` dosyasını `deploy/.env.example`'dan oluşturun; `MZ_ADMIN_EMAIL` ve
   `OPENAI_API_KEY` alanlarını doldurun (`chmod 600 /opt/mezhep/.env`). Anahtar yalnızca bu dosyada durur.
3. **Yükleme** (proje klasöründe, değişiklikler commit edilmiş olmalı):

   ```bash
   node deploy/yayinla.mjs --host root@185.23.17.212 --vebides-nginx-bagla \
        --kaynak "E:/Yahya Küçükköse/Arşiv Full/dirayet/AKAİD KELĀM/KELÂM/ehli-sunnet-itikad-kaynaklari"
   ```

   `--vebides-nginx-bagla` yalnızca ilk kurulumda gerekir: `/opt/vebides/compose.override.yml` dosyasını yedekleyip
   üç bağlama ekler ve vebides nginx'ini birkaç saniye yeniden başlatır (ykk'nin bağlantısına dokunulmaz).
4. **İlk yönetici:** `docker exec mezhep-app-1 cat /data/gizli/ilk-yonetici.txt` → geçici şifreyle
   https://mezhep.ihyadijital.com/panel/ adresinden girin, şifreyi değiştirin, sonra dosyayı silin:
   `docker exec mezhep-app-1 rm /data/gizli/ilk-yonetici.txt`.

Sonraki güncellemeler: `node deploy/yayinla.mjs --host root@185.23.17.212`
Asistan kaynaklarını yenilemek: aynı komuta `--kaynak "<klasör>"` ekleyin.

## Akaid Asistanı (OpenAI)

- Varsayılan model `gpt-6-luna` (`OPENAI_MODEL`). Basit sorular `reasoning.effort=none` + en çok 400 çıktı token,
  açıklama/kıyas/delil isteyen sorular `low` + en çok 1200 çıktı token (`AI_EFFORT_*`, `AI_MAX_OUTPUT_*`).
- Yalnızca onaylı üyeler kullanabilir. Sınırlar: kişi başı günlük soru ve token kotası, dakikalık hız, soru uzunluğu,
  genel ve kişi başı eşzamanlı istek, aylık ve toplam bütçe tavanı. Tümü `.env` ile değişir; değişiklik için
  `docker compose -f /opt/mezhep/src/deploy/docker-compose.yml --env-file /opt/mezhep/.env up -d`.
- Soru/yanıt metinleri saklanmaz; her çağrının token sayısı ve tahmini maliyeti `ai_usage` tablosuna yazılır.
  Rapor: Panel → Yönetim → **Yapay zekâ kullanımı**.
- Birim fiyatlar (`AI_PRICE_*`) gpt-6-luna için yayımlanan değerlerdir; OpenAI fiyat sayfasından doğrulayın.
- Anahtarı değiştirmek/iptal etmek: `.env`'yi düzenleyip yukarıdaki `up -d` komutunu çalıştırın.
  Acil kapatma: `AI_ENABLED=false`.
- Kaynak metinler (`/opt/mezhep/kaynaklar`) depoya girmez; depo herkese açıktır.

## Hanefî Fıkhı Asistanı

- Kaynak: `HANEFİ FIKHI` klasöründeki OpenITI biçimli Arapça klasik metinler (Hidâye, Bedâi', el-Mebsût,
  Reddü'l-muhtâr, Fetâvâ-yı Hindiyye…). Hanefî olmayan ve mukayeseli eserler (Neylü'l-meârib, Kelvezânî,
  İsnevî, Saymerî, Âbî el-Ezherî, İbn Hübeyre) indekse alınmaz; aynı eserin farklı neşirleri tekilleştirilir.
- İndeksi yerelde üretip gönderin (kaynak metin sunucuya gitmez, yalnızca indeks gider):

  ```
  cd server && npm run kaynak-hanefi -- "../HANEFİ FIKHI"        # → .yerel/hanefi.db (~1,5 dk)
  cd .. && node deploy/yayinla.mjs --host root@185.23.17.212 --anahtar ~/.ssh/mezhep_deploy_ed25519 --hanefi-indeks .yerel/hanefi.db
  ```
- Akış: Türkçe soru → `effort=none`, en çok 200 token'lık ön çağrıyla Arapça fıkıh terimleri (JSON) → indekste arama
  → kaynaklı Türkçe yanıt (eser, müellif, cilt/sayfa). İki çağrının token ve maliyeti tek kayıtta toplanır.
- Panel → Site ayarları → **Asistanlar** sekmesinden açılıp kapatılır; karşılama metni ve önerilen sorular oradadır.

## Yönetim komutları

```bash
docker exec mezhep-app-1 npm --prefix server run yonetici -- olustur <e-posta> "Ad Soyad"   # yönetici ekle
docker exec mezhep-app-1 npm --prefix server run yonetici -- sifre <e-posta>                 # geçici şifre
docker compose -f /opt/mezhep/src/deploy/docker-compose.yml logs -f app                       # kayıtlar
```

## Yedek

Her gece 03:15 `yedekle.sh`: veritabanı (`VACUUM INTO`, gzip) ve yüklenen dosyalar → `/opt/mezhep/yedekler`
(14 gün). Geri yükleme: kapsayıcıyı durdurun, `.db.gz` dosyasını açıp `mezhep_veri` birimindeki `mezhep.db`
yerine koyun (`-wal`/`-shm` dosyalarını silin), kapsayıcıyı başlatın.
