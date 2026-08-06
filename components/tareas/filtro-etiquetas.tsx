"use client";

import { Tag, X } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ETIQUETAS } from "@/lib/catalogos";
import { cn } from "@/lib/utils";

/* Filtro por ETIQUETA para el módulo de tareas.

   Hasta ahora las etiquetas solo se pintaban: se podían poner, pero no se podía
   preguntar por ellas ("enséñame lo de Fondo blanco", "qué traemos de Bodega").
   Este es ese filtro, y funciona en las cuatro vistas (tabla, tablero,
   calendario y la lista del teléfono) porque vive en el <Board>.

   Multi-selección con lógica O: la tarea entra si tiene ALGUNA de las marcadas.
   Con Y (todas a la vez) casi cualquier combinación devuelve cero, porque una
   tarea rara vez lleva dos etiquetas del mismo tema.

   Solo se ofrecen las etiquetas que de verdad están puestas en lo que se está
   mirando —igual que el filtro de "quién asignó"—: el catálogo tiene 35 y
   listarlas todas sería una parrilla donde 30 no encuentran nada. Las ya
   marcadas se siguen ofreciendo aunque su cuenta caiga a cero; si no, no habría
   forma de desmarcarlas. */
export function FiltroEtiquetas({
  tareas,
  seleccionadas,
  onCambiar,
  className,
  compacto = false,
}: {
  /* Sobre lo que se cuenta: el conjunto YA filtrado por alcance/persona/cliente,
     pero antes de este filtro, para que los números digan lo que se ve. */
  tareas: { etiquetas?: string[] | null }[];
  seleccionadas: string[];
  onCambiar: (ids: string[]) => void;
  className?: string;
  /* Rótulo corto para la barra de chips del teléfono. */
  compacto?: boolean;
}) {
  const conteo = new Map<string, number>();
  for (const t of tareas) {
    for (const id of t.etiquetas ?? []) conteo.set(id, (conteo.get(id) ?? 0) + 1);
  }

  /* Orden del catálogo (transversales primero, luego por área), no orden de
     aparición: así el bloque se lee siempre igual. */
  const disponibles = ETIQUETAS.filter((e) => conteo.has(e.id) || seleccionadas.includes(e.id));

  /* Sin ninguna etiqueta puesta en el tablero, el botón sería un callejón sin
     salida: mejor no ocupar sitio en la barra. */
  if (disponibles.length === 0) return null;

  function alternar(id: string) {
    onCambiar(seleccionadas.includes(id) ? seleccionadas.filter((x) => x !== id) : [...seleccionadas, id]);
  }

  const activo = seleccionadas.length > 0;

  return (
    <Popover>
      <PopoverTrigger
        title="Ver solo las tareas con alguna de estas etiquetas"
        className={cn(
          "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors",
          activo
            ? "border-primary bg-primary/10 text-primary"
            : "bg-card text-muted-foreground hover:text-foreground",
          className,
        )}
      >
        <Tag className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
        {compacto ? "Etiq." : "Etiquetas"}
        {activo && (
          <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
            {seleccionadas.length}
          </span>
        )}
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[290px]">
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Filtrar por etiqueta
          </span>
          {activo && (
            <button
              type="button"
              onClick={() => onCambiar([])}
              className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" strokeWidth={2.2} aria-hidden="true" />
              Limpiar
            </button>
          )}
        </div>

        <div className="flex max-h-[320px] flex-wrap gap-1.5 overflow-y-auto">
          {disponibles.map((et) => {
            const on = seleccionadas.includes(et.id);
            const n = conteo.get(et.id) ?? 0;
            return (
              <button
                key={et.id}
                type="button"
                onClick={() => alternar(et.id)}
                aria-pressed={on}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors",
                  on ? "text-white" : "text-muted-foreground hover:bg-accent",
                )}
                style={on ? { backgroundColor: et.color, borderColor: et.color } : undefined}
              >
                {!on && (
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: et.color }}
                    aria-hidden="true"
                  />
                )}
                {et.nombre}
                <span className={cn("text-[11px] font-bold", on ? "text-white/75" : "text-muted-foreground/60")}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>

        {activo && (
          <p className="mt-2 border-t pt-2 text-[11.5px] leading-snug text-muted-foreground">
            Se muestran las tareas que tengan <b className="font-semibold">alguna</b> de las{" "}
            {seleccionadas.length === 1 ? "etiqueta marcada" : `${seleccionadas.length} etiquetas marcadas`}.
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

/* Chips de las etiquetas de una tarea, para las listas (tabla y teléfono).
   `maximo` recorta y resume el resto en un "+N" para no reventar el ancho de
   una celda; el título del contenedor lleva la lista completa. */
export function ChipsEtiquetas({
  ids,
  maximo = 2,
  className,
}: {
  ids: string[] | null | undefined;
  maximo?: number;
  className?: string;
}) {
  const puestas = (ids ?? [])
    .map((id) => ETIQUETAS.find((e) => e.id === id))
    .filter((e): e is (typeof ETIQUETAS)[number] => !!e);
  if (puestas.length === 0) return <span className="text-muted-foreground/50">—</span>;

  const visibles = puestas.slice(0, maximo);
  const resto = puestas.length - visibles.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1", className)} title={puestas.map((e) => e.nombre).join(", ")}>
      {visibles.map((et) => (
        <span
          key={et.id}
          className="inline-flex max-w-full items-center truncate rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
          style={{ backgroundColor: et.color }}
        >
          {et.nombre}
        </span>
      ))}
      {resto > 0 && (
        <span className="inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
          +{resto}
        </span>
      )}
    </div>
  );
}
