"use client";

import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { AREAS, ESTADOS, PRIORIDADES, obtenerEstado, obtenerPrioridad } from "@/lib/catalogos";
import { esVencida, formatearFecha } from "@/lib/fecha";
import type { TaskConResponsable, EstadoId, PrioridadId } from "@/lib/types";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[minmax(160px,1fr)_170px_150px_130px_110px]";

function iniciales(nombre: string): string {
  const p = nombre.trim().split(/\s+/);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase();
}

/* Celda que en móvil muestra la etiqueta de la columna (label:valor dentro de la
   tarjeta) y en escritorio es una celda normal de la tabla. Un solo DOM: los
   selects editables no se duplican. */
function Celda({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 md:block">
      <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:hidden">
        {label}
      </span>
      <div className="min-w-0 text-right md:text-left">{children}</div>
    </div>
  );
}

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
}: {
  tareas: TaskConResponsable[];
  currentUserId: string;
  gestor: boolean;
  onAbrir: (t: TaskConResponsable) => void;
  onMoverEstado: (id: string, estado: EstadoId) => void;
  onCambiarPrioridad: (id: string, prioridad: PrioridadId) => void;
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

  return (
    <div className="rounded-2xl border bg-card shadow-sm md:overflow-x-auto">
      <div className="md:min-w-[760px]">
        {/* Encabezado de columnas (solo escritorio; en móvil cada tarjeta trae sus etiquetas) */}
        <div className={cn("hidden gap-2 border-b bg-muted/40 px-6 py-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground md:grid", COLS)}>
          <div>Tarea</div>
          <div>Responsable</div>
          <div>Estado</div>
          <div>Prioridad</div>
          <div>Fecha</div>
        </div>

        {grupos.map(({ area, items }) => {
          const cerrado = colapsados.has(area.id);
          return (
            <div key={area.id}>
              {/* Encabezado de grupo (área) */}
              <button
                type="button"
                onClick={() => toggle(area.id)}
                className="flex w-full items-center gap-2.5 border-b bg-muted/20 px-6 py-2.5 text-left hover:bg-muted/40"
              >
                {cerrado ? (
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                )}
                <span className="inline-block size-2 rounded-[3px]" style={{ backgroundColor: area.color }} />
                <span className="text-[13.5px] font-bold">{area.nombre}</span>
                <span className="rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
                  {items.length}
                </span>
              </button>

              {/* Expandir/colapsar animado: grid-template-rows 0fr→1fr evita el
                  salto brusco del montaje/desmontaje directo. */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-300 ease-out",
                  cerrado ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
                )}
              >
                <div className="overflow-hidden">
                <div
                  className={cn(
                    "flex flex-col gap-2.5 p-3 transition-opacity duration-300 md:gap-0 md:p-0",
                    cerrado ? "opacity-0" : "opacity-100",
                  )}
                >
                  {items.map((t) => {
                    const vencida = esVencida(t.fecha_limite, t.estado);
                    const puedeEstado = gestor || t.responsable_id === currentUserId;
                    return (
                      <div
                        key={t.id}
                        className={cn(
                          // Móvil: tarjeta. Escritorio: fila de tabla.
                          "flex flex-col gap-2 rounded-xl border bg-card p-3.5 text-sm md:grid md:items-center md:gap-2 md:rounded-none md:border-0 md:border-b md:bg-transparent md:p-0 md:px-6 md:py-3 md:last:border-b-0 md:hover:bg-accent/30",
                          COLS,
                        )}
                      >
                        {/* Tarea (encabezado de la tarjeta en móvil) */}
                        <button
                          type="button"
                          onClick={() => onAbrir(t)}
                          className="truncate text-left font-medium hover:underline"
                          title={t.titulo}
                        >
                          {t.titulo}
                        </button>

                        {/* Responsable */}
                        <Celda label="Responsable">
                          {t.responsable ? (
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
                          )}
                        </Celda>

                        {/* Estado (editable en celda) */}
                        <Celda label="Estado">
                          {puedeEstado ? (
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
                          )}
                        </Celda>

                        {/* Prioridad (editable en celda solo gestor) */}
                        <Celda label="Prioridad">
                          {gestor ? (
                            <Select
                              value={t.prioridad}
                              onValueChange={(v) => v && onCambiarPrioridad(t.id, v as PrioridadId)}
                            >
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
                          )}
                        </Celda>

                        {/* Fecha límite */}
                        <Celda label="Fecha">
                          {t.fecha_limite ? (
                            <span
                              className={cn(
                                "inline-flex items-center gap-1",
                                vencida && "font-semibold text-red-600",
                              )}
                            >
                              {vencida && <AlertTriangle className="size-3.5" aria-label="Vencida" />}
                              {formatearFecha(t.fecha_limite)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground/50">—</span>
                          )}
                        </Celda>
                      </div>
                    );
                  })}
                </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
