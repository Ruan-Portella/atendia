/*
 * Widget loader (white-label: nenhum nome de produto aparece no site do cliente)
 *
 *   <script src="https://SEU-DOMINIO/widget.js" data-key="CHAVE" async></script>
 *
 * Cor, lado da tela e distância da borda vêm do painel (aba Aparência) e valem na hora.
 * Os atributos data-color / data-position / data-offset, quando presentes, têm prioridade.
 * A chave também pode vir por ?key=CHAVE no src ou por window.ChatWidgetConfig = { key }.
 * API: window.ChatWidget.open() / .close() / .toggle() / .isOpen()
 */
(function () {
  if (window.__cwLoaded) return;
  window.__cwLoaded = true;

  var s = document.currentScript;
  if (!s) {
    // fallback: o último <script> cujo src termina em widget.js
    var all = document.getElementsByTagName("script");
    for (var i = all.length - 1; i >= 0; i--) {
      if (/widget\.js(\?|$)/.test(all[i].src || "")) { s = all[i]; break; }
    }
  }
  if (!s || !s.src) return;

  var cfg = window.ChatWidgetConfig || {};
  var src = new URL(s.src, location.href);
  var key = s.getAttribute("data-key") || src.searchParams.get("key") || cfg.key;
  if (!key) { console.warn("[chat-widget] falta data-key no <script>."); return; }
  var origin = src.origin;

  // overrides locais (opcionais)
  var attrColor = s.getAttribute("data-color") || src.searchParams.get("color") || cfg.color;
  var attrPos = s.getAttribute("data-position") || src.searchParams.get("position") || cfg.position;
  var attrOffset = s.getAttribute("data-offset") || src.searchParams.get("offset") || cfg.offset;

  var color = attrColor || "#1f4e3d";
  var side = attrPos === "left" ? "left" : "right";
  var offset = parseInt(attrOffset, 10);
  if (isNaN(offset)) offset = 20;

  function init() {
    if (document.getElementById("cw-root")) return;

    var css = document.createElement("style");
    css.textContent =
      "#cw-root .cw-btn{position:fixed;bottom:" + offset + "px;" + side + ":" + offset + "px;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .15s;padding:0;margin:0}" +
      "#cw-root .cw-btn:hover{transform:scale(1.05)}" +
      "#cw-root .cw-frame{position:fixed;bottom:" + (offset + 70) + "px;" + side + ":" + offset + "px;width:380px;height:600px;max-height:calc(100vh - " + (offset + 90) + "px);border:0;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.25);z-index:2147483000;background:#fff;display:none}" +
      "@media (max-width:480px){#cw-root .cw-frame{left:0;right:0;bottom:0;width:100%;height:100%;max-height:100%;border-radius:0}}";
    document.head.appendChild(css);

    var root = document.createElement("div");
    root.id = "cw-root";

    var btn = document.createElement("button");
    btn.className = "cw-btn";
    btn.type = "button";
    btn.setAttribute("aria-label", "Abrir chat");
    btn.setAttribute("aria-expanded", "false");
    btn.style.background = color;
    var icoChat = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4z"/></svg>';
    var icoClose = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    btn.innerHTML = icoChat;

    var frame = document.createElement("iframe");
    frame.className = "cw-frame";
    frame.title = "Chat";
    frame.allow = "clipboard-write";
    var open = false, loaded = false;

    function set(next) {
      if (next === open) return;
      open = next;
      if (open && !loaded) { frame.src = origin + "/w/" + key; loaded = true; }
      frame.style.display = open ? "block" : "none";
      btn.innerHTML = open ? icoClose : icoChat;
      btn.setAttribute("aria-label", open ? "Fechar chat" : "Abrir chat");
      btn.setAttribute("aria-expanded", String(open));
    }
    btn.addEventListener("click", function () { set(!open); });
    window.addEventListener("message", function (e) {
      if (e.origin === origin && e.data === "chat-widget:close") set(false);
    });

    root.appendChild(frame);
    root.appendChild(btn);
    document.body.appendChild(root);

    window.ChatWidget = {
      open: function () { set(true); },
      close: function () { set(false); },
      toggle: function () { set(!open); },
      isOpen: function () { return open; }
    };

    // Avisa o painel que o widget está instalado neste domínio (uma vez por sessão de navegação).
    try {
      var k = "cw-ping-" + key;
      if (!sessionStorage.getItem(k) && location.protocol !== "file:") {
        sessionStorage.setItem(k, "1");
        fetch(origin + "/api/widget/ping", { method: "POST", mode: "no-cors", keepalive: true, body: key + "|" + location.host });
      }
    } catch (_) {}
  }

  // Busca cor/posição no painel (até 2,5 s); se falhar, usa os padrões/atributos.
  function loadConfig(done) {
    var finished = false;
    function finish(c) { if (finished) return; finished = true; done(c || {}); }
    var t = setTimeout(function () { finish({}); }, 2500);
    try {
      fetch(origin + "/api/widget/config?key=" + encodeURIComponent(key))
        .then(function (r) { return r.ok ? r.json() : {}; })
        .then(function (c) { clearTimeout(t); finish(c); })
        .catch(function () { clearTimeout(t); finish({}); });
    } catch (_) { clearTimeout(t); finish({}); }
  }

  function start() {
    loadConfig(function (c) {
      if (!attrColor && c.color) color = c.color;
      if (!attrPos && c.position) side = c.position === "left" ? "left" : "right";
      if (!attrOffset && typeof c.offset === "number") offset = c.offset;
      init();
    });
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
