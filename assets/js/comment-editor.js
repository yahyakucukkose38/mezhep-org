/* Mezhep.Org — yorum editörü (zengin metin).
   app.js yalnızca yorum yazabilen üyeler için bu dosyayı yükler; window.MZCommentEditor(kap, ayarlar) bir editör kurar.
   Tarayıcının kendi düzenleme altyapısı (contenteditable) kullanılır; ek kütüphane yoktur. Çıkan HTML sunucuda
   izin listesiyle yeniden temizlenir (server/src/content.js cleanCommentHtml); buradaki kurallar yalnızca kullanım kolaylığı içindir. */
(function () {
  "use strict";
  var $ = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var MAC = /Mac|iPhone|iPad/.test(navigator.platform || "");
  var KEY = MAC ? "⌘" : "Ctrl";

  /* ---- video: sunucudaki content.js parseVideo ile aynı kurallar (YouTube çerezsiz oynatıcı, Vimeo) ---- */
  function parseVideo(url) {
    var u = String(url || "").trim().replace(/&amp;/g, "&");
    var m = u.match(/^(?:https?:)?\/\/(?:www\.|m\.)?(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([\w-]{11})(?![\w-])/i);
    if (m) return { provider: "youtube", id: m[1], short: /\/shorts\//i.test(u) };
    m = u.match(/^(?:https?:)?\/\/(?:www\.|player\.)?vimeo\.com\/(?:video\/)?(\d{6,12})(?:\/([0-9a-f]{6,20}))?(?:[/?#]|$)/i);
    if (m) return { provider: "vimeo", id: m[1], hash: m[2] || (u.match(/[?&]h=([0-9a-f]{6,20})/i) || [])[1] || "" };
    return null;
  }
  var srcOfEmbed = function (code) { var m = String(code).match(/<iframe\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i); return m ? m[1] : ""; };
  var videoOf = function (raw) { raw = String(raw || "").trim(); return parseVideo(/<iframe/i.test(raw) ? srcOfEmbed(raw) : raw); };
  function videoHtml(v) {
    var src = v.provider === "youtube" ? "https://www.youtube-nocookie.com/embed/" + v.id + "?rel=0" : "https://player.vimeo.com/video/" + v.id + (v.hash ? "?h=" + v.hash : "");
    return '<figure class="media-video' + (v.short ? " short" : "") + '" contenteditable="false"><iframe src="' + src + '" title="' + (v.provider === "youtube" ? "YouTube" : "Vimeo") +
      ' videosu" loading="lazy" allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></figure>';
  }
  var VIDEO_HELP = "YouTube (youtube.com, youtu.be, Shorts) ya da Vimeo bağlantısı; YouTube'daki Paylaş → Yerleştir kodu da olur.";

  /* ---- görsel: tür/boyut denetimi, gerekirse küçültme, ilerlemeli yükleme ---- */
  var IMG_TYPES = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
  var MAX_UPLOAD = 5 * 1024 * 1024, MAX_PICK = 25 * 1024 * 1024, MAX_DIM = 1920;
  // Büyük ya da çok yüksek çözünürlüklü görseller tarayıcıda küçültülür (WebP, desteklenmezse JPEG).
  // Görsel data: adresiyle okunur (sitenin güvenlik politikası blob: adreslerine izin vermez).
  function prepareImage(file) {
    return new Promise(function (resolve) {
      var fr = new FileReader();
      fr.onerror = function () { resolve(file); };
      fr.onload = function () {
        var img = new Image();
        img.onerror = function () { resolve(file); };
        img.onload = function () {
          var w = img.naturalWidth, h = img.naturalHeight, k = Math.min(1, MAX_DIM / Math.max(w, h));
          if (k === 1 && file.size <= 1.5 * 1024 * 1024) return resolve(file);
          var c = document.createElement("canvas");
          c.width = Math.round(w * k); c.height = Math.round(h * k);
          var g = c.getContext("2d");
          g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); // JPEG'e düşülürse saydam alanlar siyah olmasın
          g.drawImage(img, 0, 0, c.width, c.height);
          var done = function (b) { resolve(b && b.size < file.size ? b : file); };
          if (!c.toBlob) return resolve(file);
          c.toBlob(function (b) {
            if (b && b.type === "image/webp") return done(b);
            c.toBlob(done, "image/jpeg", 0.85);
          }, "image/webp", 0.85);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function upload(blob, onProgress) {
    return new Promise(function (resolve, reject) {
      var fd = new FormData();
      fd.append("file", blob, "gorsel." + (IMG_TYPES[blob.type] || "jpg"));
      var x = new XMLHttpRequest();
      x.open("POST", "/api/uploads");
      x.setRequestHeader("x-mz", "1");
      x.upload.onprogress = function (e) { if (e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
      x.onload = function () {
        var j = {}; try { j = JSON.parse(x.responseText); } catch (e) {}
        if (x.status === 200 && j.path) resolve("/" + j.path); else reject(j.error || "Görsel yüklenemedi.");
      };
      x.onerror = function () { reject("Bağlantı sorunu nedeniyle görsel yüklenemedi."); };
      x.send(fd);
    });
  }

  /* ---- simgeler ---- */
  var I = function (p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>"; };
  var ICONS = {
    ul: I('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none"/>'),
    ol: I('<path d="M10 6h10M10 12h10M10 18h10"/><path d="M4 4.5h1.5V9M4 9h3" stroke-width="1.6"/><path d="M4 14.3c.4-.6 2.6-.8 2.6.6 0 1-2.6 2-2.6 3.6h2.8" stroke-width="1.6"/>'),
    quote: I('<path d="M4 18c2.5-1 4-3 4-6.5V7H4v5h4M14 18c2.5-1 4-3 4-6.5V7h-4v5h4"/>'),
    link: I('<path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/>'),
    image: I('<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="1.8"/><path d="m21 16-5-5-9 9"/>'),
    video: I('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="m10 9.2 5 2.8-5 2.8z" fill="currentColor"/>'),
    undo: I('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
    redo: I('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
    clear: I('<path d="M5 6V4.5h13V6M11.5 4.5 8.5 19M6.5 19h4.5"/><path d="m15 13 5 5M20 13l-5 5"/>'),
    eye: I('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'),
  };
  // [komut, simge ya da yazı, açıklama, kısayol]
  var TOOLS = [
    [["bold", "<b>K</b>", "Kalın", KEY + "+B"], ["italic", "<i>İ</i>", "İtalik", KEY + "+I"]],
    [["h2", "<b>B<sub>1</sub></b>", "Büyük başlık", KEY + "+Alt+2"], ["h3", "<b>B<sub>2</sub></b>", "Küçük başlık", KEY + "+Alt+3"]],
    [["ul", ICONS.ul, "Madde işaretli liste", KEY + "+Shift+8"], ["ol", ICONS.ol, "Numaralı liste", KEY + "+Shift+7"], ["quote", ICONS.quote, "Alıntı"]],
    [["link", ICONS.link, "Bağlantı ekle", KEY + "+K"], ["image", ICONS.image + "<span>Görsel</span>", "Görsel ekle (bilgisayar ya da telefondan)"], ["video", ICONS.video + "<span>Video</span>", "Video ekle (YouTube / Vimeo)"]],
    [["undo", ICONS.undo, "Geri al", KEY + "+Z"], ["redo", ICONS.redo, "İleri al", MAC ? "⌘+Shift+Z" : "Ctrl+Y"], ["clear", ICONS.clear, "Biçimi temizle"]],
  ];
  var BLOCKS = { h2: "H2", h3: "H3", quote: "BLOCKQUOTE" };

  window.MZCommentEditor = function (host, opts) {
    opts = opts || {};
    var limits = opts.limits || { text: 3000, images: 6, videos: 3 };
    var uid = "ce" + Math.random().toString(36).slice(2, 8);
    host.innerHTML = '<div class="ce">' +
      '<div class="ce-bar" role="toolbar" aria-label="Biçimlendirme araçları" aria-controls="' + uid + '">' + TOOLS.map(function (g) {
        return '<span class="ce-group">' + g.map(function (t) {
          var label = t[2] + (t[3] ? " (" + t[3] + ")" : "");
          return '<button type="button" data-cmd="' + t[0] + '" title="' + esc(label) + '" aria-label="' + esc(t[2]) + '"' +
            (/^(bold|italic|h2|h3|ul|ol|quote)$/.test(t[0]) ? ' aria-pressed="false"' : "") + (/<span>/.test(t[1]) ? ' class="has-text"' : "") + ">" + t[1] + "</button>";
        }).join("") + "</span>";
      }).join("") + "</div>" +
      '<div class="ce-pop" hidden></div><div class="ce-note" role="status" hidden></div><div class="ce-media" hidden></div>' +
      '<div class="ce-area prose" id="' + uid + '" contenteditable="true" role="textbox" aria-multiline="true" spellcheck="true" aria-label="' + esc(opts.label || "Yorumunuz") +
      '" data-placeholder="' + esc(opts.placeholder || "Yorumunuzu yazın…") + '"></div>' +
      '<div class="ce-foot"><button type="button" class="ce-prev-btn" aria-expanded="false" aria-controls="' + uid + '-p">' + ICONS.eye + "<span>Önizleme</span></button>" +
      '<span class="ce-count" aria-live="polite"></span></div>' +
      '<div class="ce-preview" id="' + uid + '-p" hidden><div class="ce-preview-head">Önizleme · yorumunuz sitede böyle görünecek</div><div class="prose"></div></div></div>';

    var root = $(".ce", host), bar = $(".ce-bar", root), area = $(".ce-area", root), pop = $(".ce-pop", root), note = $(".ce-note", root);
    var media = $(".ce-media", root), count = $(".ce-count", root), prevBtn = $(".ce-prev-btn", root), prev = $(".ce-preview", root);
    var saved = null, picked = null, upSeq = 0, changeCb = null;

    /* ---- seçim ---- */
    var inArea = function (n) { return n && (n === area || area.contains(n)); };
    var keepRange = function () { var s = window.getSelection(); if (s.rangeCount && inArea(s.getRangeAt(0).commonAncestorContainer)) saved = s.getRangeAt(0).cloneRange(); };
    var restoreRange = function () {
      area.focus();
      var s = window.getSelection(); s.removeAllRanges();
      if (saved && inArea(saved.commonAncestorContainer)) s.addRange(saved);
      else { var r = document.createRange(); r.selectNodeContents(area); r.collapse(false); s.addRange(r); }
    };
    var exec = function (c, v) { try { document.execCommand(c, false, v == null ? null : v); } catch (e) {} };
    var blockOf = function () {
      var s = window.getSelection(); if (!s.rangeCount) return null;
      var n = s.getRangeAt(0).startContainer; n = n.nodeType === 3 ? n.parentNode : n;
      while (n && n !== area) { if (/^(P|H2|H3|BLOCKQUOTE|LI)$/.test(n.nodeName)) return n; n = n.parentNode; }
      return null;
    };
    var closestIn = function (tag) {
      var s = window.getSelection(); if (!s.rangeCount) return null;
      var n = s.getRangeAt(0).startContainer;
      for (; n && n !== area; n = n.parentNode) if (n.nodeName === tag) return n;
      return null;
    };

    /* ---- biçim düğmelerinin durumu ---- */
    var refreshState = function () {
      var st = function (c) { try { return document.queryCommandState(c); } catch (e) { return false; } };
      var on = { bold: st("bold"), italic: st("italic"), ul: st("insertUnorderedList"), ol: st("insertOrderedList"), h2: !!closestIn("H2"), h3: !!closestIn("H3"), quote: !!closestIn("BLOCKQUOTE") };
      $$("[aria-pressed]", bar).forEach(function (b) { b.setAttribute("aria-pressed", on[b.dataset.cmd] ? "true" : "false"); });
    };

    /* ---- içerik ---- */
    var stats = function () {
      return { text: area.textContent.replace(/\s+/g, " ").trim().length, images: $$("img", area).length, videos: $$("figure.media-video", area).length, uploading: $$(".ce-up", area).length };
    };
    var problem = function (s) {
      s = s || stats();
      if (s.uploading) return "Görsel yüklemesinin bitmesini bekleyin.";
      if (s.text > limits.text) return "Yorum en fazla " + limits.text + " karakter olabilir.";
      if (s.images > limits.images) return "Bir yoruma en fazla " + limits.images + " görsel eklenebilir.";
      if (s.videos > limits.videos) return "Bir yoruma en fazla " + limits.videos + " video eklenebilir.";
      if (s.text < 3 && !s.images && !s.videos) return "Yorum çok kısa.";
      return "";
    };
    var getHtml = function () {
      var c = area.cloneNode(true);
      $$(".ce-up", c).forEach(function (n) { n.remove(); });
      $$("[contenteditable]", c).forEach(function (n) { n.removeAttribute("contenteditable"); });
      $$(".is-picked", c).forEach(function (n) { n.classList.remove("is-picked"); });
      $$("[data-pending-video]", c).forEach(function (n) { n.removeAttribute("data-pending-video"); });
      return c.innerHTML.trim();
    };
    var markMedia = function () { $$("figure.media-video", area).forEach(function (f) { f.setAttribute("contenteditable", "false"); }); };
    var changed = function () {
      var s = stats();
      area.classList.toggle("is-empty", !s.text && !s.images && !s.videos && !s.uploading);
      count.textContent = s.text + " / " + limits.text;
      count.classList.toggle("over", s.text > limits.text);
      if (!prev.hidden) $(".prose", prev).innerHTML = getHtml() || '<p class="muted">Henüz bir şey yazılmadı.</p>';
      if (changeCb) changeCb(s);
    };
    var setHtml = function (html) {
      area.innerHTML = html && String(html).trim() ? html : "<p><br></p>";
      markMedia(); hideMedia(); changed();
    };

    /* ---- uyarı satırı ve açılır form ---- */
    var say = function (html, actions, warn) {
      note.innerHTML = "<span>" + html + "</span>" + (actions || []).map(function (a, i) { return '<button type="button" class="btn btn-sm ' + (i ? "btn-ghost" : "btn-primary") + '" data-i="' + i + '">' + esc(a[0]) + "</button>"; }).join("") +
        '<button type="button" class="ce-x" aria-label="Kapat" data-x>×</button>';
      note.classList.toggle("warn", !!warn);
      note.hidden = false;
      $$("[data-i]", note).forEach(function (b) { b.addEventListener("click", function () { note.hidden = true; actions[+b.dataset.i][1](); }); });
      $("[data-x]", note).addEventListener("click", function () { note.hidden = true; });
    };
    var closePop = function () { pop.hidden = true; pop.innerHTML = ""; };
    var openPop = function (html, setup) {
      keepRange(); hideMedia();
      pop.innerHTML = html + '<button type="button" class="ce-x" aria-label="Kapat" data-x>×</button>';
      pop.hidden = false;
      $("[data-x]", pop).addEventListener("click", function () { closePop(); restoreRange(); });
      pop.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); closePop(); restoreRange(); } });
      setup();
      var first = $("input", pop); if (first) setTimeout(function () { first.focus(); first.select(); }, 20);
    };

    // Görsel ve video kendi bloğu olarak eklenir; ardından yazmaya devam edilebilecek boş satır bırakılır.
    var insertBlock = function (html) {
      restoreRange();
      exec("insertHTML", html + "<p><br></p>");
      markMedia(); keepRange(); changed();
    };

    /* ---- bağlantı ---- */
    var normUrl = function (u) {
      u = String(u || "").trim();
      if (/^www\./i.test(u)) u = "https://" + u;
      if (/^[^\s@/]+@[^\s@/]+\.[a-z]{2,}$/i.test(u)) u = "mailto:" + u;
      return /^(https?:\/\/[^\s<>"]+\.[^\s<>"]+|mailto:[^\s<>"]+)$/i.test(u) ? u : "";
    };
    var linkDialog = function () {
      keepRange();
      var a = closestIn("A"), sel = window.getSelection(), hasSel = sel.rangeCount && !sel.isCollapsed;
      openPop('<div class="ce-pop-title">' + (a ? "Bağlantıyı düzenle" : "Bağlantı ekle") + "</div>" +
        '<label class="ce-field"><span>Adres</span><input type="url" inputmode="url" data-url placeholder="https://…" value="' + esc(a ? a.getAttribute("href") : "") + '" autocomplete="off"></label>' +
        (a || hasSel ? "" : '<label class="ce-field"><span>Görünen yazı <em>(isteğe bağlı)</em></span><input type="text" data-text placeholder="Bağlantı yazısı"></label>') +
        '<p class="ce-err" data-err hidden></p><div class="ce-pop-actions"><button type="button" class="btn btn-primary btn-sm" data-ok>' + (a ? "Güncelle" : "Ekle") + "</button>" +
        (a ? '<button type="button" class="btn btn-ghost btn-sm" data-unlink>Bağlantıyı kaldır</button>' : "") + "</div>", function () {
        var inp = $("[data-url]", pop), err = $("[data-err]", pop);
        var go = function () {
          var raw = inp.value.trim(), v = parseVideo(raw), u = normUrl(raw);
          var t = $("[data-text]", pop) ? $("[data-text]", pop).value.trim() : "";
          if (!u) { err.textContent = "Geçerli bir adres yazın (https:// ile başlayan)."; err.hidden = false; inp.focus(); return; }
          if (v && !a) {
            err.hidden = true;
            return say("<strong>Bu bir video bağlantısı.</strong> Yorumda oynatıcı olarak gösterilsin mi?", [
              ["Video olarak ekle", function () { closePop(); insertBlock(videoHtml(v)); }],
              ["Bağlantı olarak ekle", function () { closePop(); putLink(u, t); }]]);
          }
          closePop(); putLink(u, t);
        };
        var putLink = function (u, t) {
          restoreRange();
          if (a) { a.setAttribute("href", u); }
          else if (window.getSelection().isCollapsed) {
            exec("insertHTML", '<a href="' + esc(u) + '">' + esc(t || u.replace(/^mailto:/, "")) + "</a>&nbsp;");
          } else exec("createLink", u);
          changed();
        };
        $("[data-ok]", pop).addEventListener("click", go);
        $$("input", pop).forEach(function (i) { i.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); go(); } }); });
        var un = $("[data-unlink]", pop);
        if (un) un.addEventListener("click", function () {
          closePop(); var t = document.createTextNode(a.textContent); a.parentNode.replaceChild(t, a); changed();
        });
      });
    };

    /* ---- video ---- */
    var videoDialog = function (initial, replace) {
      openPop('<div class="ce-pop-title">' + (replace ? "Videoyu değiştir" : "Video ekle") + '</div><p class="ce-help">' + esc(VIDEO_HELP) + "</p>" +
        '<label class="ce-field"><span>Video bağlantısı ya da gömme kodu</span><input type="text" inputmode="url" data-url autocomplete="off" placeholder="https://www.youtube.com/watch?v=…" value="' + esc(initial || "") + '"></label>' +
        '<p class="ce-err" data-err hidden></p><div class="ce-vprev prose" data-prev></div>' +
        '<div class="ce-pop-actions"><button type="button" class="btn btn-primary btn-sm" data-ok disabled>' + (replace ? "Değiştir" : "Videoyu ekle") + "</button></div>", function () {
        var inp = $("[data-url]", pop), err = $("[data-err]", pop), pv = $("[data-prev]", pop), ok = $("[data-ok]", pop), cur = null, shown = "";
        var check = function () {
          var raw = inp.value.trim(); cur = videoOf(raw); ok.disabled = !cur;
          err.hidden = !raw || !!cur;
          err.textContent = raw && !cur ? "Bu bağlantı tanınmadı. " + VIDEO_HELP : "";
          var key = cur ? cur.provider + cur.id : "";
          if (key !== shown) { shown = key; pv.innerHTML = cur ? videoHtml(cur).replace(' contenteditable="false"', "") : ""; }
        };
        inp.addEventListener("input", check);
        inp.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); if (cur) ok.click(); } });
        ok.addEventListener("click", function () {
          if (!cur) return;
          closePop();
          if (replace) { var t = document.createElement("div"); t.innerHTML = videoHtml(cur); replace.parentNode.replaceChild(t.firstChild, replace); changed(); }
          else {
            if (stats().videos >= limits.videos) return say("Bir yoruma en fazla " + limits.videos + " video eklenebilir.", null, true);
            insertBlock(videoHtml(cur));
          }
        });
        check();
      });
    };

    /* ---- görsel ---- */
    var picker = document.createElement("input");
    picker.type = "file"; picker.accept = "image/jpeg,image/png,image/webp"; picker.hidden = true;
    root.appendChild(picker);
    var replaceTarget = null;
    var pickImage = function (target) { keepRange(); replaceTarget = target || null; picker.value = ""; picker.click(); };
    picker.addEventListener("change", function () { if (picker.files[0]) addImage(picker.files[0], replaceTarget); replaceTarget = null; });

    var addImage = function (file, target) {
      if (!IMG_TYPES[file.type]) return say("Yalnızca JPG, PNG ya da WebP görsel ekleyebilirsiniz.", null, true);
      if (file.size > MAX_PICK) return say("Görsel çok büyük (en fazla 25 MB seçilebilir; yüklemeden önce küçültülür).", null, true);
      if (!target && stats().images + stats().uploading >= limits.images) return say("Bir yoruma en fazla " + limits.images + " görsel eklenebilir.", null, true);
      var id = "u" + (++upSeq);
      var ph = '<p class="ce-up" contenteditable="false" data-up="' + id + '"><span class="ce-up-txt">Görsel hazırlanıyor…</span><span class="ce-up-bar"><span></span></span></p>';
      if (target) { var t = document.createElement("div"); t.innerHTML = ph; var host2 = target.closest("p") && target.closest("p").parentNode === area ? target.closest("p") : target; host2.parentNode.replaceChild(t.firstChild, host2); }
      else insertBlock(ph);
      hideMedia(); changed();
      var node = function () { return $('[data-up="' + id + '"]', area); };
      var progress = function (p) { var n = node(); if (!n) return; $(".ce-up-txt", n).textContent = "Görsel yükleniyor… %" + p; $(".ce-up-bar span", n).style.width = p + "%"; };
      prepareImage(file).then(function (blob) {
        if (blob.size > MAX_UPLOAD) throw "Görsel küçültüldükten sonra da 5 MB'tan büyük. Daha küçük bir görsel seçin.";
        progress(0);
        return upload(blob, progress);
      }).then(function (src) {
        var n = node(); if (!n) return; // kullanıcı yükleme sırasında sildi
        var p = document.createElement("p"); var img = document.createElement("img");
        img.src = src; img.alt = ""; p.appendChild(img); n.parentNode.replaceChild(p, n);
        changed();
      }).catch(function (msg) {
        var n = node(); if (n) n.remove();
        changed();
        say(esc(typeof msg === "string" ? msg : "Görsel yüklenemedi."), null, true);
      });
    };

    /* ---- görsel ya da videoya dokununca: değiştir / kaldır ---- */
    var hideMedia = function () { media.hidden = true; if (picked) picked.classList.remove("is-picked"); picked = null; };
    area.addEventListener("click", function (e) {
      var m = e.target.closest ? e.target.closest("figure.media-video, img") : null;
      if (!m || !area.contains(m)) return hideMedia();
      hideMedia(); picked = m; m.classList.add("is-picked");
      var vid = m.tagName === "FIGURE";
      media.innerHTML = "<span>Seçili " + (vid ? "video" : "görsel") + ':</span><button type="button" class="btn btn-ghost btn-sm" data-m="edit">Değiştir</button>' +
        '<button type="button" class="btn btn-ghost btn-sm danger" data-m="del">Kaldır</button><button type="button" class="ce-x" aria-label="Kapat" data-m="x">×</button>';
      media.hidden = false;
    });
    media.addEventListener("mousedown", function (e) { e.preventDefault(); });
    media.addEventListener("click", function (e) {
      var b = e.target.closest("button"); if (!b || !picked) return;
      var m = picked, what = b.dataset.m;
      hideMedia();
      if (what === "del") {
        var p = m.parentNode;
        m.remove();
        if (p && p !== area && p.nodeName === "P" && !p.textContent.trim() && !$("img", p)) p.remove();
        if (!area.firstChild) area.innerHTML = "<p><br></p>";
        changed(); area.focus();
      } else if (what === "edit") {
        if (m.tagName === "FIGURE") videoDialog($("iframe", m).getAttribute("src"), m);
        else pickImage(m);
      }
    });

    /* ---- araç çubuğu ---- */
    var run = function (c) {
      if (c === "link") return linkDialog();
      if (c === "image") return pickImage();
      if (c === "video") { keepRange(); return videoDialog(""); }
      restoreRange();
      if (BLOCKS[c]) {
        var cur = closestIn(BLOCKS[c]);
        exec("formatBlock", cur ? "<p>" : "<" + BLOCKS[c].toLowerCase() + ">");
      } else if (c === "ul") exec("insertUnorderedList");
      else if (c === "ol") exec("insertOrderedList");
      else if (c === "clear") {
        exec("removeFormat"); exec("unlink");
        var b = blockOf(); if (b && /^(H2|H3|BLOCKQUOTE)$/.test(b.nodeName)) exec("formatBlock", "<p>");
        if (closestIn("BLOCKQUOTE")) exec("formatBlock", "<p>");
      } else exec(c);
      keepRange(); refreshState(); changed();
    };
    $$("[data-cmd]", bar).forEach(function (b) {
      b.addEventListener("mousedown", function (e) { e.preventDefault(); keepRange(); });
      b.addEventListener("click", function () { run(b.dataset.cmd); });
    });

    /* ---- klavye ---- */
    // İşlenen kısayollar sayfaya ulaşmaz (Ctrl+K sitede aramayı da açar)
    area.addEventListener("keydown", function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (opts.onSubmit) opts.onSubmit(); return; }
      if (!mod) return;
      var k = (e.key || "").toLowerCase(), code = e.code || "";
      var cmd = !e.shiftKey && !e.altKey && k === "k" ? "link" :
        e.shiftKey && (code === "Digit7" || k === "7" || k === "/") ? "ol" :
        e.shiftKey && (code === "Digit8" || k === "8" || k === "(") ? "ul" :
        e.altKey && code === "Digit2" ? "h2" : e.altKey && code === "Digit3" ? "h3" : "";
      if (cmd) { e.preventDefault(); e.stopPropagation(); keepRange(); run(cmd); }
    });

    /* ---- yapıştırma ve sürükle-bırak: biçim kalabalığı ve zararlı içerik gelmesin diye düz metin ---- */
    var insertText = function (t) {
      var html = String(t).replace(/\r/g, "").split(/\n{2,}/).map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
      exec("insertHTML", html);
    };
    area.addEventListener("paste", function (e) {
      var cd = e.clipboardData || window.clipboardData; if (!cd) return;
      var files = cd.files && cd.files.length ? Array.prototype.slice.call(cd.files) : [];
      e.preventDefault();
      if (files.length) { keepRange(); files.filter(function (f) { return IMG_TYPES[f.type]; }).slice(0, limits.images).forEach(function (f) { addImage(f); }); return; }
      var t = cd.getData("text/plain") || "", one = t.trim();
      if (/^<iframe\b[\s\S]*<\/iframe>$/i.test(one)) {
        var v0 = videoOf(one); keepRange();
        if (v0) insertBlock(videoHtml(v0)); else say("Bu gömme kodu desteklenmeyen bir sağlayıcıya ait. " + esc(VIDEO_HELP), null, true);
        return;
      }
      var v = /^\S+$/.test(one) && parseVideo(one);
      if (v) {
        exec("insertHTML", '<a href="' + esc(one) + '" data-pending-video>' + esc(one) + "</a>&nbsp;");
        keepRange(); changed();
        return say("<strong>" + (v.provider === "youtube" ? "YouTube" : "Vimeo") + " bağlantısı algılandı.</strong> Oynatıcı olarak gösterilsin mi?", [["Videoya dönüştür", function () {
          var a = $("a[data-pending-video]", area); if (!a) return;
          var t2 = document.createElement("div"); t2.innerHTML = videoHtml(v);
          var blk = a.closest("p, li, h2, h3, blockquote");
          a.remove();
          if (blk && blk.parentNode === area) { if (blk.textContent.replace(/ /g, " ").trim()) blk.parentNode.insertBefore(t2.firstChild, blk.nextSibling); else blk.parentNode.replaceChild(t2.firstChild, blk); }
          else area.appendChild(t2.firstChild);
          changed();
        }], ["Bağlantı olarak bırak", function () { var a = $("a[data-pending-video]", area); if (a) a.removeAttribute("data-pending-video"); }]]);
      }
      var u = /^\S+$/.test(one) && normUrl(one);
      if (u && /^https?:/.test(u)) { exec("insertHTML", '<a href="' + esc(u) + '">' + esc(one) + "</a>&nbsp;"); changed(); return; }
      insertText(t); changed();
    });
    area.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") > -1) e.preventDefault(); });
    area.addEventListener("drop", function (e) {
      var dt = e.dataTransfer; if (!dt) return;
      e.preventDefault();
      var files = Array.prototype.slice.call(dt.files || []).filter(function (f) { return IMG_TYPES[f.type]; });
      // bırakılan yeri imleç yap
      if (document.caretRangeFromPoint) { var r = document.caretRangeFromPoint(e.clientX, e.clientY); if (r && inArea(r.startContainer)) saved = r; }
      if (files.length) return files.slice(0, limits.images).forEach(function (f) { addImage(f); });
      var t = dt.getData("text/plain"); if (t) { restoreRange(); insertText(t); changed(); }
    });

    /* ---- önizleme ---- */
    prevBtn.addEventListener("click", function () {
      var open = prev.hidden;
      prev.hidden = !open; prevBtn.setAttribute("aria-expanded", open ? "true" : "false");
      prevBtn.classList.toggle("on", open);
      changed();
    });

    area.addEventListener("input", function () { closeStrayNote(); changed(); refreshState(); });
    var closeStrayNote = function () { if (!$("a[data-pending-video]", area) && !note.classList.contains("warn") && $("[data-i]", note)) note.hidden = true; };
    area.addEventListener("keyup", keepRange);
    area.addEventListener("mouseup", keepRange);
    area.addEventListener("focus", function () { exec("defaultParagraphSeparator", "p"); });
    var onSel = function () { var s = window.getSelection(); if (s.rangeCount && inArea(s.anchorNode)) { keepRange(); refreshState(); } };
    document.addEventListener("selectionchange", onSel);

    setHtml(opts.html || "");

    return {
      el: root,
      getHtml: getHtml,
      setHtml: setHtml,
      clear: function () {
        setHtml(""); note.hidden = true; closePop(); if (!prev.hidden) prevBtn.click();
        $$("[aria-pressed]", bar).forEach(function (b) { b.setAttribute("aria-pressed", "false"); });
      },
      focus: function () { restoreRange(); },
      problem: function () { return problem(); },
      onChange: function (cb) { changeCb = cb; changed(); },
      say: function (msg, warn) { say(esc(msg), null, warn); },
      destroy: function () { document.removeEventListener("selectionchange", onSel); host.innerHTML = ""; }
    };
  };
})();
