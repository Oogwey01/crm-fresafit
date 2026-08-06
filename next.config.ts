import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Bodega dejó de colgar de Inventario y pasó a su propio botón del menú. El
     equipo la abre desde el teléfono con la PWA instalada y la pantalla de
     inicio guarda la URL, así que la ruta vieja tiene que seguir llegando a
     algún lado en vez de dar 404. */
  async redirects() {
    return [{ source: "/inventario/bodega", destination: "/bodega", permanent: true }];
  },
};

export default nextConfig;
