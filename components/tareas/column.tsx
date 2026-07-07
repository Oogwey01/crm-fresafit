"use client";

import { useDroppable } from "@dnd-kit/core";
import { TaskCard } from "@/components/tareas/task-card";
import type { TaskConResponsable, EstadoId } from "@/lib/types";
import { cn } from "@/lib/utils";

export function Column({
  estadoId,
  droppableId,
  nombre,
  tareas,
  onMover,
  onEditar,
}: {
  estadoId: EstadoId;
  /** Id único del droppable (por si hay varios carriles con el mismo estado). */
  droppableId?: string;
  nombre?: string;
  tareas: TaskConResponsable[];
  onMover: (id: string, estado: EstadoId) => void;
  onEditar: (t: TaskConResponsable) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: droppableId ?? estadoId });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-32 rounded-xl bg-muted/60 p-2.5 transition-colors",
        isOver && "bg-primary/10 outline-2 outline-dashed outline-primary",
      )}
    >
      {nombre && (
        <div className="flex items-center justify-between px-1.5 pb-2.5 pt-1">
          <span className="text-sm font-bold">{nombre}</span>
          <span className="rounded-full bg-background px-2 py-0.5 text-xs font-bold text-muted-foreground">
            {tareas.length}
          </span>
        </div>
      )}

      <div className="flex min-h-16 flex-col gap-2.5">
        {tareas.length === 0 ? (
          <div className="py-4 text-center text-sm italic text-muted-foreground/60">
            Sin tareas
          </div>
        ) : (
          tareas.map((t) => (
            <TaskCard key={t.id} tarea={t} onMover={onMover} onEditar={onEditar} />
          ))
        )}
      </div>
    </div>
  );
}
