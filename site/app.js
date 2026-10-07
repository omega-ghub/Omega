(function () {
  var S = window.SITE || {}, P = window.PRODUCTS || [];
  document.getElementById("year").textContent = new Date().getFullYear();
  document.getElementById("handle").textContent = S.handle || "";

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function safeUrl(u) { return /^https:\/\//i.test(u || "") ? u : ""; }

  var grid = document.getElementById("products");
  function render(filter) {
    grid.textContent = "";
    P.filter(function (p) { return filter === "all" || p.type === filter; }).forEach(function (p) {
      var card = el("article", "product");
      var top = el("div", "pt");
      top.appendChild(el("span", "tag " + (p.type === "app" ? "live" : ""), p.type === "app" ? "App" : "Merch"));
      top.appendChild(el("span", "price", p.price));
      card.appendChild(top);
      card.appendChild(el("h3", null, p.name));
      card.appendChild(el("p", null, p.blurb));
      var url = safeUrl(p.checkoutUrl), a;
      if (p.status === "available" && url) {
        a = el("a", "btn primary", "Buy now");
        a.href = url; a.rel = "noopener";
      } else {
        a = el("a", "btn", "Notify me");
        a.href = S.contactEmail
          ? "mailto:" + S.contactEmail + "?subject=" + encodeURIComponent("Notify me: " + p.name)
          : "#contact";
      }
      card.appendChild(a);
      grid.appendChild(card);
    });
  }
  render("all");
  document.querySelectorAll(".chip").forEach(function (c) {
    c.addEventListener("click", function () {
      document.querySelectorAll(".chip").forEach(function (x) { x.classList.remove("on"); });
      c.classList.add("on");
      render(c.dataset.filter);
    });
  });

  var links = document.getElementById("contact-links");
  if (S.contactEmail) {
    var m = el("a", "btn primary", "Email me"); m.href = "mailto:" + S.contactEmail; links.appendChild(m);
  }
  (S.social || []).forEach(function (s) {
    var u = safeUrl(s.url); if (!u) return;
    var a = el("a", "btn", s.label); a.href = u; a.rel = "noopener"; links.appendChild(a);
  });
})();
