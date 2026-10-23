// İçerik değişince statik siteyi yeniden üretir: veritabanını JSON'a aktarır, scripts/build.py'yi çalıştırır.
// Aynı anda tek üretim çalışır; peş peşe gelen istekler birleştirilir (debounce).
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const cfg = require("./config");
const { exportAll } = require("./content");

const state = { running: false, queued: false, lastStart: null, lastEnd: null, ok: null, seconds: null, log: "", reason: "" };
let timer = null;

function schedule(reason = "", delay = 2500) {
  state.reason = reason || state.reason;
  clearTimeout(timer);
  timer = setTimeout(run, delay);
}

function run() {
  if (state.running) { state.queued = true; return Promise.resolve(); }
  state.running = true; state.queued = false; state.lastStart = new Date().toISOString();
  const started = Date.now();
  return new Promise((resolve) => {
    let out = "";
    try {
      exportAll(cfg.EXPORT_DIR);
      fs.mkdirSync(cfg.SITE_DIR, { recursive: true });
    } catch (e) {
      finish(false, "Dışa aktarma hatası: " + e.message); return resolve();
    }
    const child = spawn(cfg.PYTHON, ["-I", cfg.BUILD_SCRIPT], {
      env: {
        ...process.env, PYTHONIOENCODING: "utf-8",
        MZ_DATA: cfg.EXPORT_DIR, MZ_OUT: cfg.SITE_DIR, MZ_DYNAMIC: "1",
        MZ_MEDIA_DIR: cfg.MEDIA_DIR, MZ_UPLOAD_DIR: cfg.UPLOAD_DIR,
      },
      windowsHide: true,
    });
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", (e) => { finish(false, out + "\n" + e.message); resolve(); });
    child.on("close", (code) => { finish(code === 0, out); resolve(); });

    function finish(ok, log) {
      Object.assign(state, { running: false, ok, lastEnd: new Date().toISOString(), seconds: (Date.now() - started) / 1000, log: String(log).slice(-4000) });
      if (!ok) console.error("[site] üretim başarısız:\n" + state.log);
      else console.log(`[site] üretildi (${state.seconds.toFixed(1)} sn) ${state.reason}`);
      state.reason = "";
      if (state.queued) schedule("kuyruk", 500);
    }
  });
}

module.exports = { schedule, run, state };
