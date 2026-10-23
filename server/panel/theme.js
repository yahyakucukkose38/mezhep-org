// Sayfa çizilmeden önce kayıtlı temayı uygular (CSP satır içi betiğe izin vermediği için ayrı dosya).
document.documentElement.className = "js";
try { var t = localStorage.getItem("mz-theme"); if (t) document.documentElement.dataset.theme = t; } catch (e) {}
