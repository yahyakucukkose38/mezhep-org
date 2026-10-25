#!/usr/bin/env bash
# Let's Encrypt sertifikasını alır (yoksa) ya da yeniler (30 günden az kaldıysa); değiştiyse vebides nginx'ini
# kesintisiz yeniden yükler. Sunucuda root olarak: yayinla.mjs her yüklemede, /etc/cron.d/mezhep her gece çağırır.
# Doğrulama dosyası, vebides nginx'inin zaten sunduğu ACME_WEBROOT klasörüne yalnızca doğrulama süresince konur.
set -euo pipefail
set -a
# shellcheck disable=SC1091
. /opt/mezhep/.env
set +a
: "${ALAN_ADI:?}" "${SERTIFIKA_DIZINI:?}" "${ACME_WEBROOT:?}"
[ -d "$ACME_WEBROOT" ] || { echo "ACME_WEBROOT bulunamadı: $ACME_WEBROOT" >&2; exit 1; }
mkdir -p "$SERTIFIKA_DIZINI"
isaret="$SERTIFIKA_DIZINI/mezhep-yenilendi"
[ "${1:-}" = --yeniden-yukle ] && touch "$isaret"

certbot() {
  docker run --rm -v "$SERTIFIKA_DIZINI:/etc/letsencrypt" -v "$ACME_WEBROOT:/var/www/certbot" \
    certbot/certbot:latest "$@" --deploy-hook "touch /etc/letsencrypt/mezhep-yenilendi"
}

# Sertifika ana adresi ve yönlendirilen adları (www, eski alan adları) birlikte kapsar. Yönlendirilen bir ad,
# DNS kaydı bu sunucuyu (ana adresin IP'si) gösterene kadar sertifikaya katılmaz: böylece bir alan adı
# DNS değişikliğinden önce .env'e eklenebilir; kayıt değişince saatlik denetim onu kendiliğinden sertifikaya ekler.
ip_of() { getent ahostsv4 "$1" 2>/dev/null | awk 'NR==1{print $1}'; }
bu_sunucu=$(ip_of "$ALAN_ADI")
alanlar="$ALAN_ADI"
for a in ${YONLENDIRILEN_ALANLAR:-}; do
  if [ -n "$bu_sunucu" ] && [ "$(ip_of "$a")" = "$bu_sunucu" ]; then alanlar="$alanlar $a"; else echo "Bekliyor (DNS henüz bu sunucuyu göstermiyor): $a"; fi
done
pem="$SERTIFIKA_DIZINI/live/$ALAN_ADI/fullchain.pem"
eksik=""
if [ -s "$pem" ]; then
  kapsam=$(openssl x509 -in "$pem" -noout -ext subjectAltName 2>/dev/null || true)
  for a in $alanlar; do echo "$kapsam" | grep -qw "DNS:$a" || eksik="$eksik $a"; done
fi
if [ -s "$pem" ] && [ -z "$eksik" ]; then
  certbot renew --quiet --cert-name "$ALAN_ADI"
else
  # başarısız bir denemeden sonra 6 saat beklenir (Let's Encrypt deneme sınırları)
  deneme="$SERTIFIKA_DIZINI/mezhep-son-basarisiz"
  if [ -s "$pem" ] && [ -n "$(find "$deneme" -mmin -360 2>/dev/null)" ]; then echo "Son deneme başarısızdı; 6 saat dolmadan yeniden denenmez."; exit 0; fi
  [ -n "$eksik" ] && echo "Sertifikaya eklenecek alan adları:$eksik"
  trap 'touch "$deneme"' ERR
  # shellcheck disable=SC2046
  certbot certonly --webroot -w /var/www/certbot $(for a in $alanlar; do printf -- '-d %s ' "$a"; done) --cert-name "$ALAN_ADI" \
    --expand --agree-tos --register-unsafely-without-email --non-interactive
  trap - ERR; rm -f "$deneme"
fi

[ -f "$isaret" ] || exit 0
if [ "$(docker inspect -f '{{.State.Running}}' vebides-nginx-1 2>/dev/null)" = true ] &&
  docker exec vebides-nginx-1 test -x /docker-entrypoint.d/46-mezhep.sh; then
  docker exec vebides-nginx-1 /docker-entrypoint.d/46-mezhep.sh
  docker exec vebides-nginx-1 nginx -t -q && docker exec vebides-nginx-1 nginx -s reload
fi
rm -f "$isaret"
