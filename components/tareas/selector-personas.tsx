"use client";

import { iniciales, cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

/* Chips para sumar a MÁS gente a una tarea, además de la responsable.

   Lo pidió Armando en la junta del 03/08/2026 ("le quiero poner una tarea que
   involucre a dos personas"). Va como chips y no como un segundo desplegable
   porque el equipo es de once personas y hay que ver de un golpe quién está
   dentro; un multi-select obligaría a abrirlo para saberlo.

   Quien ya es responsable principal se pinta deshabilitada: está en la tarea
   por otra vía y sumarla otra vez repetiría su avatar. */
export function SelectorPersonas({
  equipo,
  seleccionados,
  principalId,
  onToggle,
  disabled = false,
}: {
  equipo: Profile[];
  seleccionados: string[];
  principalId: string | null;
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {equipo.map((p) => {
        const esPrincipal = p.id === principalId;
        const on = seleccionados.includes(p.id);
        return (
          <button
            key={p.id}
            type="button"
            disabled={disabled || esPrincipal}
            onClick={() => onToggle(p.id)}
            title={esPrincipal ? `${p.nombre} ya es la responsable` : p.nombre}
            className={cn(
              "flex items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2.5 text-xs font-semibold transition-colors",
              "disabled:opacity-45",
              on ? "border-transparent text-white" : "text-muted-foreground hover:bg-accent",
            )}
            style={on ? { backgroundColor: p.color } : undefined}
          >
            <span
              className="flex size-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ backgroundColor: on ? "rgba(0,0,0,.22)" : p.color }}
              aria-hidden="true"
            >
              {iniciales(p.nombre)}
            </span>
            {primerNombre(p.nombre)}
          </button>
        );
      })}
    </div>
  );
}

/* En los chips cabe el nombre de pila; el completo va en el `title`. */
function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}
