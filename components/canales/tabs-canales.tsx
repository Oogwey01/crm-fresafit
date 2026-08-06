"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CLASE_NAV_TABS, claseTab } from "@/components/compartido/tabs-seccion";
import { PANELES_CANAL } from "@/lib/catalogos";

/* Pestañas del módulo Canales: una por plataforma.

   Comparten aspecto con las de los demás módulos (`tabs-seccion`), pero aquí
   son <Link>: cada plataforma es una ruta propia. Las que todavía no existen se
   muestran apagadas en vez de esconderse, para que se vea que el módulo va a
   crecer y nadie las busque en otro lado. */
export function TabsCanales() {
  const pathname = usePathname();

  return (
    <nav className={CLASE_NAV_TABS}>
      {PANELES_CANAL.map((p) => {
        if (!p.activo) {
          return (
            <span
              key={p.id}
              className="shrink-0 cursor-default rounded-t-lg px-3.5 py-2 text-[13.5px] font-medium text-muted-foreground/50"
              title="Próximamente"
            >
              {p.nombre}
            </span>
          );
        }
        const activo = pathname === p.href || pathname.startsWith(p.href + "/");
        return (
          <Link
            key={p.id}
            href={p.href}
            aria-current={activo ? "page" : undefined}
            className={claseTab(activo)}
          >
            {p.nombre}
          </Link>
        );
      })}
    </nav>
  );
}
