#!/usr/bin/env node
// Mezhep.Org'u sunucuya yükler (Windows/macOS/Linux; ssh gerekir).
//
//   node deploy/yayinla.mjs --host root@185.23.17.212
//   node deploy/yayinla.mjs --host root@185.23.17.212 --vebides-nginx-bagla     (ilk kurulumda bir kez)
//   node deploy/yayinla.mjs --host root@185.23.17.212 --kaynak "E:/…/ehli-sunnet-itikad-kaynaklari"
//   node deploy/yayinla.mjs --host root@185.23.17.212 --anahtar ~/.ssh/mezhep_deploy_ed25519 …
//   node deploy/yayinla.mjs --host root@185.23.17.212 --env-yukle     (yereldeki deploy/.env → /opt/mezhep/.env)
//
// Yalnızca depoya işlenmiş (commit) dosyalar gönderilir; .env ve kaynak metinler depoda yoktur.
// Sunucuda önce /opt/mezhep/.env oluşturulmalıdır (deploy/.env.example).
import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const flag = (name) => args.includes(name);
const host = opt("--host");
// --anahtar: yalnızca bu iş için oluşturulmuş SSH anahtarı (ör. ~/.ssh/mezhep_deploy_ed25519)
const keyFile = opt("--anahtar");
const SSH_OPTS = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", ...(keyFile ? ["-i", keyFile, "-o", "IdentitiesOnly=yes"] : [])];
if (!host) { console.error("Kullanım: node deploy/yayinla.mjs --host root@SUNUCU [--vebides-nginx-bagla] [--kaynak KLASÖR]"); process.exit(1); }

const run = (cmd, a, o = {}) => {
  const r = spawnSync(cmd, a, { stdio: "inherit", ...o });
  if (r.status !== 0) { console.error(`\n✖ Komut başarısız: ${cmd} ${a.join(" ")}`); process.exit(r.status || 1); }
  return r;
};
const ssh = (script) => run("ssh", [...SSH_OPTS, host, "bash -s"], { input: script, stdio: ["pipe", "inherit", "inherit"] });

// 1) depo temiz mi?
const dirty = spawnSync("git", ["status", "--porcelain", "--untracked-files=no"], { encoding: "utf8" }).stdout.trim();
if (dirty) { console.error("✖ İşlenmemiş değişiklikler var. Önce commit edin:\n" + dirty); process.exit(1); }

// 1b) --env-yukle: yereldeki deploy/.env (git dışı) sunucuya /opt/mezhep/.env olarak kopyalanır (izin 600)
if (flag("--env-yukle")) {
  const envFile = path.join(path.dirname(fileURLToPath(import.meta.url)), ".env");
  if (!fs.existsSync(envFile)) { console.error("✖ deploy/.env bulunamadı."); process.exit(1); }
  // Windows satır sonları (CRLF) sunucuda değerlerin sonuna \r ekleyip ayarları bozmasın
  const env = fs.readFileSync(envFile, "utf8").split("\r").join("");
  for (const k of ["ALAN_ADI", "MZ_ADMIN_EMAIL"]) {
    if (!new RegExp(`^${k}=\\S+`, "m").test(env)) { console.error(`✖ deploy/.env içinde ${k} boş.`); process.exit(1); }
  }
  console.log("→ Ayar dosyası gönderiliyor (içeriği ekrana yazılmaz)…");
  run("ssh", [...SSH_OPTS, host, "set -e; umask 077; mkdir -p /opt/mezhep; cat > /opt/mezhep/.env.yeni; mv /opt/mezhep/.env.yeni /opt/mezhep/.env; chmod 600 /opt/mezhep/.env"],
    { input: env, stdio: ["pipe", "inherit", "inherit"] });
}

// 2) kodu gönder
console.log("→ Kod gönderiliyor…");
await new Promise((resolve, reject) => {
  const arch = spawn("git", ["archive", "--format=tar", "HEAD"], { stdio: ["ignore", "pipe", "inherit"] });
  const up = spawn("ssh", [...SSH_OPTS, host, "set -e; rm -rf /opt/mezhep/src.new; mkdir -p /opt/mezhep/src.new; tar -x -C /opt/mezhep/src.new"], { stdio: ["pipe", "inherit", "inherit"] });
  arch.stdout.pipe(up.stdin);
  up.on("close", (c) => (c === 0 ? resolve() : reject(new Error("yükleme başarısız"))));
});

