/* Mezhep.Org — istemci betiği */
(function () {
  "use strict";
  var root = document.body.getAttribute("data-root") || "";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var fold = function (s) {
    return String(s || "").replace(/İ/g, "i").replace(/I/g, "ı").toLowerCase().replace(/ı/g, "i")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
  };
  var AY = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  var AYLAR = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
  var trDate = function (d) { var m = /(\d+)\.(\d+)\.(\d{4})/.exec(d || ""); return m ? (+m[1]) + " " + AYLAR[m[2] - 1] + " " + m[3] : ""; };
  var svg = function (p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>"; };
  var ICON = {
    chev: svg('<path d="m9 18 6-6-6-6"/>'),
    news: svg('<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>'),
    a: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>'),
    e: svg('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>'),
    h: svg('<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Z"/><path d="M18 14h-8M15 18h-5"/>'),
    g: svg('<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>')
  };
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  /* ---------- tema ---------- */
  var themeBtn = $(".theme-toggle");
  if (themeBtn) themeBtn.addEventListener("click", function () {
    var cur = document.documentElement.dataset.theme ||
      (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    var next = cur === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    store.set("mz-theme", next);
  });

  /* ---------- menü, header, yukarı ---------- */
  var menuBtn = $(".menu-btn");
  if (menuBtn) menuBtn.addEventListener("click", function () {
    var open = document.body.classList.toggle("menu-open");
    menuBtn.setAttribute("aria-expanded", open);
  });
  var header = $(".site-header"), toTop = $(".to-top");
  var onScroll = function () {
    var y = window.scrollY;
    header && header.classList.toggle("scrolled", y > 8);
    toTop && toTop.classList.toggle("show", y > 800);
  };
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  toTop && toTop.addEventListener("click", function () { window.scrollTo({ top: 0, behavior: "smooth" }); });

  /* ---------- görünürlük animasyonu ---------- */
  var io = "IntersectionObserver" in window ? new IntersectionObserver(function (es) {
    es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } });
  }, { rootMargin: "0px 0px -8% 0px" }) : null;
  var reveal = function (els) { els.forEach(function (el) { io ? io.observe(el) : el.classList.add("in"); }); };
  reveal($$(".reveal"));

  /* ---------- sayaç ---------- */
  $$("[data-count]").forEach(function (el) {
    var n = +el.getAttribute("data-count"), t0 = null;
    if (!n || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.textContent = "0";
    var step = function (t) { t0 = t0 || t; var p = Math.min(1, (t - t0) / 1400); el.textContent = Math.round(n * (1 - Math.pow(1 - p, 3))); if (p < 1) requestAnimationFrame(step); };
    var ob = new IntersectionObserver(function (es) { if (es[0].isIntersecting) { requestAnimationFrame(step); ob.disconnect(); } });
    ob.observe(el);
  });

  /* ---------- komut paleti arama ---------- */
  var cmdk = $(".cmdk"), cInput = cmdk && $("input", cmdk), cList = cmdk && $(".cmdk-list", cmdk);
  var index = null, folded = null, sel = 0, results = [];
  var GROUPS = { a: "Akademisyenler", e: "Eserler", h: "Haberler ve Etkinlikler", g: "Galeri" };
  var loadIndex = function (cb) {
    if (index) return cb();
    var s = document.createElement("script");
    s.src = root + "assets/js/search-index.js";
    s.onload = function () { index = window.MZ_INDEX || []; folded = index.map(function (r) { return fold(r[1] + " " + r[2]); }); cb(); };
    document.head.appendChild(s);
  };
  var hl = function (txt, q) {
    if (!q) return esc(txt);
    var f = fold(txt), i = f.indexOf(q.split(" ")[0]);
    if (i < 0 || f.length !== txt.length) return esc(txt);
    var w = q.split(" ")[0].length;
    return esc(txt.slice(0, i)) + "<mark>" + esc(txt.slice(i, i + w)) + "</mark>" + esc(txt.slice(i + w));
  };
  var renderSearch = function () {
    var q = fold(cInput.value);
    if (!index) { cList.innerHTML = '<div class="cmdk-empty">Yükleniyor…</div>'; return; }
    var words = q.split(" ").filter(Boolean);
    results = [];
    var per = { a: 0, e: 0, h: 0, g: 0 };
    for (var i = 0; i < index.length; i++) {
      var r = index[i];
      if (words.every(function (w) { return folded[i].indexOf(w) > -1; })) {
        if (per[r[0]] < (words.length ? 8 : 4)) { per[r[0]]++; results.push(r); }
      }
    }
    results.sort(function (a, b) { return "aehg".indexOf(a[0]) - "aehg".indexOf(b[0]); });
    if (!results.length) { cList.innerHTML = '<div class="cmdk-empty">“' + esc(cInput.value) + '” için sonuç bulunamadı.</div>'; return; }
    var html = "", last = "";
    results.forEach(function (r, i) {
      if (r[0] !== last) { html += '<div class="cmdk-group">' + GROUPS[r[0]] + "</div>"; last = r[0]; }
      html += '<a class="cmdk-item" role="option" href="' + root + r[3] + '" data-i="' + i + '" aria-selected="' + (i === sel) + '"><span class="ic">' + ICON[r[0]] + '</span><span class="tx"><div class="t">' + hl(r[1], q) + '</div><div class="s">' + esc(r[2]) + "</div></span></a>";
    });
    cList.innerHTML = html;
  };
  var openSearch = function () {
    if (!cmdk) return;
    cmdk.classList.add("open"); document.body.style.overflow = "hidden";
    cInput.value = ""; sel = 0; setTimeout(function () { cInput.focus(); }, 30);
    loadIndex(renderSearch); renderSearch();
  };
  var closeSearch = function () { cmdk.classList.remove("open"); document.body.style.overflow = ""; };
  $$("[data-open-search]").forEach(function (b) { b.addEventListener("click", openSearch); });
  if (cmdk) {
    cmdk.addEventListener("click", function (e) { if (e.target === cmdk) closeSearch(); });
    cInput.addEventListener("input", function () { sel = 0; renderSearch(); });
    cList.addEventListener("mousemove", function (e) {
      var it = e.target.closest(".cmdk-item"); if (!it) return;
      var i = +it.dataset.i; if (i !== sel) { sel = i; $$(".cmdk-item", cList).forEach(function (x) { x.setAttribute("aria-selected", +x.dataset.i === sel); }); }
    });
  }
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); cmdk.classList.contains("open") ? closeSearch() : openSearch(); return; }
    if (e.key === "/" && !/input|textarea|select/i.test(document.activeElement.tagName)) { e.preventDefault(); openSearch(); return; }
    if (!cmdk || !cmdk.classList.contains("open")) return;
    if (e.key === "Escape") closeSearch();
    else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      sel = Math.max(0, Math.min(results.length - 1, sel + (e.key === "ArrowDown" ? 1 : -1)));
      $$(".cmdk-item", cList).forEach(function (x) { var on = +x.dataset.i === sel; x.setAttribute("aria-selected", on); if (on) x.scrollIntoView({ block: "nearest" }); });
    } else if (e.key === "Enter" && results[sel]) { location.href = root + results[sel][3]; }
  });

  /* ---------- liste sayfaları ---------- */
  var dataEl = $("#page-data"), list = $("[data-list]");
  if (dataEl && list) {
    var DATA = JSON.parse(dataEl.textContent);
    var kind = list.getAttribute("data-list");
    var PAGE = kind === "works" ? 40 : kind === "news" ? 24 : 48;
    var state = { q: "", tur: "", uni: "", decade: "", year: "", sort: "new", shown: PAGE };
    var qIn = $("[data-q]"), info = $("[data-info]"), more = $("[data-more]"), sortSel = $("[data-sort]");
    DATA.forEach(function (d) { d._f = fold([d.n, d.t, d.u, d.c, d.a, d.i, d.p, d.d, d.m, d.g].join(" ")); });
    var badge = { "Doktora": "b-brand", "Yüksek Lisans": "b-indigo", "Doçentlik": "b-gold", "Kitap": "b-gold", "Makale": "b-rose",
      "Yeni Doktor": "b-brand", "Profesörlük": "b-gold", "Atama": "b-indigo", "Vefat": "b-rose", "Etkinlik": "b-brand", "Yayın": "b-indigo" };
    var initials = function (n) { var p = n.split(/\s+/).filter(function (w) { return /^\p{L}/u.test(w); }); return p.length ? (p[0][0] + (p.length > 1 ? p[p.length - 1][0] : "")).toUpperCase() : "?"; };
    var tpl = {
      members: function (d) {
        var av = d.p ? '<img src="' + root + esc(d.p) + '" alt="" loading="lazy">' : esc(initials(d.n));
        return '<a class="card person" href="' + root + d.s + '"><span class="avatar">' + av + '</span><div class="info"><div class="rank">' + esc(d.t) +
          '</div><h3>' + esc(d.n) + '</h3><div class="uni">' + esc(d.u || "—") + (d.w ? " · " + d.w + " eser" : "") + "</div></div></a>";
      },
      works: function (d) {
        var bits = [esc(d.a)]; if (d.y) bits.push(d.y); if (d.i) bits.push(esc(d.i)); else if (d.p) bits.push(esc(d.p));
        return '<a class="feed-item" href="' + root + d.s + '"><div class="body"><span class="badge ' + (badge[d.k] || "") + '">' + esc(d.k) + "</span>" +
          (d.x ? ' <span class="badge">Özetli</span>' : "") + "<h3>" + esc(d.t) + "</h3><p>" + bits.join(" · ") + (d.d ? " · Dan. " + esc(d.d) : "") + '</p></div><span class="chev">' + ICON.chev + "</span></a>";
      },
      news: function (d) {
        var img = d.i ? '<img src="' + root + esc(d.i) + '" alt="" loading="lazy">' : ICON.news;
        return '<a class="card news-card" href="' + root + d.s + '"><div class="thumb">' + img + '</div><div class="meta"><span class="badge ' + (badge[d.g] || "") + '">' + esc(d.g) +
          "</span><span>" + trDate(d.d) + '</span></div><h3 class="clamp-2">' + esc(d.t) + '</h3><p class="clamp-3">' + esc(d.m) + "</p></a>";
      }
    };
    var dkey = function (d) { var m = /(\d+)\.(\d+)\.(\d{4})/.exec(d || ""); return m ? m[3] * 10000 + m[2] * 100 + +m[1] : 0; };
    var render = function () {
      var words = fold(state.q).split(" ").filter(Boolean);
      var out = DATA.filter(function (d) {
        if (state.tur && (d.f || d.k || d.g) !== state.tur) return false;
        if (state.uni && d.u !== state.uni) return false;
        if (state.decade && !(d.y >= +state.decade && d.y < +state.decade + 10)) return false;
        if (state.year && d.y !== +state.year) return false;
        return words.every(function (w) { return d._f.indexOf(w) > -1; });
      });
      if (kind === "works") {
        var s = state.sort;
        out.sort(function (a, b) {
          if (s === "az") return a.t.localeCompare(b.t, "tr");
          if (s === "pop") return b.h - a.h;
          var ay = a.y || (s === "new" ? 0 : 9999), by = b.y || (s === "new" ? 0 : 9999);
          return s === "new" ? (by - ay || b.id - a.id) : (ay - by || a.id - b.id);
        });
      } else if (kind === "news") {
        out.sort(function (a, b) { return dkey(b.d) - dkey(a.d) || b.id - a.id; });
      } else {
        out.sort(function (a, b) { return a.n.localeCompare(b.n, "tr"); });
      }
      var page = out.slice(0, state.shown);
      list.innerHTML = page.length ? page.map(tpl[kind]).join("") : '<div class="empty" style="grid-column:1/-1">Aramanızla eşleşen kayıt bulunamadı.</div>';
      info.textContent = out.length + " kayıt" + (out.length > page.length ? " · " + page.length + " gösteriliyor" : "");
      more.hidden = out.length <= page.length;
    };
    var setChip = function (v) {
      state.tur = v;
      $$('[data-filter="tur"]').forEach(function (c) { c.setAttribute("aria-pressed", c.getAttribute("data-value") === v); });
    };
    $$('[data-filter="tur"]').forEach(function (c) {
      c.addEventListener("click", function () { setChip(c.getAttribute("data-value")); state.shown = PAGE; render(); history.replaceState(null, "", state.tur ? "#tur=" + encodeURIComponent(state.tur) : location.pathname); });
    });
    $$("[data-filter-select]").forEach(function (s) {
      s.addEventListener("change", function () { state[s.getAttribute("data-filter-select")] = s.value; state.shown = PAGE; render(); });
    });
    if (sortSel) sortSel.addEventListener("change", function () { state.sort = sortSel.value; render(); });
    var t;
    qIn && qIn.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { state.q = qIn.value; state.shown = PAGE; render(); }, 120); });
    more && more.addEventListener("click", function () { state.shown += PAGE; render(); });
    var h = /tur=([^&]+)/.exec(location.hash);
    if (h) setChip(decodeURIComponent(h[1]));
    var qs = /[?&]q=([^&]+)/.exec(location.search);
    if (qs && qIn) { qIn.value = decodeURIComponent(qs[1].replace(/\+/g, " ")); state.q = qIn.value; }
    render();
  }

  /* ---------- özet sekmeleri ---------- */
  $$(".abstract-tabs").forEach(function (tabs) {
    $$("button", tabs).forEach(function (b) {
      b.addEventListener("click", function () {
        $$("button", tabs).forEach(function (x) { x.setAttribute("aria-selected", x === b); });
        $$("[data-pane]", tabs.parentNode).forEach(function (p) { p.hidden = p.getAttribute("data-pane") !== b.getAttribute("data-tab"); });
      });
    });
  });

  /* ---------- kaynak kopyala ---------- */
  $$("[data-copy]").forEach(function (b) {
    b.addEventListener("click", function () {
      var txt = $("[data-cite]").textContent, label = b.innerHTML;
      var done = function () { b.textContent = "Kopyalandı ✓"; setTimeout(function () { b.innerHTML = label; }, 1600); };
      if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, done);
      else { var ta = document.createElement("textarea"); ta.value = txt; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); } catch (e) {} ta.remove(); done(); }
    });
  });

  /* ---------- galeri ışık kutusu ---------- */
  var gal = $("[data-gallery]"), lb = $(".lightbox");
  if (gal && lb) {
    var figs = $$("figure", gal), cur = 0, lbImg = $("img", lb), lbCap = $(".cap", lb);
    var show = function (i) {
      cur = (i + figs.length) % figs.length;
      lbImg.src = figs[cur].getAttribute("data-full");
      lbImg.onerror = function () { lbImg.onerror = null; lbImg.src = $("img", figs[cur]).src; };
      lbCap.textContent = figs[cur].getAttribute("data-cap") + "  ·  " + (cur + 1) + " / " + figs.length;
      lb.classList.add("open"); lb.setAttribute("aria-hidden", "false"); document.body.style.overflow = "hidden";
    };
    var hide = function () { lb.classList.remove("open"); lb.setAttribute("aria-hidden", "true"); document.body.style.overflow = ""; };
    figs.forEach(function (f, i) { f.addEventListener("click", function () { show(i); }); });
    $(".lb-close", lb).addEventListener("click", hide);
    $(".lb-prev", lb).addEventListener("click", function () { show(cur - 1); });
    $(".lb-next", lb).addEventListener("click", function () { show(cur + 1); });
    lb.addEventListener("click", function (e) { if (e.target === lb) hide(); });
    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") hide(); else if (e.key === "ArrowLeft") show(cur - 1); else if (e.key === "ArrowRight") show(cur + 1);
    });
    var x0 = null;
    lb.addEventListener("touchstart", function (e) { x0 = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", function (e) { if (x0 == null) return; var dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) show(cur + (dx < 0 ? 1 : -1)); x0 = null; });
  }
})();
