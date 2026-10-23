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

if [ -s "$SERTIFIKA_DIZINI/live/$ALAN_ADI/fullchain.pem" ]; then
  certbot renew --quiet --cert-name "$ALAN_ADI"
else
  certbot certonly --webroot -w /var/www/certbot -d "$ALAN_ADI" --cert-name "$ALAN_ADI" \
    --agree-tos --register-unsafely-without-email --non-interactive
fi

[ -f "$isaret" ] || exit 0
if [ "$(docker inspect -f '{{.State.Running}}' vebides-nginx-1 2>/dev/null)" = true ] &&
  docker exec vebides-nginx-1 test -x /docker-entrypoint.d/42-mezhep.sh; then
  docker exec vebides-nginx-1 /docker-entrypoint.d/42-mezhep.sh
  docker exec vebides-nginx-1 nginx -t -q && docker exec vebides-nginx-1 nginx -s reload
fi
rm -f "$isaret"