// 3) kur ve başlat
console.log("→ Kurulum…");
ssh(`
set -euo pipefail
cd /opt/mezhep
[ -f .env ] || { echo "✖ /opt/mezhep/.env yok. deploy/.env.example dosyasından oluşturun (chmod 600)."; exit 1; }
chmod 600 .env
set -a; . ./.env; set +a
rm -rf src.old; [ -d src ] && mv src src.old; mv src.new src
mkdir -p kaynaklar vebides-nginx/site letsencrypt yedekler
sed -e "s/__ALAN_ADI__/$ALAN_ADI/g" -e "s/__WEB_PORT__/\${WEB_PORT:-3400}/g" src/deploy/vebides-nginx/mezhep.conf.template > vebides-nginx/site/mezhep.conf
install -m 755 src/deploy/vebides-nginx/46-mezhep.sh vebides-nginx/46-mezhep.sh
docker compose -f src/deploy/docker-compose.yml --env-file .env up -d --build
for i in $(seq 1 45); do
  curl -fsS "http://127.0.0.1:\${WEB_PORT:-3400}/api/health" >/dev/null 2>&1 && { echo "✔ Uygulama ayakta"; break; }
  sleep 2; [ "$i" = 45 ] && { echo "✖ Uygulama açılmadı:"; docker compose -f src/deploy/docker-compose.yml logs --tail 60 app; exit 1; }
done
[ -f /opt/mezhep/ilk-yonetici-bildirildi ] || {
  if docker exec mezhep-app-1 test -f /data/gizli/ilk-yonetici.txt; then
    echo "ℹ İlk yönetici oluşturuldu. Geçici şifreyi görmek için sunucuda: docker exec mezhep-app-1 cat /data/gizli/ilk-yonetici.txt"
    touch /opt/mezhep/ilk-yonetici-bildirildi
  fi
}
cat > /etc/cron.d/mezhep <<'CRON'
# Mezhep.Org: sertifika yenileme ve gece yedeği
40 3 * * * root bash /opt/mezhep/src/deploy/sertifika.sh 2>&1 | logger -t mezhep-sertifika
15 3 * * * root bash /opt/mezhep/src/deploy/yedekle.sh 2>&1 | logger -t mezhep-yedek
CRON
`);

// 4) vebides nginx bağlantısı (ilk kurulumda bir kez; paylaşılan dosyayı yedekleyerek düzenler)
if (flag("--vebides-nginx-bagla")) {
  console.log("→ vebides nginx'ine bağlanıyor (nginx birkaç saniye yeniden başlar)…");
  ssh(`
set -euo pipefail
cd /opt/vebides
f=compose.override.yml
[ -f "$f" ] || printf 'services:\\n  nginx:\\n    volumes:\\n' > "$f"
if ! grep -q 46-mezhep.sh "$f"; then
  cp "$f" "$f.yedek-$(date +%Y%m%d%H%M%S)"
  cat >> "$f" <<'YML'
      # Mezhep.Org (kaynak: mezhep deposu deploy/vebides-nginx)
      - /opt/mezhep/vebides-nginx/46-mezhep.sh:/docker-entrypoint.d/46-mezhep.sh:ro
      - /opt/mezhep/vebides-nginx/site:/etc/nginx/mezhep:ro
      - /opt/mezhep/letsencrypt:/etc/nginx/mezhep-letsencrypt:ro
YML
  if ! docker compose config -q; then
    echo "✖ compose doğrulaması başarısız; yedek geri yükleniyor"; cp "$(ls -1t $f.yedek-* | head -n1)" "$f"; exit 1
  fi
fi
docker compose up -d --no-deps nginx
`);
}

// 5) sertifika + siteyi nginx'e ekle
console.log("→ Sertifika ve nginx…");
ssh(`
set -uo pipefail
if docker exec vebides-nginx-1 test -x /docker-entrypoint.d/46-mezhep.sh 2>/dev/null; then
  bash /opt/mezhep/src/deploy/sertifika.sh --yeniden-yukle || echo "UYARI: Sertifika alınamadı. DNS kaydı (CNAME → vebides.ihyadijital.com) yayıldıktan sonra komutu yeniden çalıştırın."
else
  echo "UYARI: vebides nginx'ine bağlantı yok. İlk kurulumda --vebides-nginx-bagla ile çalıştırın."
fi
`);

// 6) Akaid Asistanı kaynakları (isteğe bağlı)
const kaynak = opt("--kaynak");
if (kaynak) {
  if (!fs.existsSync(kaynak)) { console.error("✖ Kaynak klasörü bulunamadı: " + kaynak); process.exit(1); }
  console.log("→ Kaynaklar yükleniyor ve indeksleniyor…");
  const parent = path.dirname(path.resolve(kaynak)), base = path.basename(path.resolve(kaynak));
  await new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-c", "-C", parent, "--exclude=*.docx", "--exclude=*.pdf", "--exclude=*.lock", base], { stdio: ["ignore", "pipe", "inherit"] });
    const up = spawn("ssh", [...SSH_OPTS, host, `set -e; rm -rf /opt/mezhep/kaynaklar/*; tar -x -C /opt/mezhep/kaynaklar --strip-components=1`], { stdio: ["pipe", "inherit", "inherit"] });
    tar.stdout.pipe(up.stdin);
    up.on("close", (c) => (c === 0 ? resolve() : reject(new Error("kaynak yüklenemedi"))));
  });
  ssh(`docker exec mezhep-app-1 node --disable-warning=ExperimentalWarning server/src/ai/corpus.js /kaynaklar && docker restart mezhep-app-1 >/dev/null && echo "✔ Kaynak indeksi hazır"`);
}

console.log("\n✔ Yayın tamamlandı.");
