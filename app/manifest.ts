import type { MetadataRoute } from "next";

/* Manifest de la app. No es un capricho de "hacerla PWA": en iOS, Safari solo
   entrega avisos push a los sitios que se agregaron a la pantalla de inicio, y
   para eso el sitio necesita manifest + service worker. En Android y escritorio
   los avisos funcionan sin instalar nada; el manifest solo mejora cómo se ve.

   `display: standalone` la abre sin barra del navegador, que para un sistema
   interno que se usa a diario desde el celular se agradece. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Fresafit · Sistema interno",
    short_name: "Fresafit CRM",
    description: "CRM interno de Fresafit: tareas, inventario, pedidos y ventas.",
    start_url: "/tareas",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#e84393",
    lang: "es-MX",
    orientation: "portrait-primary",
    icons: [
      { src: "/icono-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icono-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
