"use client";

import { useState } from "react";
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
    <div className="overflow-x-auto rounded-lg border">
      <div className="min-w-[760px]">
        {/* Encabezado de columnas */}
        <div className={cn("grid gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-bold uppercase tracking-wide text-muted-foreground", COLS)}>
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
                className="flex w-full items-center gap-2 border-b bg-card px-3 py-2 text-left hover:bg-muted/40"
              >
                {cerrado ? (
                  <ChevronRight className="size-4 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-4 text-muted-foreground" />
                )}
                <span className="inline-block h-4 w-1.5 rounded" style={{ backgroundColor: area.color }} />
                <span className="text-sm font-bold">{area.nombre}</span>
                <span className="text-xs text-muted-foreground">· {items.length}</span>
              </button>

              {!cerrado &&
                items.map((t) => {
                  const vencida = esVencida(t.fecha_limite, t.estado);
                  const puedeEstado = gestor || t.responsable_id === currentUserId;
                  return (
                    <div
                      key={t.id}
                      className={cn("grid items-center gap-2 border-b px-3 py-2 text-sm hover:bg-muted/30", COLS)}
                    >
                      {/* Tarea */}
                      <button
                        type="button"
                        onClick={() => onAbrir(t)}
                        className="truncate text-left font-medium hover:underline"
                        title={t.titulo}
                      >
                        {t.titulo}
                      </button>

                      {/* Responsable */}
                      {t.responsable ? (
                        <span className="flex items-center gap-2">
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

                      {/* Estado (editable en celda) */}
                      <div>
                        {puedeEstado ? (
                          <Select value={t.estado} onValueChange={(v) => v && onMoverEstado(t.id, v as EstadoId)}>
                            <SelectTrigger className="h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0">
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
                      </div>

                      {/* Prioridad (editable en celda solo gestor) */}
                      <div>
                        {gestor ? (
                          <Select
                            value={t.prioridad}
                            onValueChange={(v) => v && onCambiarPrioridad(t.id, v as PrioridadId)}
                          >
                            <SelectTrigger className="h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0">
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
                      </div>

                      {/* Fecha límite */}
                      <div>
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
                      </div>
                    </div>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
