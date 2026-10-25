// Eski mezhep.org (SkyPortal, .asp) adreslerinin yeni sayfalara kalıcı (301) yönlendirilmesi.
// Kayıt numaraları yeni sitede aynen korunduğu için eski akademisyen, eser, haber ve albüm bağlantıları doğrudan
// karşılığına gider; kaydı artık olmayan bağlantılar ilgili listeye düşer. Arama motorlarındaki eski sonuçlar ve başka
// sitelerdeki bağlantılar böylece kaybolmaz.
const C = require("./content");

// Sorgu parametreleri IIS'te büyük/küçük harf duyarsızdı (item, ITEM, TOPIC_ID, topic_id…)
const param = (q, name) => {
  const k = Object.keys(q).find((x) => x.toLowerCase() === name.toLowerCase());
  const v = k ? String(Array.isArray(q[k]) ? q[k][0] : q[k]) : "";
  return /^\d{1,9}$/.test(v) ? +v : null;
};
const item = (kind, id, page, list) => (id != null && C.getItem(kind, id) ? page : list);

const RULES = {
  "default.asp": () => "/", "index.asp": () => "/", "fnews.asp": () => "/haberler.html", "forum.asp": () => "/haberler.html",
  "active.asp": () => "/haberler.html", "search.asp": () => "/", "eleman.asp": () => "/akademisyenler.html", "eser.asp": () => "/eserler.html",
  "pic.asp": (q) => {
    const c = param(q, "cid"), s = param(q, "sid");
    return c != null && s != null && C.getItem("album", c * 1000 + s) ? `/galeri/${c}-${s}.html` : "/galeri.html";
  },
  "eleman_read.asp": (q) => item("member", param(q, "item"), `/akademisyen/${param(q, "item")}.html`, "/akademisyenler.html"),
  "eser_read.asp": (q) => item("work", param(q, "item"), `/eser/${param(q, "item")}.html`, "/eserler.html"),
  "links.asp": () => "/kaynaklar.html", "links_pop.asp": () => "/kaynaklar.html", "dl.asp": () => "/kaynaklar.html", "article.asp": () => "/kaynaklar.html",
  "policy.asp": () => "/hakkinda.html#kosullar", "privacy.asp": () => "/hakkinda.html#kosullar",
};
for (const f of ["link.asp", "forum_topic.asp", "topic.asp", "post.asp"]) {
  RULES[f] = (q) => { const id = param(q, "TOPIC_ID"); return item("topic", id, `/haber/${id}.html`, "/haberler.html"); };
}

// Express ara katmanı: yalnızca kök dizindeki .asp adreslerine bakar; diğer istekler olduğu gibi geçer.
function legacyRedirects(req, res, next) {
  const m = /^\/([a-z0-9_]+\.asp)$/i.exec(req.path);
  if (!m || (req.method !== "GET" && req.method !== "HEAD")) return next();
  const rule = RULES[m[1].toLowerCase()];
  res.set("Cache-Control", "public, max-age=86400");
  res.redirect(301, rule ? rule(req.query) : "/");
}

module.exports = { legacyRedirects, RULES };
