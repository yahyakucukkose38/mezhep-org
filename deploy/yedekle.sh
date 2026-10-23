#!/usr/bin/env bash
# Gece yedeği (/etc/cron.d/mezhep, 03:15): veritabanının tutarlı kopyası (VACUUM INTO) + yüklenen dosyalar.
# Yedekler /opt/mezhep/yedekler altında, yalnızca root okur; son 14 gün saklanır. Kayıtlar: journalctl -t mezhep-yedek
set -euo pipefail
hedef=/opt/mezhep/yedekler
tarih=$(date +%F)
umask 077
mkdir -p "$hedef/veritabani" "$hedef/dosyalar"

docker exec mezhep-app-1 node --disable-warning=ExperimentalWarning -e "
  const fs = require('fs'); fs.mkdirSync('/data/yedek', { recursive: true });
  const f = '/data/yedek/mezhep-$tarih.db'; fs.rmSync(f, { force: true });
  new (require('node:sqlite').DatabaseSync)('/data/mezhep.db').exec(\"VACUUM INTO '\" + f + \"'\");"
docker cp "mezhep-app-1:/data/yedek/mezhep-$tarih.db" "$hedef/veritabani/"
docker exec mezhep-app-1 rm -f "/data/yedek/mezhep-$tarih.db"
gzip -f "$hedef/veritabani/mezhep-$tarih.db"

birim=$(docker volume inspect -f '{{.Mountpoint}}' mezhep_veri)
onceki=$(ls -1d "$hedef/dosyalar"/*/ 2>/dev/null | tail -n1 || true)
rsync -a --delete ${onceki:+--link-dest="$onceki"} "$birim/uploads/" "$hedef/dosyalar/$tarih/" 2>/dev/null || mkdir -p "$hedef/dosyalar/$tarih"

find "$hedef/veritabani" -name 'mezhep-*.db.gz' -mtime +14 -delete
find "$hedef/dosyalar" -mindepth 1 -maxdepth 1 -type d -mtime +14 -exec rm -rf {} +
logger -t mezhep-yedek "yedek tamam: $tarih"
