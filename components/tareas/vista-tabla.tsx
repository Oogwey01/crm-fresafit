"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { AREAS, ESTADOS, PRIORIDADES, obtenerEstado, obtenerPrioridad } from "@/lib/catalogos";
import { esVencida, formatearFecha, formatearFechaHora } from "@/lib/fecha";
import { tieneNovedades, type TaskConResponsable, type EstadoId, type PrioridadId } from "@/lib/types";
import { cn, iniciales } from "@/lib/utils";

const COLS = "grid-cols-[minmax(160px,1fr)_150px_140px_120px_100px_150px]";

function PastillaEstado({ estado }: { estado: string }) {
  const e = obtenerEstado(estado);
  if (!e) return null;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-white"
      style={{ backgroundColor: e.color }}
    >
      {e.nombre}
    </span>
  );
}

function Prioridad({ prioridad }: { prioridad: string }) {
  const p = obtenerPrioridad(prioridad);
  if (!p) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
      {p.nombre}
    </span>
  );
}

export function VistaTabla({
  tareas,
  currentUserId,
  gestor,
  onAbrir,
  onMoverEstado,
  onCambiarPrioridad,
  checklistPorTarea,
}: {
  tareas: TaskConResponsable[];
  currentUserId: string;
  gestor: boolean;
  onAbrir: (t: TaskConResponsable) => void;
  onMoverEstado: (id: string, estado: EstadoId) => void;
  onCambiarPrioridad: (id: string, prioridad: PrioridadId) => void;
  checklistPorTarea?: Record<string, { total: number; hechos: number }>;
}) {
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  function toggle(areaId: string) {
    setColapsados((prev) => {
      const s = new Set(prev);
      if (s.has(areaId)) s.delete(areaId);
      else s.add(areaId);
      return s;
    });
  }

  const grupos = AREAS.map((a) => ({ area: a, items: tareas.filter((t) => t.area === a.id) })).filter(
    (g) => g.items.length > 0,
  );

  if (grupos.length === 0) {
    return <p className="text-sm italic text-muted-foreground">No hay tareas para mostrar.</p>;
  }

  const columnas: Columna<TaskConResponsable>[] = [
    {
      clave: "tarea",
      label: "Tarea",
      esTitulo: true,
      celda: (t) => {
        const chk = checklistPorTarea?.[t.id];
        return (
          <div className="flex min-w-0 items-center gap-2">
            {tieneNovedades(t) && (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                title="Hay algo nuevo desde la última vez que la abriste"
                aria-label="Con novedades"
              />
            )}
            <button
              type="button"
              onClick={() => onAbrir(t)}
              className="truncate text-left font-medium hover:underline"
              title={t.titulo}
            >
              {t.titulo}
            </button>
            {chk && chk.total > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                title="Subtareas completadas"
              >
                ☑ {chk.hechos}/{chk.total}
              </span>
            )}
          </div>
        );
      },
    },
    {
      clave: "responsable",
      label: "Responsable",
      celda: (t) =>
        t.responsable ? (
          <span className="flex items-center justify-end gap-2 md:justify-start">
            <span
              className="flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ backgroundColor: t.responsable.color }}
            >
              {iniciales(t.responsable.nombre)}
            </span>
            <span className="truncate">{t.responsable.nombre}</span>
          </span>
        ) : (
          <span className="italic text-muted-foreground">Sin asignar</span>
        ),
    },
    {
      clave: "estado",
      label: "Estado",
      /* Editable en celda si es el responsable (o gestor). */
      celda: (t) =>
        gestor || t.responsable_id === currentUserId ? (
          <Select value={t.estado} onValueChange={(v) => v && onMoverEstado(t.id, v as EstadoId)}>
            <SelectTrigger className="ml-auto h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 md:ml-0">
              <PastillaEstado estado={t.estado} />
            </SelectTrigger>
            <SelectContent>
              {ESTADOS.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <PastillaEstado estado={t.estado} />
        ),
    },
    {
      clave: "prioridad",
      label: "Prioridad",
      /* Editable en celda solo gestor. */
      celda: (t) =>
        gestor ? (
          <Select value={t.prioridad} onValueChange={(v) => v && onCambiarPrioridad(t.id, v as PrioridadId)}>
            <SelectTrigger className="ml-auto h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 md:ml-0">
              <Prioridad prioridad={t.prioridad} />
            </SelectTrigger>
            <SelectContent>
              {PRIORIDADES.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Prioridad prioridad={t.prioridad} />
        ),
    },
    {
      clave: "fecha",
      label: "Fecha",
      celda: (t) => {
        const vencida = esVencida(t.fecha_limite, t.estado);
        return t.fecha_limite ? (
          <span className={cn("inline-flex items-center gap-1", vencida && "font-semibold text-red-600")}>
            {vencida && <AlertTriangle className="size-3.5" aria-label="Vencida" />}
            {formatearFecha(t.fecha_limite)}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        );
      },
    },
    {
      /* Cuándo se movió por última vez, contando comentarios e historial. Es lo
         que Armando quería ver "desde fuera", sin abrir cada tarea. */
      clave: "actividad",
      label: "Última actualización",
      celda: (t) =>
        t.ultima_actividad_at ? (
          <span
            className={cn("text-[13px]", tieneNovedades(t) && "font-semibold text-foreground")}
            title={new Date(t.ultima_actividad_at).toLocaleString("es-MX", {
              timeZone: "America/Mexico_City",
            })}
          >
            {formatearFechaHora(t.ultima_actividad_at)}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
  ];

  /* Una TablaSimple por área; el rótulo de cada una es el encabezado de grupo
     clicable (colapsa/expande ocultando sus filas). */
  return (
    <div className="flex flex-col gap-4">
      {grupos.map(({ area, items }) => {
        const cerrado = colapsados.has(area.id);
        return (
          <TablaSimple
            key={area.id}
            cols={COLS}
            columnas={columnas}
            datos={items}
            filaKey={(t) => t.id}
            /* Toda la fila abre la tarea: apuntarle al título era innecesariamente
               fino, sobre todo en tablet. Los controles de la fila (los selects de
               estado y prioridad) siguen funcionando: TablaSimple ignora el clic
               cuando cae sobre un control. */
            onRowClick={onAbrir}
            titulo={
              <button
                type="button"
                onClick={() => toggle(area.id)}
                className="flex w-full items-center gap-2.5 text-left normal-case tracking-normal"
              >
                {cerrado ? (
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                )}
                <span className="inline-block size-2 rounded-[3px]" style={{ backgroundColor: area.color }} />
                <span className="text-[13.5px] font-bold text-foreground">{area.nombre}</span>
                <span className="rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
                  {items.length}
                </span>
              </button>
            }
            filaClassName={() => (cerrado ? "hidden" : "")}
          />
        );
      })}
    </div>
  );
}
