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
      "@media (max-width:480px){#cw-root .cw-frame{left:0;right:0;bottom:0;width:100%;height:100%;max-height:100%;border-radius:0}}" +
      // bolinha de mensagens não lidas e prévia da última mensagem (com o chat fechado)
      "#cw-root .cw-badge{position:fixed;bottom:" + (offset + 40) + "px;" + side + ":" + (offset - 2) + "px;min-width:20px;height:20px;padding:0 5px;border-radius:10px;background:#e5484d;color:#fff;font:700 11px/20px system-ui,-apple-system,sans-serif;text-align:center;z-index:2147483001;box-shadow:0 0 0 2px #fff;display:none;box-sizing:border-box}" +
      "#cw-root .cw-preview{position:fixed;bottom:" + (offset + 70) + "px;" + side + ":" + offset + "px;max-width:260px;background:#fff;color:#1b1f1d;border-radius:14px;padding:10px 30px 10px 12px;box-shadow:0 10px 30px rgba(0,0,0,.18);font:13px/1.4 system-ui,-apple-system,sans-serif;z-index:2147483000;cursor:pointer;display:none;box-sizing:border-box}" +
      "#cw-root .cw-preview b{display:block;font-size:12px;margin-bottom:2px}" +
      "#cw-root .cw-preview-x{position:absolute;top:6px;right:6px;width:20px;height:20px;border:0;background:transparent;color:#8a938e;cursor:pointer;font-size:16px;line-height:20px;padding:0}";
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
    var open = false, loaded = false, unread = 0;

    var badge = document.createElement("span");
    badge.className = "cw-badge";
    badge.setAttribute("aria-live", "polite");

    var bubble = document.createElement("div");
    bubble.className = "cw-preview";
    bubble.setAttribute("role", "status");
    var bubbleFrom = document.createElement("b");
    var bubbleText = document.createElement("span");
    var bubbleX = document.createElement("button");
    bubbleX.className = "cw-preview-x";
    bubbleX.type = "button";
    bubbleX.setAttribute("aria-label", "Dispensar");
    bubbleX.textContent = "×";
    bubble.appendChild(bubbleFrom);
    bubble.appendChild(bubbleText);
    bubble.appendChild(bubbleX);

    function load() {
      if (!loaded) { frame.src = origin + "/w/" + key; loaded = true; }
    }
    function showUnread() {
      badge.textContent = unread > 9 ? "9+" : String(unread);
      badge.style.display = unread > 0 ? "block" : "none";
      btn.setAttribute("aria-label", unread > 0 ? "Abrir chat (" + unread + " nova" + (unread > 1 ? "s" : "") + ")" : "Abrir chat");
    }

    function set(next) {
      if (next === open) return;
      open = next;
      if (open) load();
      frame.style.display = open ? "block" : "none";
      btn.innerHTML = open ? icoClose : icoChat;
      btn.setAttribute("aria-expanded", String(open));
      if (open) { unread = 0; bubble.style.display = "none"; }
      showUnread();
      if (open) btn.setAttribute("aria-label", "Fechar chat");
    }
    btn.addEventListener("click", function () { set(!open); });
    bubble.addEventListener("click", function () { set(true); });
    bubbleX.addEventListener("click", function (ev) { ev.stopPropagation(); bubble.style.display = "none"; });

    // Conversa aberta fica marcada na página do cliente: depois do F5 o chat carrega escondido,
    // recebe as respostas da equipe e o painel vê o visitante online sem ele clicar.
    var convFlag = "cw-conv-" + key;
    function flag(active) {
      try { if (active) localStorage.setItem(convFlag, String(Date.now())); else localStorage.removeItem(convFlag); } catch {}
    }

    window.addEventListener("message", function (e) {
      if (e.origin !== origin) return;
      var d = e.data;
      if (d === "chat-widget:close") { set(false); return; }
      if (!d || typeof d !== "object") return;
      if (d.type === "chat-widget:conversation") flag(Boolean(d.active));
      if (d.type === "chat-widget:message" && !open) {
        unread++;
        showUnread();
        bubbleFrom.textContent = String(d.from || "");
        bubbleText.textContent = String(d.preview || "");
        bubble.style.display = "block";
      }
    });

    root.appendChild(frame);
    root.appendChild(bubble);
    root.appendChild(btn);
    root.appendChild(badge);

    try {
      var since = Number(localStorage.getItem(convFlag));
      if (since && Date.now() - since < 6 * 3600 * 1000) load(); // mesma janela de RESUME_HOURS
    } catch {}
    document.body.appendChild(root);

    window.ChatWidget = {
      open: function () { set(true); },
      close: function () { set(false); },
      toggle: function () { set(!open); },
      isOpen: function () { return open; }
    };

  }

  // Busca cor/posição no painel (até 2,5 s); se falhar, usa os padrões/atributos.
  // Avisa o painel que o widget está instalado neste domínio (uma vez por sessão de navegação).
  // Fica fora do init para contar mesmo quando o bot ainda está em rascunho.
  function ping() {
    try {
      var k = "cw-ping-" + key;
      if (!sessionStorage.getItem(k) && location.protocol !== "file:") {
        sessionStorage.setItem(k, "1");
        fetch(origin + "/api/widget/ping", { method: "POST", mode: "no-cors", keepalive: true, body: key + "|" + location.host });
      }
    } catch {}
  }

  // Busca a configuração no painel (até 2,5 s). Devolve:
  //   { gone: true }   → bot apagado: não desenha nada
  //   { live: false }  → bot em rascunho: só registra a instalação, sem balão
  //   { color, ... }   → normal; se a rede falhar, {} e usa padrões/atributos
  function loadConfig(done) {
    var finished = false;
    function finish(c) { if (finished) return; finished = true; done(c || {}); }
    var t = setTimeout(function () { finish({}); }, 2500);
    try {
      fetch(origin + "/api/widget/config?key=" + encodeURIComponent(key), { cache: "no-store" })
        .then(function (r) {
          if (r.status === 404 || r.status === 400) return { gone: true };
          return r.ok ? r.json() : {};
        })
        .then(function (c) { clearTimeout(t); finish(c); })
        .catch(function () { clearTimeout(t); finish({}); });
    } catch { clearTimeout(t); finish({}); }
  }

  function start() {
    loadConfig(function (c) {
      if (c.gone) return; // chatbot excluído: silêncio total no site do cliente
      ping();
      if (c.live === false) return; // rascunho / fora do ar: sem balão até publicar
      if (!attrColor && c.color) color = c.color;
      if (!attrPos && c.position) side = c.position === "left" ? "left" : "right";
      if (!attrOffset && typeof c.offset === "number") offset = c.offset;
      init();
    });
  }

  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
