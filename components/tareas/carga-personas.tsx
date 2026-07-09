"use client";

import type { TaskConResponsable, Profile } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Barra de "carga por persona": un chip por integrante con su número de tareas
   activas (no "Hecho"), ordenado de mayor a menor para ver quién trae más.
   El chip también funciona como atajo de filtro: al hacer clic se filtra el
   tablero a esa persona (y otro clic lo quita). El estado del filtro vive en el
   Board (prop `seleccion` / `onSeleccionar`), compartido con el <Select> de persona. */
export function CargaPersonas({
  tareas,
  equipo,
  seleccion,
  onSeleccionar,
}: {
  tareas: TaskConResponsable[];
  equipo: Profile[];
  seleccion: string; // "todos" o el id del perfil
  onSeleccionar: (id: string) => void;
}) {
  const activas = tareas.filter((t) => t.estado !== "hecho");
  const conteo = new Map<string, number>();
  for (const t of activas) {
    if (t.responsable_id) conteo.set(t.responsable_id, (conteo.get(t.responsable_id) ?? 0) + 1);
  }

  const items = equipo
    .map((p) => ({ p, n: conteo.get(p.id) ?? 0 }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n);

  if (items.length === 0) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Carga por persona
      </span>
      {items.map(({ p, n }) => {
        const activo = seleccion === p.id;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onSeleccionar(activo ? "todos" : p.id)}
            aria-pressed={activo}
            title={`${p.nombre}: ${n} ${n === 1 ? "tarea activa" : "tareas activas"}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
              activo
                ? "border-primary bg-primary/10 text-foreground"
                : "border-transparent bg-card text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
            {p.nombre.split(" ")[0]}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-bold text-foreground">
              {n}
            </span>
          </button>
        );
      })}
    </div>
  );
}
