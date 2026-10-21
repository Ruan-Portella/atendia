/*
 * Avisos no celular e no computador (Memória e avisos, parte 2): o service worker do painel e da
 * área do cliente. Só mostra o aviso que o servidor mandou e, no toque, abre a página dele (ou leva
 * a janela que já está aberta até lá). Não guarda nada e não intercepta requisição nenhuma.
 */
self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(self.registration.showNotification(d.title || "Novo aviso", { body: d.body || "", tag: d.tag || undefined, renotify: Boolean(d.tag), data: { url: d.url || "/" } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of all) if (c.url === url && "focus" in c) return c.focus();
      for (const c of all) {
        if ("navigate" in c && c.url.startsWith(self.location.origin)) {
          await c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    })(),
  );
});
