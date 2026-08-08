"use client";

import Link from "next/link";
import { Building2, Handshake, Store } from "lucide-react";
import { ESPACIOS, type EspacioId } from "@/lib/catalogos";
import { cn } from "@/lib/utils";

/* ============================================================================
   Selector de espacio: Fresafit / Agencia
   ----------------------------------------------------------------------------
   Son dos negocios distintos que comparten equipo y menú. Sin separarlos, la
   barra lateral mezclaba «Inventario» (cinturones propios) con «Cobros» (lo que
   nos paga Nutravia), que no tienen nada que ver entre sí.

   No guarda estado: el espacio se lee de la ruta, así que esto son dos enlaces.
   Un selector con estado propio se queda desincronizado en cuanto abres una
   segunda pestaña o entras por una notificación.
   ============================================================================ */

const ICONOS: Record<EspacioId, typeof Store> = {
  fresafit: Store,
  agencia: Building2,
  /* El portal nunca se pinta aquí —quien lo tiene no tiene ningún otro espacio,
     así que el selector se oculta solo—, pero el mapa es exhaustivo por tipo. */
  portal: Handshake,
};

export function SelectorEspacio({
  actual,
  destinos,
  onNavigate,
}: {
  actual: EspacioId;
  /* A dónde lleva cada espacio: su primer módulo visible para quien mira. Se
     calcula en el sidebar, que ya conoce el rol. */
  destinos: Partial<Record<EspacioId, string>>;
  onNavigate?: () => void;
}) {
  const disponibles = ESPACIOS.filter((e) => destinos[e.id]);
  /* Con un solo espacio a la vista (todo el equipo salvo dirección) el selector
     sobra: sería un botón que no lleva a ningún lado. */
  if (disponibles.length < 2) return null;

  return (
    <div role="group" aria-label="Negocio" className="mb-4 flex gap-0.5 rounded-xl bg-muted p-[3px]">
      {disponibles.map((e) => {
        const Icono = ICONOS[e.id];
        const activo = e.id === actual;
        return (
          <Link
            key={e.id}
            href={destinos[e.id]!}
            onClick={onNavigate}
            aria-current={activo ? "page" : undefined}
            title={e.desc}
            className={cn(
              "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[12.5px] font-semibold transition-colors",
              activo
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icono className="size-[15px]" strokeWidth={1.9} aria-hidden="true" />
            {e.nombre}
          </Link>
        );
      })}
    </div>
  );
}
