#!/bin/sh
# Mezhep.Org: vebides nginx kapsayıcısı her açılışta çalıştırır (compose.override.yml bağlar).
# Elle: docker exec vebides-nginx-1 /docker-entrypoint.d/46-mezhep.sh && docker exec vebides-nginx-1 nginx -s reload
# Siteyi yalnızca sertifikası varsa ve yapılandırma geçerliyse ekler; bu projedeki bir eksik ya da hata
# vebides nginx'inin ve aynı nginx'teki diğer sitelerin (ykk vb.) açılmasını hiçbir zaman engellemez.
set -u
rm -f /etc/nginx/conf.d/mezhep.conf
src=/etc/nginx/mezhep/mezhep.conf
[ -s "$src" ] || { echo "mezhep: site ayarı yok, eklenmedi"; exit 0; }
for f in $(grep -o 'ssl_certificate[_a-z]* *[^;]*' "$src" | awk '{print $2}'); do
  [ -s "$f" ] || { echo "mezhep: sertifika yok ($f), eklenmedi"; exit 0; }
done
cp "$src" /etc/nginx/conf.d/mezhep.conf
if nginx -t -q 2>/dev/null; then
  echo "mezhep: eklendi"
else
  rm -f /etc/nginx/conf.d/mezhep.conf
  echo "mezhep: nginx -t denetiminden geçmedi, eklenmedi"
fi
exit 0
