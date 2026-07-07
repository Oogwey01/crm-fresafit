"use client";

import { useOptimistic, useState, useTransition } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { toast } from "sonner";
import { ESTADOS, AREAS, ROLES, esGestor } from "@/lib/catalogos";
import { moverTarea } from "@/app/(app)/tareas/actions";
import type { TaskConResponsable, Profile, EstadoId, RolId } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Column } from "@/components/tareas/column";
import { TaskCard } from "@/components/tareas/task-card";
import { TaskDialog } from "@/components/tareas/task-dialog";
import { TaskDetail } from "@/components/tareas/task-detail";
import { TaskFilters } from "@/components/tareas/task-filters";
import { ExportButton } from "@/components/tareas/export-button";

type Vista = "mis" | "area";

export function Board({
  tareas: inicial,
  equipo,
  currentUserId,
  rol,
}: {
  tareas: TaskConResponsable[];
  equipo: Profile[];
  currentUserId: string;
  rol: RolId;
}) {
  const gestor = esGestor(rol);

  const [tareas, aplicarMovimiento] = useOptimistic(
    inicial,
    (estado, m: { id: string; nuevoEstado: EstadoId }) =>
      estado.map((t) => (t.id === m.id ? { ...t, estado: m.nuevoEstado } : t)),
  );

  const [vista, setVista] = useState<Vista>("mis");
  const [filtroResponsable, setFiltroResponsable] = useState("todos");
  const [filtroArea, setFiltroArea] = useState("todas");
  const [, startTransition] = useTransition();

  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  const [detalle, setDetalle] = useState<TaskConResponsable | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function mover(id: string, nuevoEstado: EstadoId) {
    const actual = tareas.find((t) => t.id === id);
    if (!actual || actual.estado === nuevoEstado) return;
    startTransition(async () => {
      aplicarMovimiento({ id, nuevoEstado });
      try {
        const r = await moverTarea(id, nuevoEstado);
        if ("error" in r) toast.error("No se pudo mover: " + r.error);
      } catch {
        toast.error("No se pudo mover la tarea. Revisa tu conexión.");
      }
    });
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const raw = String(over.id);
    const estado = (raw.includes("::") ? raw.split("::")[1] : raw) as EstadoId;
    if (ESTADOS.some((es) => es.id === estado)) mover(String(active.id), estado);
  }

  const activa = activeId ? tareas.find((t) => t.id === activeId) : null;

  /* Vista "Mis tareas": solo lo asignado a mí. */
  const mias = tareas.filter((t) => t.responsable_id === currentUserId);

  /* Vista "Por área": aplica filtros. */
  const filtradas = tareas.filter(
    (t) =>
      (filtroResponsable === "todos" || t.responsable_id === filtroResponsable) &&
      (filtroArea === "todas" || t.area === filtroArea),
  );
  const areasVisibles = AREAS.filter(
    (a) => (filtroArea === "todas" || a.id === filtroArea) && filtradas.some((t) => t.area === a.id),
  );

  const rolNombre = ROLES.find((r) => r.id === rol)?.nombre ?? "Miembro";

  return (
    <div>
      {/* Barra superior */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Tareas del equipo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quién hace qué y en qué va cada cosa — sin perseguir a nadie.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Conmutador de vista */}
          <div className="inline-flex rounded-lg bg-muted p-0.5">
            {(
              [
                ["mis", "Mis tareas"],
                ["area", "Por área"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setVista(id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  vista === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {vista === "area" && (
            <TaskFilters
              equipo={equipo}
              filtroResponsable={filtroResponsable}
              setFiltroResponsable={setFiltroResponsable}
              filtroArea={filtroArea}
              setFiltroArea={setFiltroArea}
            />
          )}
          <ExportButton tareas={tareas} />
          {gestor && <Button onClick={() => setNuevaAbierta(true)}>+ Nueva tarea</Button>}
        </div>
      </div>

      {/* Aviso de rol */}
      <div className="mb-4 rounded-lg border border-dashed bg-card px-3 py-2 text-xs text-muted-foreground">
        Estás viendo como <b className="text-foreground">{rolNombre}</b>.{" "}
        {ROLES.find((r) => r.id === rol)?.desc}
      </div>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {vista === "mis" ? (
          <>
            {mias.length === 0 && (
              <p className="mb-3 text-sm italic text-muted-foreground">
                No tienes tareas asignadas por ahora.
              </p>
            )}
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
              {ESTADOS.map((estado) => (
                <Column
                  key={estado.id}
                  estadoId={estado.id}
                  nombre={estado.nombre}
                  tareas={mias.filter((t) => t.estado === estado.id)}
                  onMover={mover}
                  onEditar={setDetalle}
                />
              ))}
            </div>
          </>
        ) : areasVisibles.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            No hay tareas para mostrar con estos filtros.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Encabezado de columnas (una vez, arriba) */}
            <div className="hidden gap-4 xl:grid xl:grid-cols-4">
              {ESTADOS.map((e) => (
                <div key={e.id} className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {e.nombre}
                </div>
              ))}
            </div>

            {areasVisibles.map((area) => {
              const delArea = filtradas.filter((t) => t.area === area.id);
              return (
                <div key={area.id}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className="inline-block h-4 w-1.5 rounded" style={{ backgroundColor: area.color }} />
                    <span className="text-sm font-bold">{area.nombre}</span>
                    <span className="text-xs text-muted-foreground">
                      {delArea.length} {delArea.length === 1 ? "tarea" : "tareas"}
                    </span>
                  </div>
                  <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {ESTADOS.map((estado) => (
                      <Column
                        key={estado.id}
                        estadoId={estado.id}
                        droppableId={`${area.id}::${estado.id}`}
                        nombre={estado.nombre}
                        tareas={delArea.filter((t) => t.estado === estado.id)}
                        onMover={mover}
                        onEditar={setDetalle}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DragOverlay>{activa ? <TaskCard tarea={activa} overlay /> : null}</DragOverlay>
      </DndContext>

      {nuevaAbierta && (
        <TaskDialog
          equipo={equipo}
          currentUserId={currentUserId}
          onClose={() => setNuevaAbierta(false)}
        />
      )}

      {detalle && (
        <TaskDetail
          key={detalle.id}
          tarea={detalle}
          equipo={equipo}
          rol={rol}
          currentUserId={currentUserId}
          onClose={() => setDetalle(null)}
        />
      )}
    </div>
  );
}
