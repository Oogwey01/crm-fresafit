"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PANELES_CANAL } from "@/lib/catalogos";
import { cn } from "@/lib/utils";

/* Pestañas del módulo Canales: una por plataforma.

   Las que todavía no existen se muestran apagadas en vez de esconderse, para
   que se vea que el módulo va a crecer y nadie las busque en otro lado. */
export function TabsCanales() {
  const pathname = usePathname();

  return (
    <nav className="-mx-1 flex gap-1 overflow-x-auto border-b pb-px">
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
            className={cn(
              "shrink-0 rounded-t-lg px-3.5 py-2 text-[13.5px] transition-colors",
              activo
                ? "border-b-2 border-primary font-semibold text-foreground"
                : "font-medium text-muted-foreground hover:text-foreground",
            )}
          >
            {p.nombre}
          </Link>
        );
      })}
    </nav>
  );
}
