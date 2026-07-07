"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ESTADOS, obtenerPrioridad, obtenerArea, obtenerEtiqueta } from "@/lib/catalogos";
import { formatearFecha, esVencida } from "@/lib/fecha";
import type { TaskConResponsable, EstadoId } from "@/lib/types";
import { cn } from "@/lib/utils";

export function TaskCard({
  tarea,
  onMover,
  onEditar,
  overlay = false,
}: {
  tarea: TaskConResponsable;
  onMover?: (id: string, estado: EstadoId) => void;
  onEditar?: (t: TaskConResponsable) => void;
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({ id: tarea.id, disabled: overlay });

  const prioridad = obtenerPrioridad(tarea.prioridad);
  const area = obtenerArea(tarea.area);
  const idx = ESTADOS.findIndex((e) => e.id === tarea.estado);
  const vencida = esVencida(tarea.fecha_limite, tarea.estado);

  const style: React.CSSProperties = {
    borderLeftColor: prioridad?.color ?? "#ccc",
    ...(transform ? { transform: CSS.Translate.toString(transform) } : {}),
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(overlay ? {} : { ...listeners, ...attributes })}
      onClick={() => onEditar?.(tarea)}
      className={cn(
        "rounded-lg border-l-4 bg-card p-3 shadow-sm transition-shadow hover:shadow-md",
        !overlay && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      {/* Título */}
      <div className="mb-2 text-sm font-semibold leading-snug">
        {tarea.titulo}
      </div>

      {/* Etiquetas */}
      <div className="mb-2.5 flex flex-wrap gap-1.5">
        {prioridad && (
          <span
            className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
            style={{ backgroundColor: prioridad.color }}
          >
            {prioridad.nombre}
          </span>
        )}
        {area && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {area.nombre}
          </span>
        )}
        {(tarea.etiquetas ?? []).map((id) => {
          const et = obtenerEtiqueta(id);
          if (!et) return null;
          return (
            <span
              key={id}
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-white"
              style={{ backgroundColor: et.color }}
            >
              {et.nombre}
            </span>
          );
        })}
      </div>

      {/* Pie: responsable + fecha */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        {tarea.responsable ? (
          <span className="flex items-center gap-1.5 font-semibold text-foreground">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: tarea.responsable.color }}
            />
            {tarea.responsable.nombre}
          </span>
        ) : (
          <span className="italic">Sin asignar</span>
        )}
        {tarea.fecha_limite && (
          <span
            className={cn(
              "rounded-md bg-muted px-1.5 py-0.5",
              vencida && "bg-red-100 font-bold text-red-600",
            )}
          >
            {formatearFecha(tarea.fecha_limite)}
          </span>
        )}
      </div>

      {/* Acciones: mover ◀ ▶ + editar */}
      {!overlay && (
        <div className="mt-2.5 flex items-center gap-1.5 border-t pt-2.5">
          {idx > 0 && (
            <button
              type="button"
              aria-label={`Mover a ${ESTADOS[idx - 1].nombre}`}
              title={`Mover a ${ESTADOS[idx - 1].nombre}`}
              onClick={(e) => {
                e.stopPropagation();
                onMover?.(tarea.id, ESTADOS[idx - 1].id);
              }}
              className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <span aria-hidden="true">◀</span>
            </button>
          )}
          {idx < ESTADOS.length - 1 && (
            <button
              type="button"
              aria-label={`Mover a ${ESTADOS[idx + 1].nombre}`}
              title={`Mover a ${ESTADOS[idx + 1].nombre}`}
              onClick={(e) => {
                e.stopPropagation();
                onMover?.(tarea.id, ESTADOS[idx + 1].id);
              }}
              className="rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <span aria-hidden="true">▶</span>
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onEditar?.(tarea);
            }}
            className="ml-auto rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            Editar
          </button>
        </div>
      )}
    </div>
  );
}
