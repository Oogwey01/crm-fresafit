"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AlertTriangle, CheckSquare, ChevronLeft, ChevronRight } from "lucide-react";
import { ESTADOS, obtenerPrioridad, obtenerArea, obtenerEtiqueta } from "@/lib/catalogos";
import { formatearFecha, esVencida } from "@/lib/fecha";
import type { TaskConResponsable, EstadoId } from "@/lib/types";
import { cn, iniciales } from "@/lib/utils";

export function TaskCard({
  tarea,
  onMover,
  onEditar,
  overlay = false,
  checklist,
}: {
  tarea: TaskConResponsable;
  onMover?: (id: string, estado: EstadoId) => void;
  onEditar?: (t: TaskConResponsable) => void;
  overlay?: boolean;
  /* Resumen de subtareas para el chip de progreso (si la tarea tiene). */
  checklist?: { total: number; hechos: number };
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
        "flex flex-col gap-2.5 rounded-xl border border-l-4 bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md",
        !overlay && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
        vencida && "ring-1 ring-red-300",
      )}
    >
      {/* Título */}
      <div className="text-[13.5px] font-semibold leading-snug">{tarea.titulo}</div>

      {/* Meta: prioridad · área · subtareas */}
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        {prioridad && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold"
            style={{ backgroundColor: `${prioridad.color}1f`, color: prioridad.color }}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: prioridad.color }} />
            {prioridad.nombre}
          </span>
        )}
        {area && (
          <span className="rounded-full bg-muted px-2 py-0.5 font-semibold text-muted-foreground">
            {area.nombre}
          </span>
        )}
        {checklist && checklist.total > 0 && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold",
              checklist.hechos === checklist.total
                ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                : "bg-muted text-muted-foreground",
            )}
            title="Subtareas completadas"
          >
            <CheckSquare className="size-3" strokeWidth={2} />
            {checklist.hechos}/{checklist.total}
          </span>
        )}
      </div>

      {/* Etiquetas (renglón propio, sólo si hay) */}
      {(tarea.etiquetas ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
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
      )}

      {/* Motivo cuando está atorada */}
      {tarea.estado === "atorado" && tarea.motivo_atorado && (
        <div
          className="rounded-md bg-orange-50 px-2.5 py-1.5 text-[11.5px] leading-snug text-orange-700 dark:bg-orange-950 dark:text-orange-300"
          title={tarea.motivo_atorado}
        >
          <span aria-hidden="true">⚠ </span>
          <span className="line-clamp-2">{tarea.motivo_atorado}</span>
        </div>
      )}

      {/* Pie: responsable + fecha */}
      <div className="flex items-center justify-between gap-2 text-xs">
        {tarea.responsable ? (
          <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white"
              style={{ backgroundColor: tarea.responsable.color }}
              aria-hidden="true"
            >
              {iniciales(tarea.responsable.nombre)}
            </span>
            <span className="truncate">{tarea.responsable.nombre}</span>
          </span>
        ) : (
          <span className="italic text-muted-foreground">Sin asignar</span>
        )}
        {tarea.fecha_limite && (
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground",
              vencida && "bg-red-100 font-bold text-red-600 dark:bg-red-950 dark:text-red-300",
            )}
            title={vencida ? "Tarea vencida" : undefined}
          >
            {vencida && <AlertTriangle className="size-3" aria-label="Vencida" />}
            {formatearFecha(tarea.fecha_limite)}
          </span>
        )}
      </div>

      {/* Acciones: mover ◀ ▶ + editar */}
      {!overlay && (
        <div className="flex items-center gap-1.5 border-t pt-2.5">
          {idx > 0 && (
            <button
              type="button"
              aria-label={`Mover a ${ESTADOS[idx - 1].nombre}`}
              title={`Mover a ${ESTADOS[idx - 1].nombre}`}
              onClick={(e) => {
                e.stopPropagation();
                onMover?.(tarea.id, ESTADOS[idx - 1].id);
              }}
              className="flex size-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <ChevronLeft className="size-3.5" />
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
              className="flex size-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <ChevronRight className="size-3.5" />
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
            Abrir
          </button>
        </div>
      )}
    </div>
  );
}
