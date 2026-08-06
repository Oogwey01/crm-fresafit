"use client";

import { iniciales, cn } from "@/lib/utils";
import { equipoDeTarea } from "@/lib/tareas/reglas";
import type { Profile, TaskConResponsable } from "@/lib/types";

/* Quién trabaja una tarea, en una línea: la responsable con su nombre y las
   acompañantes como avatares encimados detrás.

   Se muestra el nombre solo de la principal a propósito: con dos o tres
   personas los nombres completos no caben en una tarjeta del tablero, y la
   principal es la que responde por la tarea. Las demás salen como iniciales
   con su nombre en el `title`, y un "+N" cuando pasan de `maximo`. */
export function AvataresEquipo({
  tarea,
  tamano = "sm",
  maximo = 3,
  className,
}: {
  tarea: Pick<TaskConResponsable, "responsable" | "coasignados">;
  tamano?: "sm" | "md";
  maximo?: number;
  className?: string;
}) {
  const equipo = equipoDeTarea(tarea);

  if (equipo.length === 0) {
    return <span className={cn("italic text-muted-foreground", className)}>Sin asignar</span>;
  }

  const [principal, ...resto] = equipo;
  const visibles = resto.slice(0, maximo);
  const ocultos = resto.length - visibles.length;
  const medida = tamano === "md" ? "size-6" : "size-5";
  const letra = tamano === "md" ? "text-[10px]" : "text-[9px]";

  return (
    <span className={cn("flex min-w-0 items-center gap-1.5 font-medium text-foreground", className)}>
      <Avatar persona={principal} medida={medida} letra={letra} />
      <span className="truncate">{principal.nombre}</span>
      {resto.length > 0 && (
        <span className="flex shrink-0 items-center -space-x-1.5" title={resto.map((p) => p.nombre).join(", ")}>
          {visibles.map((p) => (
            <Avatar key={p.id} persona={p} medida={medida} letra={letra} anillo />
          ))}
          {ocultos > 0 && (
            <span
              className={cn(
                "flex shrink-0 items-center justify-center rounded-full bg-muted font-bold text-muted-foreground ring-2 ring-card",
                medida,
                letra,
              )}
            >
              +{ocultos}
            </span>
          )}
        </span>
      )}
    </span>
  );
}

function Avatar({
  persona,
  medida,
  letra,
  anillo = false,
}: {
  persona: Pick<Profile, "id" | "nombre" | "color">;
  medida: string;
  letra: string;
  anillo?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-white",
        medida,
        letra,
        anillo && "ring-2 ring-card",
      )}
      style={{ backgroundColor: persona.color }}
      title={persona.nombre}
      aria-label={persona.nombre}
    >
      {iniciales(persona.nombre)}
    </span>
  );
}
