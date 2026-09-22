/* Atendia widget loader · <script src="https://SEU-DOMINIO/widget.js" data-key="CHAVE" async></script> */
(function () {
  if (window.__atendiaLoaded) return;
  window.__atendiaLoaded = true;
  var s = document.currentScript || (function () { var a = document.getElementsByTagName("script"); return a[a.length - 1]; })();
  var key = s.getAttribute("data-key");
  if (!key) return;
  var origin = new URL(s.src).origin;
  var color = s.getAttribute("data-color") || "#1f4e3d";
  var side = s.getAttribute("data-position") === "left" ? "left" : "right";

  var css = document.createElement("style");
  css.textContent =
    ".atd-btn{position:fixed;bottom:20px;" + side + ":20px;width:58px;height:58px;border-radius:50%;border:0;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.22);display:flex;align-items:center;justify-content:center;z-index:2147483000;transition:transform .15s}" +
    ".atd-btn:hover{transform:scale(1.05)}" +
    ".atd-frame{position:fixed;bottom:90px;" + side + ":20px;width:380px;height:600px;max-height:calc(100vh - 110px);border:0;border-radius:18px;box-shadow:0 20px 50px rgba(0,0,0,.25);z-index:2147483000;background:#fff;display:none}" +
    "@media (max-width:480px){.atd-frame{left:0;right:0;bottom:0;width:100%;height:100%;max-height:100%;border-radius:0}}";
  document.head.appendChild(css);

  var btn = document.createElement("button");
  btn.className = "atd-btn";
  btn.setAttribute("aria-label", "Abrir chat");
  btn.style.background = color;
  var open = false;
  var icoChat = '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4z"/></svg>';
  var icoClose = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  btn.innerHTML = icoChat;

  var frame = document.createElement("iframe");
  frame.className = "atd-frame";
  frame.title = "Chat";
  frame.allow = "clipboard-write";
  var loaded = false;

  function toggle() {
    open = !open;
    if (open && !loaded) { frame.src = origin + "/w/" + key; loaded = true; }
    frame.style.display = open ? "block" : "none";
    btn.innerHTML = open ? icoClose : icoChat;
  }
  btn.addEventListener("click", toggle);
  window.addEventListener("message", function (e) { if (e.origin === origin && e.data === "atendia:close" && open) toggle(); });
  document.body.appendChild(frame);
  document.body.appendChild(btn);
})();
