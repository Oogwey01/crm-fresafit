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
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { ESTADOS, AREAS, ROLES, esGestor } from "@/lib/catalogos";
import { esVencida } from "@/lib/fecha";
import { moverTarea } from "@/app/(app)/tareas/actions";
import type { TaskConResponsable, Profile, EstadoId, RolId } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Column } from "@/components/tareas/column";
import { TaskCard } from "@/components/tareas/task-card";
import { TaskDialog } from "@/components/tareas/task-dialog";
import { TaskDetail } from "@/components/tareas/task-detail";
import { TaskFilters } from "@/components/tareas/task-filters";
import { CargaPersonas } from "@/components/tareas/carga-personas";
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
  const [soloVencidas, setSoloVencidas] = useState(false);
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

  /* Filtro de PERSONA (aplica en ambas vistas). "todos" = sin filtro. */
  const personaSel =
    filtroResponsable !== "todos" ? equipo.find((p) => p.id === filtroResponsable) ?? null : null;

  /* Conjuntos base (filtros de persona/área, SIN el filtro de "solo vencidas"). */
  const misBase = personaSel
    ? tareas.filter((t) => t.responsable_id === personaSel.id)
    : tareas.filter((t) => t.responsable_id === currentUserId);
  const areaBase = tareas.filter(
    (t) =>
      (filtroResponsable === "todos" || t.responsable_id === filtroResponsable) &&
      (filtroArea === "todas" || t.area === filtroArea),
  );

  /* Contador de vencidas sobre lo mostrado (antes del filtro "solo vencidas"). */
  const baseDisplayed = vista === "mis" ? misBase : areaBase;
  const vencidas = baseDisplayed.filter((t) => esVencida(t.fecha_limite, t.estado)).length;

  /* Filtro rápido "solo vencidas" (se alterna con clic en el contador). */
  const soloV = (arr: TaskConResponsable[]) =>
    soloVencidas ? arr.filter((t) => esVencida(t.fecha_limite, t.estado)) : arr;
  const misVisibles = soloV(misBase);
  const filtradas = soloV(areaBase);
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
          {/* Contador de vencidas — clic para ver SOLO las vencidas (alterna). */}
          {(vencidas > 0 || soloVencidas) && (
            <button
              type="button"
              onClick={() => setSoloVencidas((v) => !v)}
              aria-pressed={soloVencidas}
              title="Ver solo las tareas vencidas (clic para alternar)"
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-bold transition-colors",
                soloVencidas ? "bg-red-600 text-white" : "bg-red-100 text-red-600 hover:bg-red-200",
              )}
            >
              <AlertTriangle className="size-4" aria-hidden="true" />
              {vencidas} {vencidas === 1 ? "vencida" : "vencidas"}
            </button>
          )}

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

          {/* Filtro de PERSONA — visible en ambas vistas. */}
          <Select value={filtroResponsable} onValueChange={(v) => setFiltroResponsable(v ?? "todos")}>
            <SelectTrigger className="w-[190px]">
              <SelectValue>
                {(value: string) =>
                  value === "todos"
                    ? "Todas las personas"
                    : (equipo.find((p) => p.id === value)?.nombre ?? "Persona")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas las personas</SelectItem>
              {equipo.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Filtro de ÁREA — solo en la vista "Por área". */}
          {vista === "area" && (
            <TaskFilters filtroArea={filtroArea} setFiltroArea={setFiltroArea} />
          )}

          <ExportButton tareas={tareas} />
          {gestor && <Button onClick={() => setNuevaAbierta(true)}>+ Nueva tarea</Button>}
        </div>
      </div>

      {/* Aviso de rol — es el rol REAL del usuario; la seguridad se aplica en la BD (RLS). */}
      <div className="mb-4 rounded-lg border border-dashed bg-card px-3 py-2 text-xs text-muted-foreground">
        Tu acceso: <b className="text-foreground">{rolNombre}</b> — tu rol real; los permisos se
        aplican en la base de datos (RLS), no solo en pantalla.{" "}
        {ROLES.find((r) => r.id === rol)?.desc}
      </div>

      {/* Carga por persona (chips clicables = atajo de filtro "solo [persona]") */}
      <CargaPersonas
        tareas={tareas}
        equipo={equipo}
        seleccion={filtroResponsable}
        onSeleccionar={setFiltroResponsable}
      />

      {/* id fijo: evita el aviso de hidratación de dnd-kit (aria-describedby
          DndDescribedBy-0 vs -1) al hacer estable el id entre servidor y navegador. */}
      <DndContext id="tablero-fresafit" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {vista === "mis" ? (
          <>
            {personaSel && (
              <p className="mb-3 text-sm text-muted-foreground">
                Viendo solo las tareas de <b className="text-foreground">{personaSel.nombre}</b>.
              </p>
            )}
            {misVisibles.length === 0 && (
              <p className="mb-3 text-sm italic text-muted-foreground">
                {personaSel
                  ? `${personaSel.nombre} no tiene tareas asignadas por ahora.`
                  : "No tienes tareas asignadas por ahora."}
              </p>
            )}
            <div className="grid grid-cols-1 items-start gap-4 md:grid-cols-2 xl:grid-cols-4">
              {ESTADOS.map((estado) => (
                <Column
                  key={estado.id}
                  estadoId={estado.id}
                  nombre={estado.nombre}
                  tareas={misVisibles.filter((t) => t.estado === estado.id)}
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
