/* ============================================================================
   sw.js — Service worker del CRM Fresafit
   ----------------------------------------------------------------------------
   Existe por una sola razón: recibir avisos push cuando la app NO está abierta.
   No cachea nada ni intercepta peticiones a propósito — un caché mal puesto
   sirve pantallas viejas de un CRM cuyos datos cambian cada minuto, y ese
   problema es mucho peor que el que resolvería.
   ============================================================================ */

/* Tomar el control sin esperar a que se cierren las pestañas viejas: si alguien
   deja el CRM abierto una semana, el service worker nuevo entra igual. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { cuerpo: event.data ? event.data.text() : "" };
  }

  const titulo = datos.titulo || "Fresafit CRM";
  const opciones = {
    body: datos.cuerpo || "",
    icon: "/icono-192.png",
    badge: "/icono-badge.png",
    /* `tag` colapsa: dos avisos de la MISMA tarea se sustituyen en vez de
       apilarse. Sin esto, veinte comentarios seguidos son veinte tarjetas. */
    tag: datos.tag || undefined,
    data: { url: datos.url || "/tareas" },
    /* En escritorio, que no se desvanezca antes de que la persona vuelva a la
       pantalla: los avisos del CRM piden una acción, no son informativos. */
    requireInteraction: datos.persistente === true,
    timestamp: Date.now(),
  };

  event.waitUntil(self.registration.showNotification(titulo, opciones));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const destino = (event.notification.data && event.notification.data.url) || "/tareas";

  /* Si el CRM ya está abierto en alguna pestaña, se reutiliza y se navega ahí
     mismo; abrir una segunda pestaña del mismo sistema molesta. */
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientes) => {
      for (const c of clientes) {
        const mismaApp = new URL(c.url).origin === self.location.origin;
        if (mismaApp && "focus" in c) {
          c.navigate(destino);
          return c.focus();
        }
      }
      return self.clients.openWindow(destino);
    }),
  );
});
