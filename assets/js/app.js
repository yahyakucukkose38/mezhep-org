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
  // Alt menüler (kategoriler): masaüstünde üzerine gelince ya da düğmeyle açılır; dar ekranda alt alta zaten görünür.
  var subBtns = $$(".nav-sub-btn");
  var closeSubs = function (except) {
    subBtns.forEach(function (b) { if (b !== except) { b.setAttribute("aria-expanded", "false"); b.parentNode.classList.remove("open"); } });
  };
  subBtns.forEach(function (b) {
    b.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = !b.parentNode.classList.contains("open");
      closeSubs(b);
      b.parentNode.classList.toggle("open", open);
      b.setAttribute("aria-expanded", open);
    });
  });
  if (subBtns.length) {
    document.addEventListener("click", function (e) { if (!e.target.closest(".nav-item")) closeSubs(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSubs(); });
  }
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
    var qIn = $("[data-q]"), info = $("[data-info]"), more = $("[data-more]"), sortSel = $("[data-sort]");
    // kategori sayfalarında başlangıç sıralaması kategorinin ayarıdır (seçili seçenek)
    var state = { q: "", tur: "", uni: "", decade: "", year: "", sort: sortSel ? sortSel.value : "new", shown: PAGE };
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
    // Yetkili kullanıcıya kartlarda "Düzenle" kısayolu (kural, oturum bilgisi gelince aşağıda atanır)
    var editKind = { members: "member", works: "work", news: "topic" }[kind], editRule = null;
    var EDIT_IC = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>';
    var card = function (d) {
      var html = tpl[kind](d), href = editRule && editRule(editKind, d.id);
      return href ? '<div class="card-wrap">' + html + '<a class="card-edit" href="' + href + '" aria-label="' + esc(d.t || d.n) + ' kaydını düzenle">' + EDIT_IC + "Düzenle</a></div>" : html;
    };
    window.mzSetEditRule = function (fn) { editRule = fn; render(); };
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
        var ns = state.sort;
        out.sort(function (a, b) {
          if (ns === "title") return a.t.localeCompare(b.t, "tr");
          if (ns === "old") return dkey(a.d) - dkey(b.d) || a.id - b.id;
          // özel sıra: "Sıra" verilmiş içerikler önce (küçükten büyüğe), sonra en yeni
          if (ns === "manual" && (a.o != null || b.o != null)) return a.o == null ? 1 : b.o == null ? -1 : a.o - b.o;
          return dkey(b.d) - dkey(a.d) || b.id - a.id;
        });
      } else {
        out.sort(function (a, b) { return a.n.localeCompare(b.n, "tr"); });
      }
      var page = out.slice(0, state.shown);
      var none = DATA.length ? "Aramanızla eşleşen kayıt bulunamadı." : (list.getAttribute("data-empty") || "Henüz kayıt yok.");
      list.innerHTML = page.length ? page.map(card).join("") : '<div class="empty" style="grid-column:1/-1">' + esc(none) + "</div>";
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
    if (sortSel) sortSel.addEventListener("change", function () { state.sort = sortSel.value; state.shown = PAGE; render(); });
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

  /* ---------- paylaş: bağlantılar JS olmadan da çalışır; burada kopyalama, mobil paylaşım menüsü ve sayım eklenir ---------- */
  var shareTrack = null; // sunucu sürümünde atanır (yalnızca içerik + platform sayılır; kişi bilgisi tutulmaz)
  var copyText = function (txt) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(txt);
    return new Promise(function (ok, no) {
      var ta = document.createElement("textarea"); ta.value = txt; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy") ? ok() : no(); } catch (e) { no(e); }
      ta.remove();
    });
  };
  var touch = window.matchMedia && matchMedia("(pointer: coarse)").matches;
  $$("[data-share-box]").forEach(function (box) {
    var url = box.getAttribute("data-url"), title = box.getAttribute("data-title"), text = box.getAttribute("data-text");
    var status = $("[data-share-status]", box), timer;
    var say = function (m) { status.textContent = m; clearTimeout(timer); timer = setTimeout(function () { status.textContent = ""; }, 3500); };
    var track = function (platform) { if (shareTrack) shareTrack(box.getAttribute("data-target"), platform); };
    // Mobilde sistemin paylaşım menüsü (Instagram, Mesajlar vb. dahil); diğer seçenekler tek düğme altında toplanır
    var nat = $("[data-share-native]", box);
    if (nat && navigator.share) {
      nat.hidden = false;
      nat.addEventListener("click", function () {
        track("sistem");
        navigator.share({ title: title, text: text, url: url }).catch(function () {});
      });
      if (touch) {
        box.classList.add("compact");
        var more = document.createElement("button");
        more.type = "button"; more.className = "share-btn is-more"; more.setAttribute("aria-expanded", "false");
        more.innerHTML = "<span>Diğer seçenekler</span>";
        more.addEventListener("click", function () { var o = box.classList.toggle("open"); more.setAttribute("aria-expanded", o); more.firstChild.textContent = o ? "Daha az" : "Diğer seçenekler"; });
        $(".share-list", box).appendChild(more);
      }
    }
    $$("a[data-share]", box).forEach(function (a) {
      a.addEventListener("click", function (e) {
        var k = a.getAttribute("data-share");
        track(k);
        // masaüstünde paylaşım sayfaları küçük pencerede açılır; mobilde uygulamaya yönlendirmesi için normal bağlantı
        if (!touch && /^(facebook|x|telegram|linkedin|pinterest)$/.test(k)) {
          var w = window.open(a.href, "mz-paylas", "width=640,height=620,menubar=no,toolbar=no");
          if (w) { e.preventDefault(); try { w.opener = null; } catch (er) {} }
        }
      });
    });
    var cp = $("[data-share-copy]", box);
    cp && cp.addEventListener("click", function () {
      track("kopyala");
      var label = $("span", cp);
      copyText(url).then(function () {
        say("Bağlantı kopyalandı.");
        label.textContent = "Kopyalandı ✓"; cp.classList.add("done");
        setTimeout(function () { label.textContent = "Bağlantıyı kopyala"; cp.classList.remove("done"); }, 2200);
      }, function () { say("Kopyalanamadı. Adres: " + url); });
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

  /* ---------- üyelik (yalnızca sunucu modunda: <meta name="mz-dynamic">) ---------- */
  if ($('meta[name="mz-dynamic"]')) {
    var apiCall = function (method, url, body) {
      return fetch("/api" + url, {
        method: method, credentials: "same-origin",
        headers: { "x-mz": "1", "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined
      }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw j; return j; }); });
    };
    var me = null, pending = null, siteSet = {};
    shareTrack = function (target, platform) {
      if (!target) return;
      try {
        fetch("/api/share", { method: "POST", keepalive: true, credentials: "same-origin",
          headers: { "x-mz": "1", "Content-Type": "application/json" }, body: JSON.stringify({ target: target, platform: platform }) }).catch(function () {});
      } catch (e) {}
    };
    // Yönetim paneline giriş: "kendi.*" dışında en az bir yetki
    var isStaff = function (u) { return !!u && (u.perms || []).some(function (p) { return p.indexOf("kendi.") !== 0; }); };
    var can = function (p) { return !!me && (me.perms || []).indexOf(p) > -1; };
    var acc = $("[data-account]");
    var renderAccount = function () {
      if (!acc) return;
      if (!me) {
        // Tek düğme: dar ekranlarda menü satırı taşmasın (kayıt bağlantısı giriş sayfasında var)
        acc.innerHTML = '<a class="btn btn-primary btn-sm acc-login" href="/panel/#/giris" aria-label="Giriş yap / Üye ol">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg><span>Giriş</span></a>';
        return;
      }
      var n = pending ? pending.submissions + pending.users + pending.comments : 0;
      acc.innerHTML = '<div class="acc-menu"><button class="acc-btn" type="button" aria-haspopup="true" aria-expanded="false"><span class="avatar">' +
        esc(me.name.split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase()) + "</span>" +
        (n ? '<span class="acc-dot" aria-label="' + n + ' bekleyen iş">' + n + "</span>" : "") +
        '</button><div class="acc-pop" role="menu"><div class="acc-head"><strong>' + esc(me.name) + "</strong><span>" + esc(me.email) + "</span></div>" +
        '<a role="menuitem" href="/panel/">Üye panelim</a>' +
        (isStaff(me) ? '<a role="menuitem" href="/panel/#/yonetim">Yönetim paneli' + (n ? ' <span class="badge b-rose">' + n + "</span>" : "") + "</a>" : "") +
        '<button role="menuitem" type="button" data-logout>Çıkış yap</button></div></div>';
      var btn = $(".acc-btn", acc), pop = $(".acc-pop", acc);
      btn.addEventListener("click", function (e) { e.stopPropagation(); var o = pop.classList.toggle("open"); btn.setAttribute("aria-expanded", o); });
      document.addEventListener("click", function () { pop.classList.remove("open"); btn.setAttribute("aria-expanded", "false"); });
      $("[data-logout]", acc).addEventListener("click", function () { apiCall("POST", "/auth/logout").then(function () { location.reload(); }); });
    };

    var fmtTime = function (s) { var d = new Date(String(s).replace(" ", "T") + "Z"); return isNaN(d) ? "" : d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }); };
    var paras = function (t) { return esc(t).split(/\n{2,}/).map(function (p) { return "<p>" + p.replace(/\n/g, "<br>") + "</p>"; }).join(""); };
    var loadComments = function (box) {
      var target = box.getAttribute("data-comments"), list = $("[data-comment-list]", box), form = $("[data-comment-form]", box);
      apiCall("GET", "/comments?target=" + encodeURIComponent(target)).then(function (j) {
        var rows = j.items.map(function (c) {
          return '<div class="comment"><div class="post-head"><span class="avatar">' + esc(c.name.split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join("")) +
            "</span><div><strong>" + esc((c.title ? c.title + " " : "") + c.name) + "</strong><br>" + fmtTime(c.created_at) + '</div></div><div class="prose">' + paras(c.body) + "</div></div>";
        }).concat(j.pending.map(function (c) {
          return '<div class="comment is-pending"><div class="post-head"><span class="badge b-gold">Onay bekliyor</span> Yorumunuz yönetici onayından sonra herkese görünecek.</div><div class="prose">' + paras(c.body) + "</div></div>";
        }));
        list.innerHTML = rows.length ? rows.join("") : '<p class="muted">Henüz yorum yok. İlk yorumu siz yazın.</p>';
      }).catch(function () { list.innerHTML = '<p class="muted">Yorumlar yüklenemedi.</p>'; });
      if (siteSet.comments_enabled === false) {
        form.innerHTML = '<p class="muted">Yorumlar şu anda kapalı.</p>';
      } else if (!me) {
        form.innerHTML = '<p class="muted">Yorum yazmak için <a href="/panel/#/giris">giriş yapın</a> ya da <a href="/panel/#/kayit">üye olun</a>.</p>';
      } else if (me.status !== "active") {
        form.innerHTML = '<p class="muted">Üyeliğiniz onaylandıktan sonra yorum yazabilirsiniz.</p>';
      } else {
        form.innerHTML = '<form class="comment-form"><label class="sr-only" for="yorum-' + esc(target) + '">Yorumunuz</label><textarea id="yorum-' + esc(target) +
          '" rows="4" maxlength="3000" required placeholder="Yorumunuzu yazın…"></textarea><div class="comment-actions"><span class="muted">' + (siteSet.comments_require_approval === false ? "" : "Yorumlar yönetici onayından sonra yayınlanır.") + '</span><button class="btn btn-primary btn-sm" type="submit">Gönder</button></div></form>';
        var f = $("form", form);
        f.addEventListener("submit", function (e) {
          e.preventDefault();
          var ta = $("textarea", f), b = $("button", f);
          b.disabled = true;
          apiCall("POST", "/comments", { target: target, body: ta.value }).then(function () { ta.value = ""; loadComments(box); })
            .catch(function (err) { alert((err && err.error) || "Yorum gönderilemedi."); })
            .then(function () { b.disabled = false; });
        });
      }
    };

    /* ---- Asistanlar: Akaid ve Hanefî Fıkhı (sağ alt) ---- */
    var AI_DEFAULTS = {
      akaid: { welcome: "Selâmün aleyküm! Ehl-i Sünnet (Mâtürîdî ve Eş'arî) itikadına dair sorularınızı arşivdeki kaynaklara dayanarak yanıtlıyorum.",
        note: "Yanıtlar yapay zekâ ile derlenir ve hata içerebilir; önemli konularda kaynaklara ve hocalarımıza başvurun. Fetva verilmez.",
        suggestions: ["Hudûs delili nedir?", "Mâtürîdî ile Eş'arî arasındaki farklar nelerdir?", "Kesb nazariyesi nedir?", "Allah'ın varlığının delilleri nelerdir?"], tab: "Akaid" },
      hanefi: { welcome: "Hoş geldiniz. Sorularınızı hangi üslupla cevaplamamı istersiniz?",
        note: "Yanıtlar yapay zekâ ile Arapça klasik metinlerden derlenir ve hata içerebilir; gösterilen cilt ve sayfadan kontrol edin. Bu bir fetva değildir; kişisel durumunuz için müftülüğe danışın.",
        suggestions: ["Mest üzerine mesh süresi ne kadardır?", "Abdesti bozan şeyler nelerdir?"], tab: "Hanefî Fıkhı" },
    };
    // Hanefî asistanı: sohbetin başında seçilen üslup (talimat: önce üslup sorulur, tercih sohbet boyunca korunur)
    var STYLES = { fetva: ["Fetva üslubu", "Kısa, sade ve doğrudan uygulanabilir cevap."],
      akademik: ["Akademik üslup", "Istılahlar, mezhep içi görüş ayrılıkları ve ayrıntılı kaynak değerlendirmesi."] };
    var style = {
      get: function () { try { var v = sessionStorage.getItem("mz-hanefi-uslup"); return STYLES[v] ? v : ""; } catch (e) { return ""; } },
      set: function (v) { try { v ? sessionStorage.setItem("mz-hanefi-uslup", v) : sessionStorage.removeItem("mz-hanefi-uslup"); } catch (e) {} }
    };
    var aiStore = function (key) {
      var k = key === "akaid" ? "mz-asistan" : "mz-asistan-" + key;
      return { get: function () { try { return JSON.parse(sessionStorage.getItem(k) || "[]"); } catch (e) { return []; } },
        set: function (v) { try { sessionStorage.setItem(k, JSON.stringify(v.slice(-20))); } catch (e) {} } };
    };
    // Basit Markdown: ara başlık (### Kısa cevap…), madde listesi, paragraf, kalın yazı ve [n] kaynak numaraları
    var md = function (t) {
      var html = "", para = [], items = [];
      var flushP = function () { if (para.length) html += "<p>" + para.join("<br>") + "</p>"; para = []; };
      var flushL = function () { if (items.length) html += "<ul>" + items.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>"; items = []; };
      esc(t).split("\n").forEach(function (l) {
        var h = /^\s*#{1,4}\s+(.+?)\s*#*\s*$/.exec(l), it = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(l);
        if (!l.trim()) { flushP(); flushL(); }
        else if (h) { flushP(); flushL(); html += "<h4>" + h[1] + "</h4>"; }
        else if (it) { flushP(); items.push(it[1]); }
        else { flushL(); para.push(l); }
      });
      flushP(); flushL();
      return html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\[(\d{1,2})\]/g, '<sup class="cite">$1</sup>');
    };
    var setupAssistant = function (st) {
      var list = (st.assistants && st.assistants.length) ? st.assistants
        : st.enabled ? [{ key: "akaid", name: "Akaid Asistanı", subtitle: "Ehl-i Sünnet itikad kaynaklarından", welcome: st.welcome, suggestions: st.suggestions }] : [];
      if (!list.length) return;
      document.body.classList.add("has-assistant");
      var byKey = {}, chats = {};
      list.forEach(function (a) { byKey[a.key] = a; chats[a.key] = { store: aiStore(a.key), history: aiStore(a.key).get(), sending: false }; });
      var cur = list[0].key;
      try { var saved = sessionStorage.getItem("mz-asistan-secim"); if (byKey[saved]) cur = saved; } catch (e) {}

      var fab = document.createElement("button");
      fab.className = "ai-fab"; fab.type = "button"; fab.setAttribute("aria-haspopup", "dialog"); fab.setAttribute("aria-expanded", "false");
      fab.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 13h5"/></svg><span>' + esc(list.length > 1 ? "Asistanlar" : list[0].name) + "</span>";
      var box = document.createElement("section");
      box.className = "ai-box"; box.setAttribute("role", "dialog"); box.setAttribute("aria-label", list.length > 1 ? "Mezhep.Org asistanları" : list[0].name); box.hidden = true;
      box.innerHTML = '<header class="ai-head"><img src="/assets/img/logo.jpg" alt="" width="44" height="30"><div><strong data-ai-name></strong><span data-ai-sub></span></div>' +
        '<button type="button" class="ai-icon" data-new title="Yeni sohbet" aria-label="Yeni sohbet"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg></button>' +
        '<button type="button" class="ai-icon" data-close title="Kapat" aria-label="Kapat"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></header>' +
        (list.length > 1 ? '<div class="ai-tabs" role="tablist" aria-label="Asistan seçin">' + list.map(function (a) {
          return '<button type="button" role="tab" data-ai-tab="' + esc(a.key) + '">' + esc((AI_DEFAULTS[a.key] || {}).tab || a.name) + "</button>";
        }).join("") + "</div>" : "") +
        '<div class="ai-log" aria-live="polite"></div><div class="ai-foot"></div>';
      document.body.appendChild(box); document.body.appendChild(fab);
      var log = $(".ai-log", box), foot = $(".ai-foot", box);

      var bubble = function (m) {
        if (m.role === "user") return '<div class="ai-msg me"><div class="ai-bubble">' + esc(m.content).replace(/\n/g, "<br>") + "</div></div>";
        var src = (m.sources || []).length ? '<details class="ai-src"><summary>Kaynaklar (' + m.sources.length + ")</summary><ol>" +
          m.sources.map(function (s) {
            // Arapça bab başlığı (Hanefî) kendi satırında sağdan sola; Türkçe başlıklar (Akaid) eskisi gibi satır içinde
            var rtl = /[؀-ۿ]/.test(s.heading || "");
            return "<li value=\"" + s.n + '">' + esc(s.title) + (s.cite ? ' <span class="ai-cite">' + esc(s.cite) + "</span>" : "") +
              (s.heading ? (rtl ? '<span class="ai-h" dir="rtl" lang="ar">' + esc(s.heading) + "</span>" : " <span>— " + esc(s.heading) + "</span>") : "") + "</li>";
          }).join("") + "</ol></details>" : "";
        return '<div class="ai-msg' + (m.error ? " err" : "") + '"><div class="ai-bubble prose">' + (m.error ? esc(m.content) : md(m.content)) + src + "</div></div>";
      };
      var draw = function () {
        var a = byKey[cur], d = AI_DEFAULTS[cur] || AI_DEFAULTS.akaid, c = chats[cur];
        $("[data-ai-name]", box).textContent = a.name;
        $("[data-ai-sub]", box).textContent = a.subtitle || "";
        $$("[data-ai-tab]", box).forEach(function (t) { t.setAttribute("aria-selected", t.getAttribute("data-ai-tab") === cur); });
        var st2 = cur === "hanefi" ? style.get() : "", needStyle = cur === "hanefi" && !st2;
        var styleUi = cur !== "hanefi" ? "" : needStyle
          ? '<div class="ai-styles" role="group" aria-label="Cevap üslubu">' + Object.keys(STYLES).map(function (k, i) {
              return '<button type="button" data-style="' + k + '"><strong>' + (i + 1) + ". " + STYLES[k][0] + "</strong><span>" + STYLES[k][1] + "</span></button>";
            }).join("") + "</div>"
          : '<p class="ai-style">Üslup: <strong>' + STYLES[st2][0] + '</strong> · <button type="button" class="linklike" data-style="' + (st2 === "fetva" ? "akademik" : "fetva") + '">' +
            (st2 === "fetva" ? "Akademik üsluba geç" : "Fetva üslubuna geç") + "</button></p>";
        var intro = '<div class="ai-msg"><div class="ai-bubble prose"><p>' + esc(a.welcome || d.welcome) + "</p>" + styleUi + '<p class="ai-note">' + esc(d.note) + "</p></div></div>";
        var sugg = (a.suggestions && a.suggestions.length) ? a.suggestions : d.suggestions;
        var chips = !c.history.length && !needStyle && me && me.status === "active" ? '<div class="ai-chips">' + sugg.map(function (q) { return '<button type="button" class="chip" data-q="' + esc(q) + '">' + esc(q) + "</button>"; }).join("") + "</div>" : "";
        log.innerHTML = intro + chips + c.history.map(bubble).join("") + (c.sending ? '<div class="ai-msg"><div class="ai-bubble ai-typing"><span></span><span></span><span></span></div></div>' : "");
        $$("[data-q]", log).forEach(function (b) { b.addEventListener("click", function () { send(b.getAttribute("data-q")); }); });
        $$("[data-style]", log).forEach(function (b) {
          b.addEventListener("click", function () { style.set(b.getAttribute("data-style")); draw(); var t3 = $("textarea", foot); if (t3) t3.focus(); });
        });
        log.scrollTop = log.scrollHeight;
        var ta = $("textarea", foot);
        if (ta) { ta.disabled = c.sending; ta.placeholder = cur === "hanefi" ? "Fıkhî sorunuzu yazın…" : "Sorunuzu yazın…"; }
      };
      var meta = function (remaining) { var m = $("[data-meta]", foot); if (m && remaining) m.textContent = "Bugün kalan: " + remaining.requests + " soru"; };
      var drawFoot = function (remaining) {
        if (!me) { foot.innerHTML = '<p class="ai-gate">Asistanı kullanmak için <a href="/panel/#/giris">giriş yapın</a> ya da <a href="/panel/#/kayit">üye olun</a>.</p>'; return; }
        if (me.status !== "active") { foot.innerHTML = '<p class="ai-gate">Üyeliğiniz onaylandıktan sonra asistanı kullanabilirsiniz.</p>'; return; }
        foot.innerHTML = '<form class="ai-form"><label class="sr-only" for="ai-in">Sorunuz</label><textarea id="ai-in" rows="1" maxlength="' + st.maxInputChars + '" placeholder="Sorunuzu yazın…"></textarea>' +
          '<button class="ai-send" type="submit" aria-label="Gönder"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4z"/><path d="M22 2 11 13"/></svg></button></form>' +
          '<div class="ai-meta" data-meta></div>';
        meta(remaining);
        var f = $("form", foot), ta = $("textarea", f);
        ta.addEventListener("input", function () { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 140) + "px"; });
        ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); f.requestSubmit(); } });
        f.addEventListener("submit", function (e) { e.preventDefault(); send(ta.value); });
      };
      var send = function (text) {
        text = String(text || "").trim();
        var key = cur, c = chats[key];
        if (!text || c.sending) return;
        var past = c.history.filter(function (m) { return !m.error; }).map(function (m) { return { role: m.role, content: m.content }; }).slice(-12);
        c.history.push({ role: "user", content: text }); c.sending = true; draw();
        var ta = $("textarea", foot); if (ta) { ta.value = ""; ta.style.height = "auto"; }
        var payload = { assistant: key, message: text, history: past };
        if (key === "hanefi" && style.get()) payload.style = style.get();
        apiCall("POST", "/ai/chat", payload).then(function (j) {
          c.history.push({ role: "assistant", content: j.answer, sources: j.sources });
          meta(j.remaining);
        }).catch(function (err) {
          c.history.push({ role: "assistant", error: true, content: (err && err.error) || "Asistana ulaşılamadı. Lütfen tekrar deneyin." });
        }).then(function () {
          c.sending = false; c.store.set(c.history);
          if (key === cur) { draw(); var t2 = $("textarea", foot); if (t2 && !box.hidden) t2.focus(); }
        });
      };
      var open = function (on) {
        box.hidden = !on; fab.setAttribute("aria-expanded", on); document.body.classList.toggle("ai-open", on);
        if (on) { draw(); var t = $("textarea", foot); (t || $("[data-close]", box)).focus(); } else fab.focus();
      };
      $$("[data-ai-tab]", box).forEach(function (t) {
        t.addEventListener("click", function () {
          cur = t.getAttribute("data-ai-tab");
          try { sessionStorage.setItem("mz-asistan-secim", cur); } catch (e) {}
          draw(); var ta = $("textarea", foot); if (ta && !ta.disabled) ta.focus();
        });
      });
      fab.addEventListener("click", function () { open(box.hidden); });
      $("[data-close]", box).addEventListener("click", function () { open(false); });
      // Yeni sohbet: geçmiş silinir; Hanefî asistanında üslup yeniden sorulur
      $("[data-new]", box).addEventListener("click", function () { var c = chats[cur]; if (c.sending) return; c.history = []; c.store.set(c.history); if (cur === "hanefi") style.set(""); draw(); });
      box.addEventListener("keydown", function (e) { if (e.key === "Escape") open(false); });
      drawFoot(st.remaining);
    };

    apiCall("GET", "/me").then(function (j) { me = j.user; pending = j.pending || null; })
      .catch(function () {})
      .then(function () {
        renderAccount();
        apiCall("GET", "/site-settings").then(function (v) { siteSet = v || {}; }).catch(function () {})
          .then(function () { $$("[data-comments]").forEach(loadComments); });
        // "Bu profil benim": profili zaten bir hesaba bağlı kişiye gösterilmez
        $$("[data-claim]").forEach(function (b) { if (me && me.member_id != null) b.hidden = true; });
        // "Düzenle": o içerik türünü düzenleme yetkisi olan yöneticiye/editöre ya da kaydın sahibi olan akademisyene gösterilir.
        // Yalnızca görünürlük içindir; kaydetme yetkisi sunucuda her istekte ayrıca denetlenir.
        var owns = $$("[data-own]");
        if (me && me.status === "active") {
          var editHref = function (keys) {
            return function (kind, id) {
              if (can("icerik." + kind)) return "/panel/#/yonetim/icerik/" + kind + "/" + id;
              if (keys.indexOf(kind + ":" + id) > -1) return "/panel/#/duzenle/" + kind + "/" + id;
              return "";
            };
          };
          var showFor = function (keys) {
            var rule = editHref(keys);
            owns.forEach(function (b) {
              var t = b.getAttribute("data-own").split(":"), href = rule(t[0], +t[1]);
              if (href) { b.href = href; b.hidden = false; }
            });
            if (window.mzSetEditRule && (["icerik.member", "icerik.work", "icerik.topic"].some(can) || keys.length)) window.mzSetEditRule(rule);
          };
          if (can("kendi.profil") || can("kendi.eser")) {
            apiCall("GET", "/my/items").then(function (j) { showFor(j.items.map(function (i) { return i.kind + ":" + i.id; })); }).catch(function () { showFor([]); });
          } else showFor([]);
        }
        apiCall("GET", "/ai/status").then(setupAssistant).catch(function () {});
      });
  }

  /* ---------- Etkinlikler: alt kategori menüsü (panelden yönetilir); adres #tur=… ile paylaşılabilir ---------- */
  var evChips = $$("[data-ev-filter]");
  if (evChips.length) {
    var evItems = $$("[data-ev-list] .tl-item"), evInfo = $("[data-ev-info]"), evFor = $$("[data-ev-for]"), evLink = $("[data-ev-link]");
    var evTitle = $("[data-ev-title]"), evTitle0 = evTitle ? evTitle.textContent : "";
    // #tur= değeri kısa ad (Koordinasyon), kategori anahtarı (koordinasyon) ya da adres (sempozyumlar) olabilir
    var evFind = function (v) {
      v = fold(v);
      return v ? evChips.filter(function (c) {
        return ["data-ev-filter", "data-ev-key", "data-ev-slug"].some(function (a) { return fold(c.getAttribute(a)) === v; });
      })[0] || null : null;
    };
    var evShow = function (tur, push) {
      var chip = evFind(tur), key = chip ? chip.getAttribute("data-ev-key") : "";
      evChips.forEach(function (c) { c.setAttribute("aria-pressed", c === chip || (!chip && !c.getAttribute("data-ev-filter"))); });
      var n = 0;
      evItems.forEach(function (it) { var on = !key || it.getAttribute("data-cat") === key; it.hidden = !on; if (on) { n++; it.classList.add("in"); } });
      // boş kalan yıl başlıklarını gizle
      $$("[data-ev-list] [data-year]").forEach(function (y) {
        var el = y.nextElementSibling, any = false;
        while (el && !el.hasAttribute("data-year")) { if (!el.hidden) any = true; el = el.nextElementSibling; }
        y.hidden = !any;
      });
      evFor.forEach(function (sec) { sec.hidden = !!key && sec.getAttribute("data-ev-for") !== key; });
      if (evTitle) evTitle.textContent = chip ? chip.getAttribute("data-ev-heading") : evTitle0;
      if (evLink) { evLink.hidden = !chip; if (chip) evLink.href = root + chip.getAttribute("data-ev-url"); }
      if (evInfo) evInfo.textContent = n + " kayıt";
      if (push) history.replaceState(null, "", chip ? "#tur=" + encodeURIComponent(chip.getAttribute("data-ev-filter")) : location.pathname);
    };
    evChips.forEach(function (c) { c.addEventListener("click", function () { evShow(c.getAttribute("data-ev-filter"), true); }); });
    var fromHash = function () {
      var m = /tur=([^&]+)/.exec(location.hash);
      evShow(m ? decodeURIComponent(m[1]) : location.hash === "#koordinasyon" ? "koordinasyon" : "", false);
    };
    window.addEventListener("hashchange", fromHash);
    fromHash();
  }

  /* ---------- Galeri: Fotoğraflar / Videolar sekmeleri (#fotograflar, #videolar) ---------- */
  var galTabs = $$("[data-gal-tab]");
  if (galTabs.length) {
    var galShow = function (k, push) {
      if (!galTabs.some(function (t) { return t.getAttribute("data-gal-tab") === k; })) k = "fotograflar";
      galTabs.forEach(function (t) { t.setAttribute("aria-selected", t.getAttribute("data-gal-tab") === k); });
      $$("[data-gal-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-gal-panel") !== k; });
      if (push) history.replaceState(null, "", k === "fotograflar" ? location.pathname : "#" + k);
    };
    galTabs.forEach(function (t) { t.addEventListener("click", function () { galShow(t.getAttribute("data-gal-tab"), true); }); });
    galShow(location.hash.slice(1), false);
    window.addEventListener("hashchange", function () { galShow(location.hash.slice(1), false); });
  }

  /* ---------- video modülü: sekmeler ve sayfa içi oynatıcı ---------- */
  var vidTabs = $$("[data-vid-tab]");
  vidTabs.forEach(function (t) {
    t.addEventListener("click", function () {
      vidTabs.forEach(function (x) { x.setAttribute("aria-selected", x === t); });
      $$("[data-vid-panel]").forEach(function (p) { p.hidden = p.getAttribute("data-vid-panel") !== t.getAttribute("data-vid-tab"); });
    });
  });
  var vidCards = $$("[data-yt]");
  if (vidCards.length) {
    var vm = document.createElement("div");
    vm.className = "vid-modal"; vm.setAttribute("role", "dialog"); vm.setAttribute("aria-modal", "true"); vm.setAttribute("aria-label", "Video oynatıcı");
    vm.innerHTML = '<div class="cap"></div><button class="close" type="button" aria-label="Kapat">' + svg('<path d="M18 6 6 18M6 6l12 12"/>') + '</button><div class="frame"></div>';
    document.body.appendChild(vm);
    var lastCard = null;
    var closeVid = function () { vm.classList.remove("open"); $(".frame", vm).innerHTML = ""; document.body.style.overflow = ""; if (lastCard) lastCard.focus(); };
    vidCards.forEach(function (c) {
      c.addEventListener("click", function (e) {
        var id = c.getAttribute("data-yt");
        if (!/^[\w-]{11}$/.test(id)) return;
        e.preventDefault(); lastCard = c;
        $(".cap", vm).textContent = c.getAttribute("data-title") || "";
        $(".frame", vm).innerHTML = '<iframe src="https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0" title="' + esc(c.getAttribute("data-title") || "Video") +
          '" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>';
        vm.classList.add("open"); document.body.style.overflow = "hidden"; $(".close", vm).focus();
      });
    });
    $(".close", vm).addEventListener("click", closeVid);
    vm.addEventListener("click", function (e) { if (e.target === vm) closeVid(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && vm.classList.contains("open")) closeVid(); });
  }

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
