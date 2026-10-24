/* Mezhep.Org üye ve yönetim paneli (tek sayfa, hash yönlendirmeli). */
(function () {
  "use strict";
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var main = $("#panel-main"), navEl = $("[data-nav]"), shell = $(".panel-shell");
  var svg = function (p) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + p + "</svg>"; };
  var IC = {
    book: svg('<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>'),
    news: svg('<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Z"/><path d="M18 14h-8M15 18h-5M10 6h8v4h-8z"/>'),
    user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/>'),
    key: svg('<circle cx="7.5" cy="15.5" r="4.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>'),
    users: svg('<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>')
  };
  var KIND_LABEL = { member: "Akademisyen", work: "Eser", topic: "Haber / Etkinlik", claim: "Profil sahipliği" };
  var STATUS_LABEL = { pending: "Onay bekliyor", approved: "Onaylandı", rejected: "Reddedildi", active: "Etkin", blocked: "Engelli", visible: "Yayında", hidden: "Gizli" };
  var STATUS_BADGE = { pending: "b-gold", approved: "b-brand", rejected: "b-rose", active: "b-brand", blocked: "b-rose", visible: "b-brand", hidden: "" };

  var state = { user: null, pending: null, schema: null };
  // Yetki denetimi (sunucu her istekte ayrıca denetler; burası yalnızca arayüzü düzenler)
  var can = function (p) { var u = state.user; return !!u && u.status === "active" && !u.must_change && (u.perms || []).indexOf(p) > -1; };
  var isStaff = function () { return !!state.user && (state.user.perms || []).some(function (p) { return p.indexOf("kendi.") !== 0; }); };
  // Her sayfa geçişinde artar; eski sayfadan kalan istek yanıtları yeni sayfayı ezmesin diye yok sayılır.
  var navSeq = 0;

  /* ---------------------------------------------------------------- yardımcılar */
  function api(method, url, body) {
    var seq = navSeq;
    return rawApi(method, url, body).then(function (j) {
      return seq === navSeq ? j : new Promise(function () {});
    }, function (e) {
      if (seq !== navSeq) return new Promise(function () {});
      throw e;
    });
  }
  function rawApi(method, url, body) {
    return fetch("/api" + url, {
      method: method, credentials: "same-origin",
      headers: body instanceof FormData ? { "x-mz": "1" } : { "x-mz": "1", "Content-Type": "application/json" },
      body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || "İstek başarısız."); e.fields = j.fields; e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function toast(msg, isErr) {
    var t = document.createElement("div");
    t.className = "toast" + (isErr ? " err" : ""); t.textContent = msg;
    $(".toast-zone").appendChild(t);
    setTimeout(function () { t.remove(); }, isErr ? 6000 : 3500);
  }
  function fail(e) { toast((e && e.message) || "Bir hata oluştu.", true); }
  function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
  function initials(n) { return String(n || "?").split(/\s+/).filter(Boolean).map(function (w) { return w[0]; }).slice(0, 2).join("").toUpperCase(); }
  function when(s) {
    if (!s) return "";
    var d = new Date(String(s).replace(" ", "T") + (/Z|\+/.test(s) ? "" : "Z"));
    return isNaN(d) ? esc(s) : d.toLocaleString("tr-TR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  function badge(status) { return '<span class="badge ' + (STATUS_BADGE[status] || "") + '">' + esc(STATUS_LABEL[status] || status) + "</span>"; }
  function textOf(html) { var d = document.createElement("div"); d.innerHTML = String(html || "").replace(/\{ROOT\}/g, "/"); return d.textContent.replace(/\s+/g, " ").trim(); }
  function dialog(html, onReady) {
    var d = $("[data-dialog]");
    d.innerHTML = html;
    $$("[data-close]", d).forEach(function (b) { b.addEventListener("click", function () { d.close(); }); });
    if (onReady) onReady(d);
    d.showModal();
    return d;
  }
  function confirmBox(message, okLabel, danger) {
    return new Promise(function (resolve) {
      dialog('<h3>Emin misiniz?</h3><p>' + esc(message) + '</p><div class="form-actions"><button class="btn ' + (danger ? "btn-danger" : "btn-primary") + '" data-ok>' + esc(okLabel || "Onayla") +
        '</button><button class="btn btn-ghost" data-close>Vazgeç</button></div>', function (d) {
        $("[data-ok]", d).addEventListener("click", function () { d.close(); resolve(true); });
        d.addEventListener("close", function () { resolve(false); }, { once: true });
      });
    });
  }
  function setTitle(t) { document.title = t + " · Mezhep.Org Paneli"; }
  function busy(btn, on) { if (btn) { btn.disabled = on; if (on) btn.dataset.label = btn.innerHTML; else if (btn.dataset.label) btn.innerHTML = btn.dataset.label; } }

  /* ---------------------------------------------------------------- form motoru */
  function getSchema() {
    if (state.schema) return Promise.resolve(state.schema);
    return api("GET", "/schema").then(function (s) { state.schema = s; return s; });
  }

  function fieldHtml(f, value, opts) {
    var id = "f-" + f.key, v = value == null ? "" : value, req = f.required ? '<span class="req" aria-hidden="true">*</span>' : "";
    var lbl = '<label for="' + id + '">' + esc(f.label) + req + "</label>";
    var input;
    if (f.type === "select") {
      var options = (!opts.admin && f.memberOptions) ? f.memberOptions : f.options;
      if (f.dependsOn && opts.values && opts.values[f.dependsOn] && f.optionsBy) options = f.optionsBy[opts.values[f.dependsOn]] || options;
      if (v && options.indexOf(v) < 0) options = [v].concat(options);
      input = '<select id="' + id + '" name="' + f.key + '"' + (f.required ? " required" : "") + '><option value="">Seçin…</option>' +
        options.map(function (o) { return '<option value="' + esc(o) + '"' + (o === v ? " selected" : "") + ">" + esc((f.labels && f.labels[o]) || o) + "</option>"; }).join("") + "</select>";
    } else if (f.type === "html") {
      lbl = '<span class="lbl" id="' + id + '-l">' + esc(f.label) + req + "</span>";
      input = '<div class="editor" data-editor="' + f.key + '"><div class="editor-bar" role="toolbar" aria-label="Biçimlendirme">' +
        '<button type="button" data-cmd="bold" title="Kalın"><b>K</b></button><button type="button" data-cmd="italic" title="İtalik"><i>İ</i></button>' +
        '<button type="button" data-cmd="h3" title="Ara başlık">Başlık</button><button type="button" data-cmd="insertUnorderedList" title="Liste">• Liste</button>' +
        '<button type="button" data-cmd="link" title="Bağlantı">Bağlantı</button><button type="button" data-cmd="image" title="Görsel ekle">Görsel</button>' +
        '<button type="button" data-cmd="removeFormat" title="Biçimi temizle">Temizle</button></div>' +
        '<div class="editor-area prose" contenteditable="true" role="textbox" aria-multiline="true" aria-labelledby="' + id + '-l" data-placeholder="Metni buraya yazın ya da yapıştırın…">' +
        String(v).replace(/\{ROOT\}/g, "/") + "</div></div>";
    } else if (f.type === "image") {
      lbl = '<span class="lbl">' + esc(f.label) + "</span>";
      input = '<div class="image-field" data-image="' + f.key + '"><div class="preview">' + (v ? '<img src="/' + esc(v) + '" alt="">' : "Görsel yok") +
        '</div><input type="hidden" name="' + f.key + '" value="' + esc(v) + '"><div class="form-actions" style="padding:0">' +
        '<label class="btn btn-ghost btn-sm">Görsel seç<input type="file" accept="image/jpeg,image/png,image/webp" hidden></label>' +
        '<button type="button" class="btn btn-ghost btn-sm" data-clear' + (v ? "" : " hidden") + ">Kaldır</button></div></div>" +
        '<span class="hint">JPG, PNG ya da WEBP; en fazla 5 MB.</span>';
    } else {
      var type = { url: "url", email: "email", year: "number", date: "date" }[f.type] || "text";
      if (f.type === "date") { var m = String(v).match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/); v = m ? m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2) : v; }
      input = '<input type="' + type + '" id="' + id + '" name="' + f.key + '" value="' + esc(v) + '"' + (f.max ? ' maxlength="' + f.max + '"' : "") +
        (f.required ? " required" : "") + (f.type === "year" ? ' min="600" max="2100"' : "") + (f.suggest ? ' list="' + id + '-list"' : "") + ">" +
        (f.suggest ? '<datalist id="' + id + '-list">' + f.suggest.map(function (o) { return '<option value="' + esc(o) + '">'; }).join("") + "</datalist>" : "");
    }
    return '<div class="field" data-field="' + f.key + '">' + lbl + input + '<span class="err" hidden></span></div>';
  }

  // Şemadan form çizer; değerleri toplayan ve hataları gösteren bir nesne döner.
  function buildForm(container, kind, values, opts) {
    opts = opts || {};
    return getSchema().then(function (s) {
      var fields = s.schemas[kind].filter(function (f) { return opts.admin || !f.admin; });
      container.innerHTML = fields.map(function (f) { return fieldHtml(f, values[f.key], { admin: opts.admin, values: values }); }).join("");
      // bağımlı seçim kutuları (eser kategorisi → tür)
      fields.filter(function (f) { return f.dependsOn; }).forEach(function (f) {
        var parent = $('[name="' + f.dependsOn + '"]', container);
        parent && parent.addEventListener("change", function () {
          var holder = $('[data-field="' + f.key + '"]', container);
          var cur = $('[name="' + f.key + '"]', container).value;
          var vals = {}; vals[f.dependsOn] = parent.value;
          var tmp = document.createElement("div"); tmp.innerHTML = fieldHtml(f, (f.optionsBy[parent.value] || []).indexOf(cur) >= 0 ? cur : "", { admin: opts.admin, values: vals });
          holder.replaceWith(tmp.firstChild);
        });
      });
      $$("[data-editor]", container).forEach(setupEditor);
      $$("[data-image]", container).forEach(setupImage);
      return {
        values: function () {
          var out = {};
          fields.forEach(function (f) {
            if (f.type === "html") { out[f.key] = $('[data-editor="' + f.key + '"] .editor-area', container).innerHTML; return; }
            var el = $('[name="' + f.key + '"]', container);
            out[f.key] = el ? el.value : "";
          });
          return out;
        },
        showErrors: function (errs) {
          $$(".field", container).forEach(function (el) { el.classList.remove("has-err"); var e = $(".err", el); e.hidden = true; e.textContent = ""; });
          var first = null;
          Object.keys(errs || {}).forEach(function (k) {
            var el = $('[data-field="' + k + '"]', container);
            if (!el) return;
            el.classList.add("has-err"); var e = $(".err", el); e.textContent = errs[k]; e.hidden = false;
            first = first || el;
          });
          if (first) first.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      };
    });
  }

  function uploadImage(file) {
    var fd = new FormData(); fd.append("file", file);
    return api("POST", "/uploads", fd).then(function (j) { return j.path; });
  }

  function setupEditor(ed) {
    var area = $(".editor-area", ed);
    area.addEventListener("paste", function (e) {
      // Word vb. kaynaklardan gelen biçim kalabalığını önlemek için düz metin yapıştırılır.
      e.preventDefault();
      var t = (e.clipboardData || window.clipboardData).getData("text/plain");
      var html = t.split(/\n{2,}/).map(function (p) { return "<p>" + esc(p).replace(/\n/g, "<br>") + "</p>"; }).join("");
      document.execCommand("insertHTML", false, html);
    });
    $$("[data-cmd]", ed).forEach(function (b) {
      b.addEventListener("mousedown", function (e) { e.preventDefault(); });
      b.addEventListener("click", function () {
        var c = b.getAttribute("data-cmd");
        area.focus();
        if (c === "h3") document.execCommand("formatBlock", false, "h3");
        else if (c === "link") {
          var u = prompt("Bağlantı adresi (https://…)");
          if (u && /^https?:\/\//i.test(u)) document.execCommand("createLink", false, u);
        } else if (c === "image") {
          var inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/jpeg,image/png,image/webp";
          inp.onchange = function () {
            if (!inp.files[0]) return;
            uploadImage(inp.files[0]).then(function (p) { area.focus(); document.execCommand("insertHTML", false, '<p><img src="/' + esc(p) + '" alt=""></p>'); }).catch(fail);
          };
          inp.click();
        } else document.execCommand(c, false, null);
      });
    });
  }

  function setupImage(box) {
    var hidden = $('input[type="hidden"]', box), file = $('input[type="file"]', box), prev = $(".preview", box), clear = $("[data-clear]", box);
    file.addEventListener("change", function () {
      if (!file.files[0]) return;
      prev.textContent = "Yükleniyor…";
      uploadImage(file.files[0]).then(function (p) {
        hidden.value = p; prev.innerHTML = '<img src="/' + esc(p) + '" alt="">'; clear.hidden = false;
      }).catch(function (e) { prev.textContent = "Görsel yok"; fail(e); });
    });
    clear.addEventListener("click", function () { hidden.value = ""; prev.textContent = "Görsel yok"; clear.hidden = true; });
  }

  // Akademisyen arama kutusu (profil sahiplenme ve hesap bağlama için).
  function memberPicker(container, onPick, placeholder) {
    container.innerHTML = '<div class="pick"><label class="input">' + svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>') +
      '<input type="search" placeholder="' + esc(placeholder || "Akademisyen adı yazın…") + '" autocomplete="off" aria-label="Akademisyen ara"></label><div class="pick-results" hidden></div></div>';
    var input = $("input", container), res = $(".pick-results", container), t;
    input.addEventListener("input", function () {
      clearTimeout(t);
      var q = input.value.trim();
      if (q.length < 2) { res.hidden = true; return; }
      t = setTimeout(function () {
        api("GET", "/lookup/members?q=" + encodeURIComponent(q)).then(function (j) {
          res.innerHTML = j.items.length ? j.items.map(function (m) {
            return '<button type="button" data-id="' + m.id + '" data-name="' + esc(m.name) + '">' + esc(m.name) + "<small>" + esc([m.title, m.university].filter(Boolean).join(" · ")) + "</small></button>";
          }).join("") : '<div class="muted" style="padding:12px 14px">Sonuç yok.</div>';
          res.hidden = false;
          $$("button", res).forEach(function (b) {
            b.addEventListener("click", function () { input.value = b.dataset.name; res.hidden = true; onPick({ id: +b.dataset.id, name: b.dataset.name }); });
          });
        });
      }, 200);
    });
  }

  /* ---------------------------------------------------------------- çerçeve */
  function renderChrome(route) {
    var u = state.user;
    $("[data-user]").innerHTML = u ? '<span class="avatar">' + esc(initials(u.name)) + '</span><span class="who"><strong>' + esc(u.name) + "</strong><span>" +
      esc(u.role_label || "Üye") + '</span></span><button class="btn btn-ghost btn-sm" type="button" data-logout>Çıkış</button>' : "";
    var lo = $("[data-logout]");
    lo && lo.addEventListener("click", function () { api("POST", "/auth/logout").then(function () { state.user = null; go("#/giris"); }); });

    var showNav = u && u.status === "active" && !u.must_change;
    navEl.hidden = !showNav;
    shell.classList.toggle("no-nav", !showNav);
    if (!showNav) return;
    var p = state.pending || {};
    var link = function (h, label, count) {
      var cur = route === h || (h !== "#/" && h !== "#/yonetim" && route.indexOf(h) === 0);
      return '<a href="' + h + '"' + (cur ? ' aria-current="page"' : "") + ">" + label + (count ? '<span class="count">' + count + "</span>" : "") + "</a>";
    };
    var own = can("kendi.profil") || can("kendi.eser");
    var html = "<h4>Üyelik</h4>" + link("#/", "Özet") + link("#/oneri/work", "Eser ekle") + link("#/oneri/topic", "Haber gönder") +
      (own ? link("#/eserlerim", "Eserlerim ve profilim") : link("#/profil", "Akademik profilim")) +
      link("#/gonderilerim", "Gönderilerim") + link("#/hesap", "Hesap ayarları");
    if (isStaff()) {
      html += "<h4>Yönetim</h4>" + link("#/yonetim", "Yönetim özeti");
      if (["onay.member", "onay.work", "onay.topic", "onay.claim"].some(can)) html += link("#/yonetim/onaylar", "Onay kuyruğu", p.submissions);
      if (can("uye.onay") || can("uye.yonet") || can("yetki.yonet")) html += link("#/yonetim/uyeler", "Üyeler", p.users);
      if (can("yetki.yonet")) html += link("#/yonetim/roller", "Roller ve yetkiler");
      if (can("yorum.yonet")) html += link("#/yonetim/yorumlar", "Yorumlar", p.comments);
      if (can("icerik.member")) html += link("#/yonetim/icerik/member", "Akademisyenler");
      if (can("icerik.work")) html += link("#/yonetim/icerik/work", "Eserler");
      if (can("icerik.topic")) html += link("#/yonetim/icerik/topic", "Haber ve etkinlikler");
      if (can("icerik.sil")) html += link("#/yonetim/cop", "Geri dönüşüm kutusu");
      if (can("site.ayar") || can("ai.ayar")) html += link("#/yonetim/ayarlar", "Site ayarları");
      if (can("kayit.gor")) html += link("#/yonetim/kayitlar", "İşlem kayıtları");
      html += link("#/yonetim/site", "Site yayını");
      if (can("ai.rapor")) html += link("#/yonetim/yapay-zeka", "Yapay zekâ kullanımı");
    }
    navEl.innerHTML = html;
  }

  // İşlem sonrası tazeleme: sayfadan çıkıldıysa (api korumasıyla) hiç tamamlanmaz, böylece eski görünüm yeniden çizilmez.
  function refreshMe() {
    return api("GET", "/me").then(function (j) { state.user = j.user; state.pending = j.pending || null; });
  }
  function loadMe() {
    return rawApi("GET", "/me").then(function (j) { state.user = j.user; state.pending = j.pending || null; });
  }

  /* ---------------------------------------------------------------- giriş / kayıt */
  function viewLogin(params) {
    setTitle("Giriş");
    main.innerHTML = '<h1 class="page-title">Giriş yapın</h1><p class="page-lead">Mezhep.Org üye hesabınızla giriş yapın.</p>' +
      '<form class="form panel" novalidate><div class="field" data-field="email"><label for="l-email">E-posta</label><input type="email" id="l-email" name="email" autocomplete="username" required><span class="err" hidden></span></div>' +
      '<div class="field" data-field="password"><label for="l-pw">Şifre</label><input type="password" id="l-pw" name="password" autocomplete="current-password" required><span class="err" hidden></span></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Giriş yap</button><a href="#/kayit">Hesabınız yok mu? Üye olun</a></div>' +
      '<p class="muted" style="margin:0">Şifrenizi unuttuysanız site yöneticisinden geçici şifre isteyebilirsiniz.</p></form>';
    var f = $("form", main);
    $("#l-email").focus();
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var b = $("button[type=submit]", f); busy(b, true);
      api("POST", "/auth/login", { email: f.email.value, password: f.password.value }).then(function (j) {
        state.user = j.user;
        return refreshMe();
      }).then(function () { go(params.next ? decodeURIComponent(params.next) : "#/"); }).catch(function (err) { busy(b, false); fail(err); });
    });
  }

  function viewRegister() {
    setTitle("Üye ol");
    main.innerHTML = '<h1 class="page-title">Üye olun</h1><p class="page-lead">Üyeler eser ekleyebilir, akademik profillerini güncelleyebilir, haber gönderebilir ve yorum yazabilir. Üyelikler yönetici onayıyla etkinleşir.</p>' +
      '<form class="form panel" novalidate>' +
      '<div class="field" data-field="name"><label for="r-name">Ad Soyad<span class="req">*</span></label><input type="text" id="r-name" name="name" autocomplete="name" required maxlength="120"><span class="err" hidden></span></div>' +
      '<div class="row2"><div class="field" data-field="title"><label for="r-title">Unvan</label><input type="text" id="r-title" name="title" list="r-ranks" maxlength="60"><datalist id="r-ranks"></datalist></div>' +
      '<div class="field" data-field="university"><label for="r-uni">Üniversite / Kurum</label><input type="text" id="r-uni" name="university" maxlength="160"></div></div>' +
      '<div class="field" data-field="email"><label for="r-email">E-posta<span class="req">*</span></label><input type="email" id="r-email" name="email" autocomplete="email" required><span class="err" hidden></span></div>' +
      '<div class="field" data-field="password"><label for="r-pw">Şifre<span class="req">*</span></label><input type="password" id="r-pw" name="password" autocomplete="new-password" required minlength="10"><span class="hint">En az 10 karakter; harf ve rakam içermeli.</span><span class="err" hidden></span></div>' +
      '<div class="field" data-field="member_id"><span class="lbl">Sitede akademik profiliniz var mı? (isteğe bağlı)</span><div data-picker></div><span class="hint" data-picked>Varsa adınızı arayıp seçin; yönetici onaylayınca profilinizi siz güncelleyebilirsiniz.</span><span class="err" hidden></span></div>' +
      '<div class="hp" aria-hidden="true"><label>Web sitesi<input type="text" name="website" tabindex="-1" autocomplete="off"></label></div>' +
      '<div class="field" data-field="accept"><label class="check"><input type="checkbox" name="accept"> <span><a href="/hakkinda.html#kosullar" target="_blank">Kullanım koşullarını</a> okudum, kabul ediyorum.</span></label><span class="err" hidden></span></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Üye ol</button><a href="#/giris">Zaten üye misiniz? Giriş yapın</a></div></form>';
    getSchema().then(function (s) { $("#r-ranks").innerHTML = s.ranks.map(function (r) { return '<option value="' + esc(r) + '">'; }).join(""); });
    var memberId = null;
    memberPicker($("[data-picker]", main), function (m) { memberId = m.id; $("[data-picked]", main).textContent = "Seçildi: " + m.name; });
    var f = $("form", main);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var b = $("button[type=submit]", f); busy(b, true);
      api("POST", "/auth/register", {
        name: f.name.value, title: f.title.value, university: f.university.value, email: f.email.value, password: f.password.value,
        member_id: memberId, accept: f.accept.checked, website: f.website.value
      }).then(function () { return refreshMe(); }).then(function () { toast("Hesabınız oluşturuldu."); go("#/"); })
        .catch(function (err) { busy(b, false); showFieldErrors(f, err.fields); fail(err); });
    });
  }

  function showFieldErrors(root, errs) {
    $$(".field", root).forEach(function (el) { el.classList.remove("has-err"); var e = $(".err", el); if (e) { e.hidden = true; } });
    Object.keys(errs || {}).forEach(function (k) {
      var el = $('[data-field="' + k + '"]', root); if (!el) return;
      el.classList.add("has-err"); var e = $(".err", el); if (e) { e.textContent = errs[k]; e.hidden = false; }
    });
  }

  function viewPassword(forced) {
    setTitle("Şifre değiştir");
    main.innerHTML = (forced ? '<div class="notice warn">Güvenliğiniz için geçici şifrenizi değiştirmeniz gerekiyor.</div>' : "") +
      '<h1 class="page-title">Şifre değiştir</h1><form class="form panel" novalidate>' +
      '<div class="field" data-field="current"><label for="p-cur">Mevcut şifre</label><input type="password" id="p-cur" name="current" autocomplete="current-password" required><span class="err" hidden></span></div>' +
      '<div class="field" data-field="password"><label for="p-new">Yeni şifre</label><input type="password" id="p-new" name="password" autocomplete="new-password" required minlength="10"><span class="hint">En az 10 karakter; harf ve rakam içermeli.</span><span class="err" hidden></span></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Şifreyi değiştir</button></div></form>';
    var f = $("form", main);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      var b = $("button[type=submit]", f); busy(b, true);
      api("POST", "/auth/password", { current: f.current.value, password: f.password.value }).then(function (j) {
        state.user = j.user; toast("Şifreniz değiştirildi."); go("#/");
      }).catch(function (err) { busy(b, false); showFieldErrors(f, err.fields); fail(err); });
    });
  }

  /* ---------------------------------------------------------------- üye görünümleri */
  function viewHome() {
    var u = state.user;
    setTitle("Özet");
    var own = can("kendi.profil") || can("kendi.eser");
    var notice = u.status === "pending"
      ? '<div class="notice warn"><strong>Üyeliğiniz onay bekliyor.</strong> Yönetici onayladığında yeni eser ve haber önerebilir, yorum yazabilirsiniz.</div>' : "";
    main.innerHTML = notice + '<h1 class="page-title">Hoş geldiniz, ' + esc(u.name.split(" ")[0]) + '</h1><p class="page-lead">Hesap türünüz: <span class="badge b-brand">' + esc(u.role_label || "Üye") + "</span> " +
      (own ? "Kendi profilinizi ve eserlerinizi onay beklemeden güncelleyebilirsiniz. Yeni eklemeleriniz yönetici onayından sonra yayınlanır."
        : "Yeni eser, haber ve akademisyen önerileriniz yönetici onayından sonra yayınlanır.") + "</p>" +
      '<div class="p-grid">' +
      '<a class="p-card" href="#/oneri/work"><span class="ic">' + IC.book + '</span><h3>Eser ekle</h3><p>Tez, kitap, makale ya da tebliğinizi özetiyle birlikte ekleyin.</p></a>' +
      '<a class="p-card" href="#/oneri/topic"><span class="ic">' + IC.news + '</span><h3>Haber gönder</h3><p>Yeni doktor, atama, sempozyum ve duyurularınızı paylaşın.</p></a>' +
      (own ? '<a class="p-card" href="#/eserlerim"><span class="ic">' + IC.user + '</span><h3>Eserlerim ve profilim</h3><p>Özgeçmişinizi ve eserlerinizi doğrudan güncelleyin.</p></a>'
        : '<a class="p-card" href="#/profil"><span class="ic">' + IC.user + "</span><h3>Akademik profilim</h3><p>" + (u.member_id ? "Profiliniz hesabınıza bağlı." : "Sitedeki profilinizi hesabınıza bağlayın; onaylanınca akademisyen olarak kendi kayıtlarınızı güncelleyebilirsiniz.") + "</p></a>") +
      '<a class="p-card" href="#/hesap"><span class="ic">' + IC.key + '</span><h3>Hesap ayarları</h3><p>Ad, unvan, kurum ve şifre.</p></a></div>' +
      '<h2 style="font-size:1.4rem">Son gönderileriniz</h2><div data-subs><p class="muted">Yükleniyor…</p></div>';
    loadMySubmissions($("[data-subs]", main), 5);
  }

  function loadMySubmissions(box, limit) {
    api("GET", "/my/submissions").then(function (j) {
      var items = limit ? j.items.slice(0, limit) : j.items;
      if (!items.length) { box.innerHTML = '<div class="empty">Henüz bir gönderiniz yok.</div>'; return; }
      box.innerHTML = '<div class="p-list">' + items.map(function (s) {
        var title = s.kind === "claim" ? "Profil sahipliği: " + (s.target_label || "") : (s.data.title || s.data.name || s.target_label || KIND_LABEL[s.kind]);
        return '<div class="p-item"><div class="grow"><div class="t">' + esc(title) + '</div><div class="s">' + esc(KIND_LABEL[s.kind]) + " · " +
          (s.target_id && s.kind !== "claim" ? "düzeltme" : s.kind === "claim" ? "talep" : "yeni kayıt") + " · " + when(s.created_at) +
          (s.admin_note ? " · Yönetici notu: " + esc(s.admin_note) : "") + "</div></div>" + badge(s.status) +
          (s.status === "pending" ? '<button class="btn btn-ghost btn-sm" data-withdraw="' + s.id + '">Geri çek</button>' : "") + "</div>";
      }).join("") + "</div>" + (limit && j.items.length > limit ? '<p style="margin-top:12px"><a class="link-arrow" href="#/gonderilerim">Tümünü gör</a></p>' : "");
      $$("[data-withdraw]", box).forEach(function (b) {
        b.addEventListener("click", function () {
          confirmBox("Bu gönderi geri çekilecek.", "Geri çek", true).then(function (y) {
            if (y) api("DELETE", "/my/submissions/" + b.dataset.withdraw).then(function () { toast("Gönderi geri çekildi."); loadMySubmissions(box, limit); }).catch(fail);
          });
        });
      });
    }).catch(fail);
  }

  function viewMySubmissions() {
    setTitle("Gönderilerim");
    main.innerHTML = '<h1 class="page-title">Gönderilerim</h1><p class="page-lead">Eklemeleriniz, düzeltme önerileriniz ve durumları.</p><div data-subs></div>';
    loadMySubmissions($("[data-subs]", main));
  }

  function viewAccount() {
    var u = state.user;
    setTitle("Hesap ayarları");
    main.innerHTML = '<h1 class="page-title">Hesap ayarları</h1><p class="page-lead">' + esc(u.email) + " · " + esc(u.role_label || "Üye") + " · " + badge(u.status) + "</p>" +
      '<form class="form panel" novalidate><h3>Bilgilerim</h3>' +
      '<div class="field" data-field="name"><label for="a-name">Ad Soyad</label><input type="text" id="a-name" name="name" value="' + esc(u.name) + '" maxlength="120" required><span class="err" hidden></span></div>' +
      '<div class="row2"><div class="field"><label for="a-title">Unvan</label><input type="text" id="a-title" name="title" value="' + esc(u.title) + '" maxlength="60"></div>' +
      '<div class="field"><label for="a-uni">Üniversite / Kurum</label><input type="text" id="a-uni" name="university" value="' + esc(u.university) + '" maxlength="160"></div></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Kaydet</button><a class="btn btn-ghost" href="#/sifre">Şifre değiştir</a></div></form>';
    var f = $("form", main);
    f.addEventListener("submit", function (e) {
      e.preventDefault();
      api("PATCH", "/auth/me", { name: f.name.value, title: f.title.value, university: f.university.value })
        .then(function (j) { state.user = j.user; renderChrome(location.hash); toast("Bilgileriniz kaydedildi."); })
        .catch(function (err) { showFieldErrors(f, err.fields); fail(err); });
    });
  }

  function viewProfile() {
    var u = state.user;
    if (u.member_id && can("kendi.profil")) return go("#/duzenle/member/" + u.member_id);
    setTitle("Akademik profilim");
    if (u.member_id) {
      main.innerHTML = '<h1 class="page-title">Akademik profilim</h1><div class="notice info">Profiliniz hesabınıza bağlı. Hesabınıza profil güncelleme yetkisi verilmediği için değişiklikleri site yöneticisine iletebilirsiniz.</div>' +
        '<p><a class="btn btn-ghost" href="/akademisyen/' + u.member_id + '.html">Profili görüntüle</a></p>';
      return;
    }
    main.innerHTML = '<h1 class="page-title">Akademik profilim</h1><p class="page-lead">Sitede adınıza bir akademisyen profili varsa bulup hesabınıza bağlanmasını isteyin. Yönetici onaylayınca <strong>Akademisyen</strong> grubuna geçer; kendi profilinizi ve eserlerinizi onay beklemeden güncelleyebilirsiniz. Profil yoksa yeni profil önerebilirsiniz.</p>' +
      '<div class="panel"><div data-picker></div><div class="form-actions" style="margin-top:16px"><a class="btn btn-ghost" href="#/oneri/member">Profilim yok, yeni profil öner</a></div></div>';
    memberPicker($("[data-picker]", main), function (m) { go("#/sahiplen/" + m.id); }, "Adınızı yazın…");
  }

  function viewClaim(id) {
    setTitle("Profil sahipliği");
    api("GET", "/items/member/" + id).then(function (j) {
      main.innerHTML = '<h1 class="page-title">Bu profil benim</h1><p class="page-lead"><strong>' + esc(j.label) + '</strong> profilinin size ait olduğunu bildiriyorsunuz. Yönetici onaylayınca profili hesabınızdan güncelleyebilirsiniz.</p>' +
        '<form class="form panel"><div class="field"><label for="c-note">Yöneticiye not (isteğe bağlı)</label><textarea id="c-note" name="note" maxlength="2000" placeholder="Örn. kurumsal e-posta adresiniz, kadro bilginiz…"></textarea></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Talep gönder</button><a class="btn btn-ghost" href="/akademisyen/' + id + '.html">Profili görüntüle</a></div></form>';
      var f = $("form", main);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        api("POST", "/submissions", { kind: "claim", target_id: id, note: f.note.value }).then(function () { toast("Talebiniz yöneticiye iletildi."); go("#/gonderilerim"); }).catch(fail);
      });
    }).catch(fail);
  }

  function viewSuggest(kind, id) {
    // Mevcut kayıtlar öneriyle değiştirilmez; sahibi ya da yetkili yönetici doğrudan düzenler.
    if (id != null) return go("#/duzenle/" + kind + "/" + id);
    var titles = { work: "Eser ekle", member: "Yeni akademisyen profili öner", topic: "Haber / duyuru gönder" };
    if (!titles[kind]) return viewNotFound();
    setTitle(titles[kind]);
    main.innerHTML = '<h1 class="page-title">' + esc(titles[kind]) + '</h1><p class="page-lead">Gönderiniz yönetici onayından sonra sitede yayınlanır.' +
      (kind === "work" ? " Onaylandıktan sonra bu eseri kendiniz de güncelleyebilirsiniz (Akademisyen grubundaysanız)." : "") + '</p>' +
      '<form class="form panel" novalidate><div class="form" data-fields><p class="muted">Form yükleniyor…</p></div>' +
      '<div class="field"><label for="s-note">Yöneticiye not (isteğe bağlı)</label><textarea id="s-note" name="note" maxlength="2000" placeholder="Kaynak, açıklama vb."></textarea></div>' +
      '<div class="form-actions"><button class="btn btn-primary" type="submit">Gönder</button></div></form>';
    buildForm($("[data-fields]", main), kind, kind === "topic" ? { forum: "haber" } : {}, {}).then(function (form) {
      var f = $("form", main);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var b = $("button[type=submit]", f); busy(b, true);
        api("POST", "/submissions", { kind: kind, data: form.values(), note: f.note.value })
          .then(function () { toast("Gönderiniz yöneticiye iletildi. Teşekkürler!"); go("#/gonderilerim"); })
          .catch(function (err) { busy(b, false); form.showErrors(err.fields); fail(err); });
      });
    }).catch(fail);
  }

  // Akademisyenin kendi profilini/eserini onaysız düzenlemesi; yetkili yönetici yönetim ekranına yönlendirilir.
  function viewOwnEdit(kind, id) {
    if (can("icerik." + kind)) return go("#/yonetim/icerik/" + kind + "/" + id);
    setTitle("Düzenle");
    main.innerHTML = '<p><a class="link-arrow" href="#/eserlerim">← Eserlerim ve profilim</a></p><h1 class="page-title" data-h>Düzenle</h1><div data-body><p class="muted">Yükleniyor…</p></div>';
    api("GET", "/my/items/" + kind + "/" + id).then(function (j) {
      $("[data-h]", main).textContent = j.label;
      $("[data-body]", main).innerHTML = '<p class="page-lead">Değişiklikleriniz kaydettiğinizde birkaç saniye içinde sitede yayınlanır ve işlem kayıtlarına düşer.</p>' +
        '<form class="form panel" novalidate><div class="form" data-fields></div><div class="form-actions"><button class="btn btn-primary" type="submit">Kaydet ve yayınla</button>' +
        '<a class="btn btn-ghost" target="_blank" href="/' + (kind === "work" ? "eser" : "akademisyen") + "/" + id + '.html">Sayfayı aç</a></div></form>';
      return buildForm($("[data-fields]", main), kind, j.values, {}).then(function (form) {
        var f = $("form", main);
        f.addEventListener("submit", function (e) {
          e.preventDefault();
          var b = $("button[type=submit]", f); busy(b, true);
          api("PUT", "/my/items/" + kind + "/" + id, { data: form.values() })
            .then(function () { busy(b, false); toast("Kaydedildi. Site birkaç saniye içinde güncellenecek."); })
            .catch(function (err) { busy(b, false); form.showErrors(err.fields); fail(err); });
        });
      });
    }).catch(function (err) {
      $("[data-body]", main).innerHTML = '<div class="notice warn">' + esc(err.message) + '</div><p><a class="btn btn-ghost" href="#/profil">Akademik profilim</a></p>';
    });
  }

  function viewMyItems() {
    setTitle("Eserlerim ve profilim");
    main.innerHTML = '<h1 class="page-title">Eserlerim ve profilim</h1><p class="page-lead">Kendi profilinizi, yazarı olduğunuz eserleri ve sizin eklediğiniz eserleri buradan onay beklemeden güncelleyebilirsiniz. Başkalarının eklediği kayıtlar listede yer almaz.</p><div data-l><p class="muted">Yükleniyor…</p></div>';
    api("GET", "/my/items").then(function (j) {
      var box = $("[data-l]", main);
      if (!j.items.length) {
        box.innerHTML = '<div class="empty">' + (state.user.member_id ? "Henüz size ait bir eser bulunamadı. Yeni eserlerinizi <a href=\"#/oneri/work\">Eser ekle</a> bölümünden önerebilirsiniz."
          : "Profiliniz henüz hesabınıza bağlı değil. <a href=\"#/profil\">Akademik profilim</a> bölümünden bağlatabilirsiniz.") + "</div>";
        return;
      }
      box.innerHTML = '<div class="p-list">' + j.items.map(function (it) {
        return '<a class="p-item" href="#/duzenle/' + it.kind + "/" + it.id + '"><span class="badge ' + (it.kind === "member" ? "b-brand" : "b-gold") + '">' + (it.kind === "member" ? "Profil" : "Eser") +
          '</span><div class="grow"><div class="t">' + esc(it.title) + '</div><div class="s">' + esc(it.sub) + (it.added ? " · sizin eklediğiniz" : "") + '</div></div><span class="btn btn-ghost btn-sm">Düzenle</span></a>';
      }).join("") + "</div>";
    }).catch(fail);
  }

  /* ---------------------------------------------------------------- yönetim */
  function viewAdminHome() {
    setTitle("Yönetim");
    api("GET", "/admin/stats").then(function (j) {
      var p = j.pending, c = j.counts, b = j.build;
      var stat = function (n, label, href, alert) { return '<a class="p-card p-stat' + (alert && n ? " alert" : "") + '" href="' + href + '"><b>' + n + "</b><span>" + label + "</span></a>"; };
      var todo = [];
      if (["onay.member", "onay.work", "onay.topic", "onay.claim"].some(can)) todo.push(stat(p.submissions, "Onay bekleyen gönderi", "#/yonetim/onaylar", true));
      if (can("uye.onay") || can("uye.yonet")) todo.push(stat(p.users, "Onay bekleyen üye", "#/yonetim/uyeler/pending", true));
      if (can("yorum.yonet")) todo.push(stat(p.comments, "Onay bekleyen yorum", "#/yonetim/yorumlar", true));
      main.innerHTML = '<h1 class="page-title">Yönetim özeti</h1><p class="page-lead">Rolünüz: <span class="badge b-brand">' + esc(state.user.role_label) + "</span> · " + state.user.perms.filter(function (x) { return x.indexOf("kendi.") !== 0; }).length + " yönetim yetkisi</p>" +
        (todo.length ? '<div class="p-grid">' + todo.join("") + "</div>" : "") +
        '<div class="p-grid">' + stat(c.member, "Akademisyen", can("icerik.member") ? "#/yonetim/icerik/member" : "/akademisyenler.html") + stat(c.work, "Eser", can("icerik.work") ? "#/yonetim/icerik/work" : "/eserler.html") +
        stat(c.topic, "Haber ve etkinlik", can("icerik.topic") ? "#/yonetim/icerik/topic" : "/haberler.html") + stat(c.users, "Etkin üye", (can("uye.onay") || can("uye.yonet")) ? "#/yonetim/uyeler/active" : "#/yonetim") +
        stat(c.staff, "Yetkili kişi", can("yetki.yonet") ? "#/yonetim/uyeler/yetkili" : "#/yonetim") + "</div>" +
        '<div class="panel" style="margin-bottom:18px"><h3>Site yayını</h3><p class="muted" style="margin:0">' + buildLine(b) + ' · <a href="#/yonetim/site">Ayrıntılar</a></p></div>' +
        (j.newUsers.length ? '<h2 style="font-size:1.3rem">Son kayıt olanlar</h2><div class="p-list" style="margin-bottom:18px">' + j.newUsers.map(function (u) {
          return '<a class="p-item" href="#/yonetim/uyeler"><span class="avatar">' + esc(initials(u.name)) + '</span><div class="grow"><div class="t">' + esc(u.name) + '</div><div class="s">' + esc(u.email) + " · " + when(u.created_at) + "</div></div>" + badge(u.status) + "</a>";
        }).join("") + "</div>" : "") +
        (j.recent.length ? '<h2 style="font-size:1.3rem">Son hareketler</h2><div class="p-table-wrap"><table class="p-table"><thead><tr><th>Zaman</th><th>Kişi</th><th>İşlem</th><th>Ayrıntı</th></tr></thead><tbody>' +
          j.recent.map(function (r) { return "<tr><td>" + when(r.at) + "</td><td>" + esc(r.name || "—") + "</td><td>" + esc(ACTION_LABEL[r.action] || r.action) + '</td><td class="sub">' + esc(r.detail) + "</td></tr>"; }).join("") +
          '</tbody></table></div><p style="margin-top:10px"><a class="link-arrow" href="#/yonetim/kayitlar">Tüm işlem kayıtları</a></p>' : "");
    }).catch(fail);
  }

  function buildLine(b) {
    if (b.running) return "Site şu anda yeniden üretiliyor…";
    if (!b.lastEnd) return "Henüz üretim yapılmadı.";
    return (b.ok ? "Son üretim başarılı" : "Son üretim BAŞARISIZ") + " · " + when(b.lastEnd) + (b.seconds ? " · " + b.seconds.toFixed(1) + " sn" : "");
  }

  function diffTable(s, fields) {
    var labels = {}; fields.forEach(function (f) { labels[f.key] = f; });
    var keys = Object.keys(s.data);
    if (!keys.length) return "";
    var show = function (k, v) { var f = labels[k]; if (v == null || v === "") return '<span class="muted">—</span>'; var t = f && f.type === "html" ? textOf(v) : String(v); return esc(t.length > 600 ? t.slice(0, 600) + "…" : t); };
    return '<table class="diff"><thead><tr><th>Alan</th>' + (s.current ? "<th>Şu anki</th>" : "") + "<th>Önerilen</th></tr></thead><tbody>" + keys.map(function (k) {
      return "<tr><td>" + esc((labels[k] || {}).label || k) + "</td>" + (s.current ? '<td class="old">' + show(k, s.current[k]) + "</td>" : "") + '<td class="new">' + show(k, s.data[k]) + "</td></tr>";
    }).join("") + "</tbody></table>";
  }

  function viewQueue(status) {
    status = status || "pending";
    setTitle("Onay kuyruğu");
    var tabs = '<nav class="tabs">' + [["pending", "Bekleyenler"], ["approved", "Onaylananlar"], ["rejected", "Reddedilenler"]].map(function (t) {
      return '<a href="#/yonetim/onaylar/' + t[0] + '"' + (t[0] === status ? ' aria-current="page"' : "") + ">" + t[1] + "</a>";
    }).join("") + "</nav>";
    main.innerHTML = '<h1 class="page-title">Onay kuyruğu</h1><p class="page-lead">Üyelerin eklemeleri ve düzeltme önerileri. Onaylamadan önce düzenleyebilirsiniz.</p>' + tabs + '<div data-q><p class="muted">Yükleniyor…</p></div>';
    Promise.all([api("GET", "/admin/submissions?status=" + status), getSchema()]).then(function (r) {
      var items = r[0].items, schema = r[1].schemas, box = $("[data-q]", main);
      if (!items.length) { box.innerHTML = '<div class="empty">' + (status === "pending" ? "Onay bekleyen gönderi yok." : "Kayıt yok.") + "</div>"; return; }
      box.innerHTML = items.map(function (s) {
        var title = s.kind === "claim" ? esc(s.user_name) + " → " + esc(s.target_label || "?") : esc(s.data.title || s.data.name || s.target_label || "(başlıksız)");
        var what = s.kind === "claim" ? "Profil sahipliği talebi" : KIND_LABEL[s.kind] + " · " + (s.target_id ? "düzeltme: " + esc(s.target_label || "#" + s.target_id) : "yeni kayıt");
        var body = s.kind === "claim"
          ? "<p><strong>" + esc(s.user_name) + "</strong> (" + esc(s.user_email) + '), <a href="/akademisyen/' + s.target_id + '.html" target="_blank">' + esc(s.target_label) + "</a> profilinin kendisine ait olduğunu bildiriyor." +
            (s.user_member_id ? " <em>Hesap şu an başka bir profile bağlı (#" + s.user_member_id + ").</em>" : "") + "</p>"
          : diffTable(s, schema[s.kind]);
        var actions = s.status === "pending"
          ? '<div class="form-actions"><button class="btn btn-primary btn-sm" data-approve="' + s.id + '">Onayla</button><button class="btn btn-danger btn-sm" data-reject="' + s.id + '">Reddet</button>' +
            (s.kind !== "claim" && s.target_id ? '<a class="btn btn-ghost btn-sm" target="_blank" href="/' + (s.kind === "work" ? "eser" : "akademisyen") + "/" + s.target_id + '.html">Sayfayı aç</a>' : "") + "</div>" +
            (s.kind !== "claim" ? '<details class="edit-before" data-edit="' + s.id + '"><summary>Onaylamadan önce düzenle</summary><div class="form" style="margin-top:14px" data-form></div></details>' : "")
          : '<p class="muted">' + badge(s.status) + " " + when(s.reviewed_at) + (s.admin_note ? " · Not: " + esc(s.admin_note) : "") + (s.result_id && s.kind !== "claim" ? ' · <a target="_blank" href="/' + (s.kind === "work" ? "eser" : s.kind === "topic" ? "haber" : "akademisyen") + "/" + s.result_id + '.html">Sayfa</a>' : "") + "</p>";
        return '<article class="review" data-id="' + s.id + '"><header><div><span class="badge b-indigo">' + what + "</span><h3>" + title + '</h3><div class="muted">' + esc(s.user_name) + " · " + esc(s.user_email) + " · " + when(s.created_at) +
          "</div></div>" + badge(s.status) + '</header><div class="body">' + (s.note ? '<div class="notice info"><strong>Üyenin notu:</strong> ' + esc(s.note) + "</div>" : "") + body + actions + "</div></article>";
      }).join("");
      var forms = {};
      $$("[data-edit]", box).forEach(function (d) {
        d.addEventListener("toggle", function () {
          if (!d.open || forms[d.dataset.edit]) return;
          var s = items.filter(function (x) { return String(x.id) === d.dataset.edit; })[0];
          var values = Object.assign({}, s.current || {}, s.data);
          buildForm($("[data-form]", d), s.kind, values, { admin: true }).then(function (f) { forms[s.id] = f; });
        });
      });
      $$("[data-approve]", box).forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.dataset.approve, form = forms[id];
          busy(b, true);
          api("POST", "/admin/submissions/" + id + "/approve", form ? { data: form.values() } : {}).then(function () {
            toast("Onaylandı. Site birkaç saniye içinde güncellenecek.");
            return refreshMe();
          }).then(function () { renderChrome(location.hash); viewQueue(status); }).catch(function (err) { busy(b, false); if (form) form.showErrors(err.fields); fail(err); });
        });
      });
      $$("[data-reject]", box).forEach(function (b) {
        b.addEventListener("click", function () {
          dialog('<h3>Gönderiyi reddet</h3><form class="form"><div class="field"><label for="rj">Üyeye not (isteğe bağlı)</label><textarea id="rj" maxlength="1000" placeholder="Reddetme gerekçesi"></textarea></div>' +
            '<div class="form-actions"><button class="btn btn-danger" type="submit">Reddet</button><button class="btn btn-ghost" type="button" data-close>Vazgeç</button></div></form>', function (d) {
            $("form", d).addEventListener("submit", function (e) {
              e.preventDefault();
              api("POST", "/admin/submissions/" + b.dataset.reject + "/reject", { admin_note: $("#rj", d).value }).then(function () {
                d.close(); toast("Gönderi reddedildi."); return refreshMe();
              }).then(function () { renderChrome(location.hash); viewQueue(status); }).catch(fail);
            });
          });
        });
      });
    }).catch(fail);
  }

  function viewUsers(filter) {
    setTitle("Üyeler");
    filter = filter || "";
    var tabs = '<nav class="tabs">' + [["", "Tümü"], ["pending", "Onay bekleyen"], ["active", "Etkin"], ["blocked", "Engelli"], ["yetkili", "Yetkililer"]].map(function (t) {
      return '<a href="#/yonetim/uyeler' + (t[0] ? "/" + t[0] : "") + '"' + (filter === t[0] ? ' aria-current="page"' : "") + ">" + t[1] + "</a>";
    }).join("") + "</nav>";
    main.innerHTML = '<h1 class="page-title">Üyeler</h1><p class="page-lead">Hesapları onaylayın, rol verin, düzenleyin ve akademisyen profillerine bağlayın.</p>' + tabs +
      '<div class="toolbar-row"><label class="input">' + svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>') + '<input type="search" data-q placeholder="Ad, e-posta ya da kurum ara…" aria-label="Üye ara"></label>' +
      '<select class="select" data-role aria-label="Rol"><option value="">Tüm roller</option></select>' +
      (can("disa.aktar") && can("uye.yonet") ? '<a class="btn btn-ghost btn-sm" href="/api/admin/export/uyeler" download>CSV indir</a>' : "") + "</div>" +
      '<div data-bulk></div><div data-u><p class="muted">Yükleniyor…</p></div>';
    var roles = [], t;
    var load = function () {
      var qs = [];
      if (filter === "yetkili") qs.push("staff=1"); else if (filter) qs.push("status=" + filter);
      var role = $("[data-role]", main).value; if (role) qs.push("role=" + encodeURIComponent(role));
      var q = $("[data-q]", main).value.trim(); if (q) qs.push("q=" + encodeURIComponent(q));
      api("GET", "/admin/users?" + qs.join("&")).then(draw).catch(fail);
    };
    api("GET", "/admin/roles").then(function (r) {
      roles = r.roles;
      $("[data-role]", main).insertAdjacentHTML("beforeend", roles.map(function (x) { return '<option value="' + esc(x.key) + '">' + esc(x.label) + "</option>"; }).join(""));
      try { var pre = sessionStorage.getItem("mz-rol-filtre"); if (pre) { $("[data-role]", main).value = pre; sessionStorage.removeItem("mz-rol-filtre"); } } catch (e) {}
    }).catch(function () {}).then(load);
    $("[data-q]", main).addEventListener("input", function () { clearTimeout(t); t = setTimeout(load, 250); });
    $("[data-role]", main).addEventListener("change", load);

    function draw(j) {
      var box = $("[data-u]", main), bulk = $("[data-bulk]", main);
      var pend = j.items.filter(function (u) { return u.status === "pending"; });
      bulk.innerHTML = pend.length > 1 && (can("uye.onay") || can("uye.yonet"))
        ? '<div class="notice info" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>' + pend.length + ' üyelik başvurusu bekliyor.</span><button class="btn btn-primary btn-sm" data-bulk-approve>Tümünü onayla</button></div>' : "";
      var ba = $("[data-bulk-approve]", bulk);
      ba && ba.addEventListener("click", function () {
        confirmBox(pend.length + " üyelik başvurusu onaylanacak.", "Tümünü onayla").then(function (y) {
          if (y) api("POST", "/admin/users/bulk-approve", { ids: pend.map(function (u) { return u.id; }) }).then(function (r) { toast(r.approved + " üye onaylandı."); refresh(); }).catch(fail);
        });
      });
      if (!j.items.length) { box.innerHTML = '<div class="empty">Kayıt yok.</div>'; return; }
      box.innerHTML = '<div class="p-table-wrap"><table class="p-table"><thead><tr><th>Üye</th><th>Rol</th><th>Durum</th><th>Profil</th><th>Kayıt / son giriş</th><th>İşlemler</th></tr></thead><tbody>' +
        j.items.map(function (u) {
          var me = u.id === state.user.id;
          var roleCell = can("yetki.yonet") && !me && u.manageable
            ? '<select class="select" data-set-role style="height:36px;font-size:.85rem">' + roles.map(function (r) {
                return '<option value="' + esc(r.key) + '"' + (r.key === u.role_key ? " selected" : "") + ">" + esc(r.label) + "</option>"; }).join("") + "</select>"
            : '<span class="badge' + (u.role_key !== "uye" ? " b-indigo" : "") + '">' + esc(u.role_label) + "</span>";
          var acts = "";
          if (u.status === "pending" && (can("uye.onay") || can("uye.yonet"))) acts += '<button class="btn btn-primary btn-sm" data-act="approve">Onayla</button>';
          if (can("uye.yonet") && !me && u.manageable) {
            acts += u.status === "blocked" ? '<button class="btn btn-ghost btn-sm" data-act="unblock">Engeli kaldır</button>' : '<button class="btn btn-ghost btn-sm" data-act="block">Engelle</button>';
          }
          if (can("uye.yonet") && (me || u.manageable)) acts += '<button class="btn btn-ghost btn-sm" data-act="edit">Düzenle</button><button class="btn btn-ghost btn-sm" data-act="link">Profile bağla</button>';
          if (can("uye.yonet") && !me && u.manageable) acts += '<button class="btn btn-ghost btn-sm" data-act="reset">Geçici şifre</button><button class="btn btn-danger btn-sm" data-act="delete">Sil</button>';
          return '<tr data-id="' + u.id + '"><td><strong>' + esc(u.name) + (me ? ' <span class="sub">(siz)</span>' : "") + '</strong><div class="sub">' + esc(u.email) + '</div><div class="sub">' +
            esc([u.title, u.university].filter(Boolean).join(" · ")) + '</div><div class="sub">' + u.submission_count + " gönderi · " + u.comment_count + " yorum</div></td><td>" + roleCell + "</td><td>" + badge(u.status) + "</td><td>" +
            (u.member_name ? '<a href="/akademisyen/' + u.member_id + '.html" target="_blank">' + esc(u.member_name) + "</a>" : '<span class="sub">Bağlı değil</span>') +
            '</td><td class="sub">' + when(u.created_at) + "<br>" + (u.last_login ? when(u.last_login) : "—") + '</td><td><div class="actions">' + (acts || '<span class="sub">—</span>') + "</div></td></tr>";
        }).join("") + "</tbody></table></div>";
      $$("[data-set-role]", box).forEach(function (sel) {
        var prev = sel.value;
        sel.addEventListener("change", function () {
          var u = byId(sel.closest("tr").dataset.id), r = roles.filter(function (x) { return x.key === sel.value; })[0];
          confirmBox(u.name + " kişisinin rolü \"" + r.label + "\" olacak. Bu rol " + (r.all ? "tüm yetkileri" : r.perms.length + " yetkiyi") + " içerir.", "Rolü değiştir").then(function (y) {
            if (!y) { sel.value = prev; return; }
            api("PATCH", "/admin/users/" + u.id, { role_key: sel.value }).then(function () { toast("Rol güncellendi."); prev = sel.value; refresh(); }).catch(function (e) { sel.value = prev; fail(e); });
          });
        });
      });
      $$("[data-act]", box).forEach(function (b) {
        b.addEventListener("click", function () { act(byId(b.closest("tr").dataset.id), b.dataset.act); });
      });
      function byId(id) { return j.items.filter(function (x) { return String(x.id) === String(id); })[0]; }
    }
    function refresh() { refreshMe().then(function () { renderChrome(location.hash.replace(/\?.*/, "")); load(); }); }
    function act(u, a) {
      var patch = function (body, msg) { api("PATCH", "/admin/users/" + u.id, body).then(function () { toast(msg); refresh(); }).catch(fail); };
      if (a === "approve" || a === "unblock") patch({ status: "active" }, a === "approve" ? "Üyelik onaylandı." : "Engel kaldırıldı.");
      else if (a === "block") confirmBox(u.name + " engellenecek ve oturumları kapatılacak.", "Engelle", true).then(function (y) { if (y) patch({ status: "blocked" }, "Üye engellendi."); });
      else if (a === "delete") confirmBox(u.name + " hesabı ve tüm gönderileri/yorumları kalıcı olarak silinecek.", "Kalıcı olarak sil", true).then(function (y) {
        if (y) api("DELETE", "/admin/users/" + u.id).then(function () { toast("Hesap silindi."); refresh(); }).catch(fail);
      });
      else if (a === "reset") confirmBox(u.name + " için geçici şifre üretilecek; mevcut oturumları kapanacak.", "Şifre üret").then(function (y) {
        if (y) api("POST", "/admin/users/" + u.id + "/reset-password").then(function (r) {
          dialog("<h3>Geçici şifre</h3><p>Bu şifreyi " + esc(u.name) + ' ile güvenli bir yoldan paylaşın. İlk girişte değiştirmesi istenecek. Bu pencere kapanınca şifre bir daha gösterilmez.</p><div class="temp-pass">' +
            esc(r.temporary_password) + '</div><div class="form-actions" style="margin-top:16px"><button class="btn btn-primary" data-close>Tamam</button></div>');
        }).catch(fail);
      });
      else if (a === "edit") dialog('<h3>Üye bilgileri</h3><form class="form" novalidate>' +
        '<div class="field" data-field="name"><label for="e-name">Ad Soyad</label><input type="text" id="e-name" name="name" value="' + esc(u.name) + '" maxlength="120"><span class="err" hidden></span></div>' +
        '<div class="field" data-field="email"><label for="e-mail">E-posta</label><input type="email" id="e-mail" name="email" value="' + esc(u.email) + '"><span class="err" hidden></span></div>' +
        '<div class="row2"><div class="field"><label for="e-title">Unvan</label><input type="text" id="e-title" name="title" value="' + esc(u.title) + '" maxlength="60"></div>' +
        '<div class="field"><label for="e-uni">Kurum</label><input type="text" id="e-uni" name="university" value="' + esc(u.university) + '" maxlength="160"></div></div>' +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Kaydet</button><button class="btn btn-ghost" type="button" data-close>Vazgeç</button></div></form>', function (d) {
        var f = $("form", d);
        f.addEventListener("submit", function (e) {
          e.preventDefault();
          api("PATCH", "/admin/users/" + u.id, { name: f.name.value, email: f.email.value, title: f.title.value, university: f.university.value })
            .then(function () { d.close(); toast("Bilgiler kaydedildi."); refresh(); }).catch(function (err) { showFieldErrors(f, err.fields); fail(err); });
        });
      });
      else if (a === "link") dialog("<h3>Akademisyen profiline bağla</h3><p>" + esc(u.name) + ' hesabının yöneteceği profili seçin. Bağlanan üye, Akademisyen grubundaysa bu profili kendisi güncelleyebilir.</p><div data-p></div><div class="form-actions" style="margin-top:16px">' +
        (u.member_id ? '<button class="btn btn-danger btn-sm" data-unlink>Bağlantıyı kaldır</button>' : "") + '<button class="btn btn-ghost" data-close>Kapat</button></div>', function (d) {
        memberPicker($("[data-p]", d), function (m) { api("PATCH", "/admin/users/" + u.id, { member_id: m.id }).then(function () { d.close(); toast("Profil bağlandı: " + m.name); refresh(); }).catch(fail); });
        var ul = $("[data-unlink]", d);
        ul && ul.addEventListener("click", function () { api("PATCH", "/admin/users/" + u.id, { member_id: null }).then(function () { d.close(); toast("Bağlantı kaldırıldı."); refresh(); }).catch(fail); });
      });
    }
  }

  function viewRoles() {
    setTitle("Roller ve yetkiler");
    main.innerHTML = '<h1 class="page-title">Roller ve yetkiler</h1><p class="page-lead">Her üyenin bir rolü vardır. Bir role istediğiniz yetkileri verip istediğiniz kadar kişiye atayabilirsiniz. Kendinizde olmayan bir yetkiyi başkasına veremezsiniz; Süper Yönetici ve Üye rolleri sabittir.</p>' +
      '<div class="form-actions" style="margin-bottom:16px"><button class="btn btn-primary btn-sm" data-new>Yeni rol</button><a class="btn btn-ghost btn-sm" href="#/yonetim/uyeler/yetkili">Yetkili kişiler</a></div><div data-r><p class="muted">Yükleniyor…</p></div>';
    var data;
    var load = function () { api("GET", "/admin/roles").then(function (j) { data = j; draw(); }).catch(fail); };
    var groups = function () {
      var g = {};
      Object.keys(data.perms).forEach(function (k) { var p = data.perms[k]; (g[p.group] = g[p.group] || []).push(k); });
      return g;
    };
    function draw() {
      $("[data-r]", main).innerHTML = data.roles.map(function (r) {
        return '<article class="review"><header><div><h3 style="margin-top:0">' + esc(r.label) + (r.system ? ' <span class="badge">sabit</span>' : "") + '</h3><div class="muted">' + esc(r.description || "") + '</div></div><div class="form-actions" style="padding:0">' +
          '<a class="btn btn-ghost btn-sm" href="#/yonetim/uyeler?rol=' + esc(r.key) + '" data-filter-role="' + esc(r.key) + '">' + r.users + " kişi</a>" +
          (!r.system ? '<button class="btn btn-ghost btn-sm" data-edit="' + esc(r.key) + '">Düzenle</button><button class="btn btn-danger btn-sm" data-del="' + esc(r.key) + '">Sil</button>' : "") +
          '</div></header><div class="body">' + (r.all ? '<span class="badge b-brand">Tüm yetkiler</span>' : r.perms.length ? r.perms.map(function (p) {
            return '<span class="badge" style="margin:0 6px 6px 0">' + esc((data.perms[p] || {}).label || p) + "</span>"; }).join("") : '<span class="muted">Yönetim yetkisi yok.</span>') + "</div></article>";
      }).join("");
      $$("[data-edit]", main).forEach(function (b) { b.addEventListener("click", function () { edit(data.roles.filter(function (r) { return r.key === b.dataset.edit; })[0]); }); });
      $$("[data-del]", main).forEach(function (b) {
        b.addEventListener("click", function () {
          confirmBox("\"" + b.dataset.del + "\" rolü silinecek.", "Sil", true).then(function (y) {
            if (y) api("DELETE", "/admin/roles/" + b.dataset.del).then(function () { toast("Rol silindi."); load(); }).catch(fail);
          });
        });
      });
      $$("[data-filter-role]", main).forEach(function (a) { a.addEventListener("click", function (e) { e.preventDefault(); sessionStorage.setItem("mz-rol-filtre", a.dataset.filterRole); go("#/yonetim/uyeler"); }); });
    }
    function edit(r) {
      var g = groups(), mine = state.user.perms;
      dialog('<h3>' + (r ? "Rolü düzenle" : "Yeni rol") + '</h3><form class="form" novalidate>' +
        '<div class="field" data-field="label"><label for="r-label">Rol adı</label><input type="text" id="r-label" name="label" maxlength="40" value="' + esc(r ? r.label : "") + '" required><span class="err" hidden></span></div>' +
        '<div class="field"><label for="r-desc">Açıklama</label><input type="text" id="r-desc" name="description" maxlength="200" value="' + esc(r ? r.description : "") + '"></div>' +
        Object.keys(g).map(function (gr) {
          return '<fieldset class="perm-group"><legend>' + esc(gr) + "</legend>" + g[gr].map(function (p) {
            var off = mine.indexOf(p) < 0;
            return '<label class="check' + (off ? " is-off" : "") + '"><input type="checkbox" name="perm" value="' + esc(p) + '"' + (r && r.perms.indexOf(p) > -1 ? " checked" : "") + (off ? " disabled" : "") + "> <span>" +
              esc(data.perms[p].label) + (off ? ' <em class="sub">(sizde yok)</em>' : "") + "</span></label>";
          }).join("") + "</fieldset>";
        }).join("") +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Kaydet</button><button class="btn btn-ghost" type="button" data-close>Vazgeç</button></div></form>', function (d) {
        d.classList.add("wide");
        var f = $("form", d);
        f.addEventListener("submit", function (e) {
          e.preventDefault();
          var body = { label: f.label.value, description: f.description.value, perms: $$('input[name="perm"]:checked', f).map(function (x) { return x.value; }) };
          (r ? api("PUT", "/admin/roles/" + r.key, body) : api("POST", "/admin/roles", body))
            .then(function () { d.close(); toast(r ? "Rol güncellendi." : "Rol oluşturuldu."); load(); }).catch(function (err) { showFieldErrors(f, err.fields); fail(err); });
        });
      });
    }
    $("[data-new]", main).addEventListener("click", function () { edit(null); });
    load();
  }

  function viewSettings(tab) {
    setTitle("Site ayarları");
    main.innerHTML = '<h1 class="page-title">Site ayarları</h1><p class="page-lead">Sitenin metinlerini, duyurularını ve davranışını buradan yönetin. Site metinleriyle ilgili değişiklikler kaydedince birkaç saniye içinde yayınlanır.</p><div data-s><p class="muted">Yükleniyor…</p></div>';
    api("GET", "/admin/settings").then(function (j) {
      var g = j.groups.filter(function (x) { return x.key === tab; })[0] || j.groups[0];
      var tabs = '<nav class="tabs">' + j.groups.map(function (x) { return '<a href="#/yonetim/ayarlar/' + x.key + '"' + (x === g ? ' aria-current="page"' : "") + ">" + esc(x.label) + "</a>"; }).join("") + "</nav>";
      var field = function (f) {
        var v = j.values[f.key], id = "st-" + f.key;
        var lbl = '<label for="' + id + '">' + esc(f.label) + "</label>";
        if (f.type === "bool") return '<div class="field" data-field="' + f.key + '"><label class="check"><input type="checkbox" id="' + id + '" name="' + f.key + '"' + (v ? " checked" : "") + "> <span>" + esc(f.label) + '</span></label><span class="err" hidden></span></div>';
        if (f.type === "textarea") return '<div class="field" data-field="' + f.key + '">' + lbl + '<textarea id="' + id + '" name="' + f.key + '" maxlength="' + (f.max || 1000) + '">' + esc(v) + '</textarea><span class="err" hidden></span></div>';
        if (f.type === "lines") return '<div class="field" data-field="' + f.key + '">' + lbl + '<textarea id="' + id + '" name="' + f.key + '" rows="5">' + esc((v || []).join("\n")) + '</textarea><span class="err" hidden></span></div>';
        if (f.type === "select") return '<div class="field" data-field="' + f.key + '">' + lbl + '<select id="' + id + '" name="' + f.key + '">' + f.options.map(function (o) {
          return '<option value="' + esc(o) + '"' + (o === v ? " selected" : "") + ">" + esc((f.labels || {})[o] || o) + "</option>"; }).join("") + '</select><span class="err" hidden></span></div>';
        var type = { number: "number", url: "url", email: "email" }[f.type] || "text";
        return '<div class="field" data-field="' + f.key + '">' + lbl + '<input type="' + type + '" id="' + id + '" name="' + f.key + '" value="' + esc(v == null ? "" : v) + '"' +
          (f.max && type !== "number" ? ' maxlength="' + f.max + '"' : "") + (type === "number" ? ' min="' + f.min + '" max="' + f.max + '" step="' + (f.step || 1) + '"' : "") + '><span class="err" hidden></span></div>';
      };
      $("[data-s]", main).innerHTML = tabs + '<form class="form panel" novalidate>' + g.fields.map(field).join("") +
        '<div class="form-actions"><button class="btn btn-primary" type="submit">Kaydet</button>' + (g.key === "duyuru" || g.key === "anasayfa" || g.key === "genel" ? '<a class="btn btn-ghost" href="/index.html" target="_blank">Siteyi aç</a>' : "") + "</div></form>";
      var f = $("form", main);
      f.addEventListener("submit", function (e) {
        e.preventDefault();
        var values = {};
        g.fields.forEach(function (fd) { var el = f.elements[fd.key]; values[fd.key] = fd.type === "bool" ? el.checked : el.value; });
        var b = $("button[type=submit]", f); busy(b, true);
        api("PUT", "/admin/settings", { values: values }).then(function (r) {
          busy(b, false); showFieldErrors(f, {});
          toast(r.changed.length ? "Ayarlar kaydedildi." : "Değişiklik yok.");
        }).catch(function (err) { busy(b, false); showFieldErrors(f, err.fields); fail(err); });
      });
    }).catch(fail);
  }

  var ACTION_LABEL = {
    giris: "Giriş", kayit: "Yeni kayıt", "sifre-degisti": "Şifre değiştirdi", gonderi: "Öneri gönderdi", yorum: "Yorum yazdı", yukleme: "Dosya yükledi",
    onay: "Öneriyi onayladı", red: "Öneriyi reddetti", "uye-guncelle": "Üyeyi güncelledi", "uye-toplu-onay": "Toplu üye onayı", "uye-sil": "Üyeyi sildi",
    "sifre-sifirla": "Şifre sıfırladı", "rol-ekle": "Rol ekledi", "rol-duzenle": "Rolü düzenledi", "rol-sil": "Rolü sildi", ayar: "Ayar değiştirdi",
    "icerik-ekle": "Kayıt ekledi", "icerik-duzenle": "Kaydı düzenledi", "icerik-sil": "Kaydı sildi", "icerik-geri-getir": "Kaydı geri getirdi",
    "kendi-guncelle": "Kendi kaydını güncelledi", "yorum-visible": "Yorumu yayınladı", "yorum-hidden": "Yorumu gizledi", "yorum-sil": "Yorumu sildi",
    "site-uret": "Siteyi yeniden üretti", "disa-aktar": "Dışa aktardı", "icerik-yenile": "İçerik yenilendi", "ilk-yonetici": "İlk yönetici oluşturuldu"
  };

  function viewLogs() {
    setTitle("İşlem kayıtları");
    main.innerHTML = '<h1 class="page-title">İşlem kayıtları</h1><p class="page-lead">Sitede kimin, ne zaman, ne yaptığının kaydı.</p>' +
      '<div class="toolbar-row"><label class="input">' + svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>') + '<input type="search" data-q placeholder="Kişi ya da ayrıntı ara…" aria-label="Kayıt ara"></label>' +
      '<select class="select" data-action aria-label="İşlem türü"><option value="">Tüm işlemler</option></select></div><div data-l><p class="muted">Yükleniyor…</p></div>';
    var offset = 0, t, first = true;
    var load = function () {
      var qs = "offset=" + offset, a = $("[data-action]", main).value, q = $("[data-q]", main).value.trim();
      if (a) qs += "&action=" + encodeURIComponent(a);
      if (q) qs += "&q=" + encodeURIComponent(q);
      api("GET", "/admin/logs?" + qs).then(function (j) {
        if (first) {
          first = false;
          $("[data-action]", main).insertAdjacentHTML("beforeend", j.actions.map(function (x) { return '<option value="' + esc(x.action) + '">' + esc(ACTION_LABEL[x.action] || x.action) + " (" + x.n + ")</option>"; }).join(""));
        }
        var box = $("[data-l]", main);
        if (!j.items.length) { box.innerHTML = '<div class="empty">Kayıt yok.</div>'; return; }
        box.innerHTML = '<p class="muted">' + j.total + " kayıt · " + (offset + 1) + "–" + Math.min(offset + 100, j.total) + ' gösteriliyor</p><div class="p-table-wrap"><table class="p-table"><thead><tr><th>Zaman</th><th>Kişi</th><th>İşlem</th><th>Ayrıntı</th></tr></thead><tbody>' +
          j.items.map(function (r) { return "<tr><td style=\"white-space:nowrap\">" + when(r.at) + "</td><td>" + esc(r.name || "Sistem") + '<div class="sub">' + esc(r.email || "") + "</div></td><td>" + esc(ACTION_LABEL[r.action] || r.action) + '</td><td class="sub">' + esc(r.detail) + "</td></tr>"; }).join("") +
          '</tbody></table></div><div class="form-actions" style="justify-content:center;margin-top:14px">' + (offset > 0 ? '<button class="btn btn-ghost btn-sm" data-prev>Daha yeni</button>' : "") +
          (offset + 100 < j.total ? '<button class="btn btn-ghost btn-sm" data-next>Daha eski</button>' : "") + "</div>";
        var p = $("[data-prev]", box), n = $("[data-next]", box);
        p && p.addEventListener("click", function () { offset -= 100; load(); window.scrollTo(0, 0); });
        n && n.addEventListener("click", function () { offset += 100; load(); window.scrollTo(0, 0); });
      }).catch(fail);
    };
    $("[data-q]", main).addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { offset = 0; load(); }, 300); });
    $("[data-action]", main).addEventListener("change", function () { offset = 0; load(); });
    load();
  }

  function viewTrash() {
    setTitle("Geri dönüşüm kutusu");
    main.innerHTML = '<h1 class="page-title">Geri dönüşüm kutusu</h1><p class="page-lead">Silinen akademisyen, eser ve haber kayıtları burada durur; geri getirdiğinizde sitede yeniden yayınlanır.</p><div data-l><p class="muted">Yükleniyor…</p></div>';
    var load = function () {
      api("GET", "/admin/trash").then(function (j) {
        var box = $("[data-l]", main);
        if (!j.items.length) { box.innerHTML = '<div class="empty">Geri dönüşüm kutusu boş.</div>'; return; }
        box.innerHTML = '<div class="p-list">' + j.items.map(function (it) {
          return '<div class="p-item"><span class="badge">' + esc(KIND_LABEL[it.kind] || it.kind) + '</span><div class="grow"><div class="t">' + esc(it.title) + '</div><div class="s">#' + it.id + " · " + esc(it.sub) +
            " · silinme: " + when(it.deleted_at) + (it.by_name ? " · " + esc(it.by_name) : "") + '</div></div><button class="btn btn-ghost btn-sm" data-restore="' + it.kind + "/" + it.id + '">Geri getir</button></div>';
        }).join("") + "</div>";
        $$("[data-restore]", box).forEach(function (b) {
          b.addEventListener("click", function () { api("POST", "/admin/trash/" + b.dataset.restore + "/restore").then(function () { toast("Kayıt geri getirildi."); load(); }).catch(fail); });
        });
      }).catch(fail);
    };
    load();
  }

  var CONTENT = { member: ["Akademisyenler", "akademisyen"], work: ["Eserler", "eser"], topic: ["Haber ve etkinlikler", "haber"] };

  function viewContentList(kind, q, offset) {
    if (!CONTENT[kind]) return viewNotFound();
    setTitle(CONTENT[kind][0]);
    offset = offset || 0;
    var exp = { member: "akademisyenler", work: "eserler" }[kind];
    main.innerHTML = '<h1 class="page-title">' + CONTENT[kind][0] + '</h1><p class="page-lead">Kayıtları doğrudan düzenleyin; değişiklikler kaydedince sitede yayınlanır.</p>' +
      '<div class="toolbar-row"><label class="input">' + svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>') + '<input type="search" placeholder="Ara…" value="' + esc(q || "") + '" aria-label="Ara"></label>' +
      '<a class="btn btn-primary btn-sm" href="#/yonetim/icerik/' + kind + '/yeni">Yeni ekle</a>' + (exp && can("disa.aktar") ? '<a class="btn btn-ghost btn-sm" href="/api/admin/export/' + exp + '" download>CSV indir</a>' : "") +
      '</div><div data-l><p class="muted">Yükleniyor…</p></div>';
    var input = $("input", main), t;
    input.addEventListener("input", function () { clearTimeout(t); t = setTimeout(function () { load(input.value, 0); }, 250); });
    function load(query, off) {
      api("GET", "/admin/items/" + kind + "?q=" + encodeURIComponent(query || "") + "&offset=" + off).then(function (j) {
        var box = $("[data-l]", main);
        if (!j.items.length) { box.innerHTML = '<div class="empty">Kayıt bulunamadı.</div>'; return; }
        box.innerHTML = '<p class="muted">' + j.total + " kayıt" + (j.total > 50 ? " · " + (off + 1) + "–" + Math.min(off + 50, j.total) + " gösteriliyor" : "") + '</p><div class="p-list">' +
          j.items.map(function (it) {
            return '<a class="p-item" href="#/yonetim/icerik/' + kind + "/" + it.id + '"><div class="grow"><div class="t">' + esc(it.title) + '</div><div class="s">#' + it.id + " · " + esc(it.sub) + "</div></div></a>";
          }).join("") + '</div><div class="form-actions" style="justify-content:center;margin-top:14px">' +
          (off > 0 ? '<button class="btn btn-ghost btn-sm" data-prev>Önceki</button>' : "") + (off + 50 < j.total ? '<button class="btn btn-ghost btn-sm" data-next>Sonraki</button>' : "") + "</div>";
        var p = $("[data-prev]", box), n = $("[data-next]", box);
        p && p.addEventListener("click", function () { load(query, off - 50); window.scrollTo(0, 0); });
        n && n.addEventListener("click", function () { load(query, off + 50); window.scrollTo(0, 0); });
      }).catch(fail);
    }
    load(q, offset);
  }

  function viewContentEdit(kind, id) {
    if (!CONTENT[kind]) return viewNotFound();
    var isNew = id === "yeni";
    setTitle(isNew ? "Yeni kayıt" : "Düzenle");
    main.innerHTML = '<p><a class="link-arrow" href="#/yonetim/icerik/' + kind + '">← ' + CONTENT[kind][0] + '</a></p><h1 class="page-title" data-h>' + (isNew ? "Yeni kayıt" : "Düzenle") + "</h1>" +
      '<form class="form panel" novalidate><div class="form" data-fields><p class="muted">Yükleniyor…</p></div><div class="form-actions"><button class="btn btn-primary" type="submit">Kaydet ve yayınla</button>' +
      (isNew ? "" : '<a class="btn btn-ghost" target="_blank" href="/' + CONTENT[kind][1] + "/" + id + '.html">Sayfayı aç</a>' + (can("icerik.sil") ? '<button class="btn btn-danger" type="button" data-del>Sil</button>' : "")) + "</div></form>";
    var load = isNew ? Promise.resolve({ values: kind === "topic" ? { forum: "haber" } : kind === "member" ? { group: "Öğretim Elemanları" } : {} }) : api("GET", "/items/" + kind + "/" + id);
    load.then(function (j) {
      if (!isNew) $("[data-h]", main).textContent = j.label;
      return buildForm($("[data-fields]", main), kind, j.values, { admin: true }).then(function (form) {
        var f = $("form", main);
        f.addEventListener("submit", function (e) {
          e.preventDefault();
          var b = $("button[type=submit]", f); busy(b, true);
          (isNew ? api("POST", "/admin/items/" + kind, { data: form.values() }) : api("PUT", "/admin/items/" + kind + "/" + id, { data: form.values() }))
            .then(function (r) { busy(b, false); toast("Kaydedildi. Site birkaç saniye içinde güncellenecek."); if (isNew) go("#/yonetim/icerik/" + kind + "/" + r.id); })
            .catch(function (err) { busy(b, false); form.showErrors(err.fields); fail(err); });
        });
        var del = $("[data-del]", main);
        del && del.addEventListener("click", function () {
          confirmBox("Bu kayıt siteden kaldırılacak.", "Sil", true).then(function (y) {
            if (y) api("DELETE", "/admin/items/" + kind + "/" + id).then(function () { toast("Kayıt silindi."); go("#/yonetim/icerik/" + kind); }).catch(fail);
          });
        });
      });
    }).catch(fail);
  }

  function viewComments(status) {
    status = status || "pending";
    setTitle("Yorumlar");
    var tabs = '<nav class="tabs">' + [["pending", "Onay bekleyen"], ["visible", "Yayında"], ["hidden", "Gizlenen"]].map(function (t) {
      return '<a href="#/yonetim/yorumlar/' + t[0] + '"' + (t[0] === status ? ' aria-current="page"' : "") + ">" + t[1] + "</a>";
    }).join("") + "</nav>";
    main.innerHTML = '<h1 class="page-title">Yorumlar</h1><p class="page-lead">Üye yorumları onaydan sonra eser ve haber sayfalarında görünür.</p>' + tabs + '<div data-c><p class="muted">Yükleniyor…</p></div>';
    api("GET", "/admin/comments?status=" + status).then(function (j) {
      var box = $("[data-c]", main);
      if (!j.items.length) { box.innerHTML = '<div class="empty">Kayıt yok.</div>'; return; }
      box.innerHTML = j.items.map(function (c) {
        return '<article class="review" data-id="' + c.id + '"><header><div><a href="/' + esc(c.target_url) + '#yorumlar" target="_blank"><strong>' + esc(c.target_label) + '</strong></a><div class="muted">' +
          esc(c.user_name) + " · " + esc(c.user_email) + " · " + when(c.created_at) + "</div></div>" + badge(c.status) + '</header><div class="body"><p style="white-space:pre-wrap;margin-top:0">' + esc(c.body) +
          '</p><div class="form-actions">' + (c.status !== "visible" ? '<button class="btn btn-primary btn-sm" data-s="visible">Yayınla</button>' : "") +
          (c.status !== "hidden" ? '<button class="btn btn-ghost btn-sm" data-s="hidden">Gizle</button>' : "") + '<button class="btn btn-danger btn-sm" data-del>Sil</button></div></div></article>';
      }).join("");
      var after = function (msg) { toast(msg); refreshMe().then(function () { renderChrome(location.hash); viewComments(status); }); };
      $$("[data-s]", box).forEach(function (b) {
        b.addEventListener("click", function () { api("PATCH", "/admin/comments/" + b.closest("article").dataset.id, { status: b.dataset.s }).then(function () { after(b.dataset.s === "visible" ? "Yorum yayınlandı." : "Yorum gizlendi."); }).catch(fail); });
      });
      $$("[data-del]", box).forEach(function (b) {
        b.addEventListener("click", function () { confirmBox("Yorum kalıcı olarak silinecek.", "Sil", true).then(function (y) { if (y) api("DELETE", "/admin/comments/" + b.closest("article").dataset.id).then(function () { after("Yorum silindi."); }).catch(fail); }); });
      });
    }).catch(fail);
  }

  function viewSite() {
    setTitle("Site yayını");
    var draw = function (b) {
      main.innerHTML = '<h1 class="page-title">Site yayını</h1><p class="page-lead">Onaylanan her değişiklikten sonra site otomatik olarak yeniden üretilir. Gerekirse elle de başlatabilirsiniz.</p>' +
        '<div class="panel"><p style="margin-top:0"><strong>Durum:</strong> ' + esc(buildLine(b)) + (b.reason ? " · " + esc(b.reason) : "") + '</p><div class="form-actions"><button class="btn btn-primary" data-run' + (b.running ? " disabled" : "") +
        '>Siteyi şimdi yeniden üret</button><button class="btn btn-ghost" data-refresh>Yenile</button></div>' + (b.log ? '<h3 style="margin-top:20px">Son çıktı</h3><div class="code">' + esc(b.log) + "</div>" : "") + "</div>";
      $("[data-run]", main).addEventListener("click", function () { api("POST", "/admin/build").then(function () { toast("Üretim başlatıldı."); setTimeout(load, 1500); }).catch(fail); });
      $("[data-refresh]", main).addEventListener("click", load);
    };
    var load = function () { api("GET", "/admin/build").then(draw).catch(fail); };
    load();
  }

  var nf = function (n) { return Number(n || 0).toLocaleString("tr-TR"); };
  var usd = function (n) { n = Number(n || 0); return "$" + (n >= 1 ? n.toFixed(2) : n >= 0.01 ? n.toFixed(3) : n.toFixed(5)); };
  var REASON_LABEL = { hiz: "Dakikalık hız sınırı", "gunluk-istek": "Günlük soru kotası", "gunluk-token": "Günlük token kotası", "aylik-butce": "Aylık bütçe", "toplam-butce": "Toplam bütçe",
    "esz-kullanici": "Kullanıcı eşzamanlılık", "esz-genel": "Genel eşzamanlılık" };

  function viewAiUsage(days) {
    days = [7, 30, 90].indexOf(+days) >= 0 ? +days : 30;
    setTitle("Yapay zekâ kullanımı");
    main.innerHTML = '<h1 class="page-title">Yapay zekâ kullanımı</h1><p class="page-lead">Akaid ve Hanefî Fıkhı asistanlarının token tüketimi ve tahmini maliyeti. Soru ve yanıt metinleri saklanmaz.</p><div data-ai><p class="muted">Yükleniyor…</p></div>';
    api("GET", "/admin/ai/usage?days=" + days).then(function (r) {
      var c = r.config, t = r.totals, b = r.budget, box = $("[data-ai]", main);
      var tabs = '<nav class="tabs">' + [7, 30, 90].map(function (d) { return '<a href="#/yonetim/yapay-zeka/' + d + '"' + (d === days ? ' aria-current="page"' : "") + ">Son " + d + " gün</a>"; }).join("") + "</nav>";
      var stat = function (v, label, sub) { return '<div class="p-card p-stat"><b>' + v + "</b><span>" + label + "</span>" + (sub ? '<span class="sub">' + sub + "</span>" : "") + "</div>"; };
      var bar = function (spent, cap) {
        if (!cap) return '<span class="muted">Sınır yok</span>';
        var p = Math.min(100, (spent / cap) * 100);
        return '<div class="meter" role="meter" aria-valuemin="0" aria-valuemax="' + cap + '" aria-valuenow="' + spent.toFixed(4) + '"><span style="width:' + p.toFixed(1) + "%" + (p > 85 ? ";background:var(--rose)" : "") + '"></span></div><span class="sub">' + usd(spent) + " / " + usd(cap) + " (%" + p.toFixed(0) + ")</span>";
      };
      var maxCost = Math.max.apply(null, r.byDay.map(function (d) { return d.cost_usd; }).concat([1e-9]));
      var maxTok = Math.max.apply(null, r.byDay.map(function (d) { return d.input_tokens + d.output_tokens; }).concat([1]));
      var chart = r.byDay.length ? '<div class="ai-chart" role="img" aria-label="Günlük maliyet grafiği">' + r.byDay.map(function (d) {
        var tok = d.input_tokens + d.output_tokens;
        return '<div class="col" title="' + esc(d.day) + ": " + nf(d.requests) + " istek, " + nf(tok) + " token, " + usd(d.cost_usd) + '"><span class="bar" style="height:' + Math.max(2, (d.cost_usd / maxCost) * 100).toFixed(1) +
          '%"></span><span class="tok" style="height:' + Math.max(2, (tok / maxTok) * 100).toFixed(1) + '%"></span><small>' + esc(d.day.slice(5)) + "</small></div>";
      }).join("") + '</div><p class="sub" style="margin-top:6px"><span class="key k1"></span> maliyet <span class="key k2"></span> token</p>' : '<div class="empty">Bu aralıkta kullanım yok.</div>';
      var table = function (head, rows) { return '<div class="p-table-wrap"><table class="p-table"><thead><tr>' + head.map(function (h) { return "<th>" + h + "</th>"; }).join("") + "</tr></thead><tbody>" + (rows.length ? rows.join("") : '<tr><td colspan="' + head.length + '" class="sub">Kayıt yok.</td></tr>') + "</tbody></table></div>"; };
      var tokCell = function (x) { return nf(x.input_tokens) + ' <span class="sub">(' + nf(x.cached_tokens) + " önbellek)</span> / " + nf(x.output_tokens) + ' <span class="sub">(' + nf(x.reasoning_tokens) + " akıl yürütme)</span>"; };

      box.innerHTML =
        (!c.keyConfigured ? '<div class="notice warn"><strong>OPENAI_API_KEY tanımlı değil.</strong> Asistan kapalı. Anahtarı sunucudaki .env dosyasına ekleyip uygulamayı yeniden başlatın.</div>' : "") +
        (c.assistants || []).filter(function (a) { return !a.index.ready; }).map(function (a) {
          return '<div class="notice warn"><strong>' + esc(a.name) + ': kaynak indeksi yok.</strong> Kaynak klasörünü sunucuya yükleyip <code>npm run ' + (a.key === "hanefi" ? "kaynak-hanefi" : "kaynak") + "</code> komutunu çalıştırın.</div>";
        }).join("") +
        '<div class="p-grid wide">' +
        '<div class="p-card"><h3>Yapılandırma</h3><dl class="dl"><dt>Durum</dt><dd>' + (c.enabled ? badge("active").replace("Etkin", "Açık") : '<span class="badge b-rose">Kapalı</span>') + "</dd><dt>Model</dt><dd>" + esc(c.model) +
        "</dd><dt>API anahtarı</dt><dd>" + (c.keyConfigured ? "Tanımlı (sunucuda)" : "Yok") + "</dd>" + (c.assistants || []).map(function (a) {
          return "<dt>" + esc(a.name.replace(" Asistanı", "")) + "</dt><dd>" + (a.on ? badge("active").replace("Etkin", "Açık") : '<span class="badge b-rose">' + (a.switchedOn ? "Hazır değil" : "Kapalı") + "</span>") +
            ' <span class="sub">' + (a.index.ready ? nf(a.index.works || a.index.files) + (a.index.works ? " eser" : " dosya") + " · " + when(a.index.built) : "indeks yok") + "</span></dd>";
        }).join("") + "</dl></div>" +
        '<div class="p-card"><h3>Bütçe</h3><dl class="dl"><dt>' + esc(b.month) + "</dt><dd>" + bar(b.monthSpent, b.monthlyBudget) + "</dd><dt>Toplam</dt><dd>" + bar(b.totalSpent, b.totalBudget) + "</dd></dl></div>" +
        '<div class="p-card"><h3>Sınırlar</h3><dl class="dl"><dt>Kişi/gün</dt><dd>' + nf(c.limits.dailyRequestsPerUser) + " soru · " + nf(c.limits.dailyTokensPerUser) + " token</dd><dt>Hız</dt><dd>" + nf(c.limits.ratePerMinute) +
        " soru/dk</dd><dt>Girdi</dt><dd>" + nf(c.limits.maxInputChars) + " karakter</dd><dt>Eşzamanlı</dt><dd>" + nf(c.limits.maxConcurrent) + " genel · " + nf(c.limits.maxConcurrentPerUser) + " kişi başı</dd></dl></div>" +
        '<div class="p-card"><h3>Görev profilleri</h3><dl class="dl">' + Object.keys(c.tasks).map(function (k) { var x = c.tasks[k]; return "<dt>" + ({ kisa: "Basit", soru: "Gerekçeli", terimler: "Arapça terim" })[k] + "</dt><dd>effort " + esc(x.effort) + " · en çok " + nf(x.maxOutput) + " çıktı token</dd>"; }).join("") +
        "<dt>Fiyat</dt><dd>1M token: girdi " + usd(c.price.input) + " · önbellek " + usd(c.price.cachedInput) + " · çıktı " + usd(c.price.output) + "</dd></dl></div></div>" +
        tabs + '<div class="p-grid">' + stat(nf(t.requests), "İstek", nf(t.ok) + " başarılı · " + nf(t.errors) + " hata · " + nf(t.blocked) + " engellenen") +
        stat(nf(t.input_tokens), "Girdi token", nf(t.cached_tokens) + " önbellekten") + stat(nf(t.output_tokens), "Çıktı token", nf(t.reasoning_tokens) + " akıl yürütme") +
        stat(usd(t.cost_usd), "Tahmini maliyet", "ort. yanıt " + (t.avg_latency_ms / 1000).toFixed(1) + " sn") + "</div>" +
        '<div class="panel" style="margin-bottom:18px"><h3>Günlük kullanım</h3>' + chart + "</div>" +
        "<h3>Asistanlara göre</h3>" + table(["Asistan", "İstek", "Token (girdi / çıktı)", "Maliyet"], (r.byAssistant || []).map(function (x) {
          return "<tr><td>" + esc(x.name) + "</td><td>" + nf(x.requests) + (x.blocked ? ' <span class="sub">(' + nf(x.blocked) + " engellendi)</span>" : "") + "</td><td>" + tokCell(x) + "</td><td>" + usd(x.cost_usd) + "</td></tr>";
        })) +
        '<h3 style="margin-top:22px">Kullanıcılara göre</h3>' + table(["Üye", "İstek", "Token (girdi / çıktı)", "Maliyet"], r.byUser.map(function (u) {
          return "<tr><td><strong>" + esc(u.name || "(silinmiş üye)") + '</strong><div class="sub">' + esc(u.email || "") + "</div></td><td>" + nf(u.requests) + (u.blocked ? ' <span class="sub">(' + nf(u.blocked) + " engellendi)</span>" : "") + "</td><td>" + tokCell(u) + "</td><td>" + usd(u.cost_usd) + "</td></tr>";
        })) +
        '<h3 style="margin-top:22px">Görev türüne göre</h3>' + table(["Görev", "Effort", "İstek", "Token (girdi / çıktı)", "Maliyet"], r.byTask.map(function (x) {
          return "<tr><td>" + (x.task === "kisa" ? "Basit soru" : "Gerekçeli soru") + "</td><td>" + esc(x.effort) + "</td><td>" + nf(x.requests) + "</td><td>" + tokCell(x) + "</td><td>" + usd(x.cost_usd) + "</td></tr>";
        })) +
        '<h3 style="margin-top:22px">Modele göre</h3>' + table(["Model", "İstek", "Token (girdi / çıktı)", "Maliyet"], r.byModel.map(function (x) {
          return "<tr><td>" + esc(x.model) + "</td><td>" + nf(x.requests) + "</td><td>" + tokCell(x) + "</td><td>" + usd(x.cost_usd) + "</td></tr>";
        })) +
        '<h3 style="margin-top:22px">Engellenen istekler</h3>' + table(["Neden", "Sayı"], r.blockedReasons.map(function (x) {
          return "<tr><td>" + esc(REASON_LABEL[x.reason] || x.reason) + "</td><td>" + nf(x.n) + "</td></tr>";
        })) +
        '<p class="sub" style="margin-top:16px">Maliyetler, OpenAI\'nin döndürdüğü token sayıları ile .env dosyasındaki birim fiyatlardan hesaplanan tahmindir; kesin tutar için OpenAI faturanızı esas alın.</p>';
    }).catch(fail);
  }

  function viewNotFound() {
    main.innerHTML = '<h1 class="page-title">Sayfa bulunamadı</h1><p><a class="link-arrow" href="#/">Panel özetine dön</a></p>';
  }

  /* ---------------------------------------------------------------- yönlendirme */
  function render() {
    navSeq++;
    var hash = location.hash || "#/";
    var parts = hash.replace(/^#\/?/, "").split("?"), path = parts[0].split("/").filter(Boolean);
    var params = {}; (parts[1] || "").split("&").forEach(function (kv) { var p = kv.split("="); if (p[0]) params[p[0]] = p[1] || ""; });
    var u = state.user, route = "#/" + path.join("/");
    window.scrollTo(0, 0);

    if (path[0] === "kayit" && !u) { renderChrome(route); return viewRegister(); }
    if (path[0] === "giris" || !u) {
      if (u) return go("#/");
      renderChrome(route);
      return viewLogin(path[0] === "giris" ? params : { next: encodeURIComponent(hash) });
    }
    if (u.must_change) { renderChrome(route); return viewPassword(true); }
    renderChrome(route);
    if (path[0] === "sifre") return viewPassword(false);
    if (path[0] === "hesap") return viewAccount();
    if (!path.length) return viewHome();
    if (path[0] === "gonderilerim") return viewMySubmissions();

    if (u.status !== "active") return viewHome();
    if (path[0] === "profil") return viewProfile();
    if (path[0] === "eserlerim") return viewMyItems();
    if (path[0] === "duzenle" && path[1] && /^\d+$/.test(path[2] || "")) return viewOwnEdit(path[1], +path[2]);
    if (path[0] === "sahiplen" && /^\d+$/.test(path[1])) return viewClaim(+path[1]);
    if (path[0] === "oneri" && path[1]) return viewSuggest(path[1], /^\d+$/.test(path[2] || "") ? +path[2] : null);

    if (path[0] === "yonetim") {
      if (!isStaff()) return viewNotFound();
      if (!path[1]) return viewAdminHome();
      if (path[1] === "onaylar") return viewQueue(path[2]);
      if (path[1] === "uyeler") return viewUsers(path[2]);
      if (path[1] === "roller" && can("yetki.yonet")) return viewRoles();
      if (path[1] === "ayarlar" && (can("site.ayar") || can("ai.ayar"))) return viewSettings(path[2]);
      if (path[1] === "kayitlar" && can("kayit.gor")) return viewLogs();
      if (path[1] === "cop" && can("icerik.sil")) return viewTrash();
      if (path[1] === "yorumlar") return viewComments(path[2]);
      if (path[1] === "site") return viewSite();
      if (path[1] === "yapay-zeka") return viewAiUsage(path[2]);
      if (path[1] === "icerik" && path[2]) return path[3] ? viewContentEdit(path[2], path[3] === "yeni" ? "yeni" : +path[3]) : viewContentList(path[2]);
    }
    viewNotFound();
  }

  // Her gezinmede oturum tazelenir: üyelik onayı, yetki değişikliği ve bekleyen iş sayıları güncel kalır.
  window.addEventListener("hashchange", function () { navSeq++; loadMe().catch(function () {}).then(render); });
  loadMe().catch(function () { state.user = null; }).then(render);
})();
