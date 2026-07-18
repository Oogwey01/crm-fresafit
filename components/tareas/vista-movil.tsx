"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Info, Plus } from "lucide-react";
import { AREAS, ROLES, obtenerPrioridad } from "@/lib/catalogos";
import { esVencida, formatearFecha } from "@/lib/fecha";
import type { EstadoId, RolId, TaskConResponsable } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Vista móvil del módulo Tareas (portada del diseño de Claude Design).
   Lista agrupada por ÁREA con tarjetas compactas — en vez de las vistas
   tabla/tablero/calendario que manda en escritorio. Comparte el estado global
   (alcance / solo vencidas) y los modales con el <Board>. */

type Alcance = "mis" | "todas";

/* Pastilla de estado — tintes suaves tomados del diseño móvil. */
const ESTILO_ESTADO: Record<EstadoId, { nombre: string; bg: string; color: string; dot: string }> = {
  por_hacer: { nombre: "Por hacer", bg: "#F1F3F6", color: "#5A6474", dot: "#94A3B8" },
  en_proceso: { nombre: "En proceso", bg: "#FEF3E2", color: "#B45309", dot: "#F59E0B" },
  en_revision: { nombre: "En revisión", bg: "#F1ECFE", color: "#6D28D9", dot: "#8B5CF6" },
  hecho: { nombre: "Hecho", bg: "#E9F8F1", color: "#0E8A5F", dot: "#12B981" },
};

/* Iniciales del avatar: primeras letras de las dos primeras palabras del nombre. */
function iniciales(nombre: string): string {
  const partes = nombre.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? "") + (partes[1]?.[0] ?? "")).toUpperCase();
}

export function VistaMovil({
  tareas,
  currentUserId,
  gestor,
  rol,
  alcance,
  setAlcance,
  soloVencidas,
  setSoloVencidas,
  onAbrir,
  onNueva,
}: {
  tareas: TaskConResponsable[];
  currentUserId: string;
  gestor: boolean;
  rol: RolId;
  alcance: Alcance;
  setAlcance: (a: Alcance) => void;
  soloVencidas: boolean;
  setSoloVencidas: (fn: (v: boolean) => boolean) => void;
  onAbrir: (t: TaskConResponsable) => void;
  onNueva: () => void;
}) {
  /* "mis" = solo lo asignado a mí; "todas" = todo (los filtros de persona/área
     son de escritorio y aquí no aplican). */
  const base =
    alcance === "mis" ? tareas.filter((t) => t.responsable_id === currentUserId) : tareas;

  const vencidas = base.filter((t) => esVencida(t.fecha_limite, t.estado)).length;
  const filtradas = soloVencidas
    ? base.filter((t) => esVencida(t.fecha_limite, t.estado))
    : base;

  /* Agrupado por área, en el orden del catálogo, omitiendo áreas sin tareas. */
  const grupos = AREAS.map((area) => ({
    area,
    tasks: filtradas.filter((t) => t.area === area.id),
  })).filter((g) => g.tasks.length > 0);

  /* Los temas (áreas) arrancan COLAPSADOS: guardamos las que están abiertas. */
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  function alternar(areaId: string) {
    setAbiertas((prev) => {
      const next = new Set(prev);
      next.has(areaId) ? next.delete(areaId) : next.add(areaId);
      return next;
    });
  }

  const rolInfo = ROLES.find((r) => r.id === rol);

  return (
    <div className="pb-24">
      {/* Encabezado */}
      <h1 className="text-[21px] font-bold tracking-tight">Tareas del equipo</h1>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground">
        Quién hace qué y en qué va cada cosa.
      </p>

      {/* Chips de filtro (scroll horizontal) */}
      <div className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => setAlcance("todas")}
          aria-pressed={alcance === "todas"}
          className={cn(
            "shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
            alcance === "todas"
              ? "bg-foreground text-background"
              : "border bg-card text-foreground",
          )}
        >
          Todas · {tareas.length}
        </button>
        <button
          type="button"
          onClick={() => setAlcance("mis")}
          aria-pressed={alcance === "mis"}
          className={cn(
            "shrink-0 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
            alcance === "mis"
              ? "bg-foreground text-background"
              : "border bg-card text-foreground",
          )}
        >
          Mis tareas
        </button>
        {(vencidas > 0 || soloVencidas) && (
          <button
            type="button"
            onClick={() => setSoloVencidas((v) => !v)}
            aria-pressed={soloVencidas}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-[12.5px] font-semibold transition-colors",
              soloVencidas
                ? "bg-red-600 text-white"
                : "border border-[#F3C9DA] bg-[#FDEEF4] text-[#C11862]",
            )}
          >
            <AlertTriangle className="size-3" strokeWidth={2.2} aria-hidden="true" />
            {vencidas} {vencidas === 1 ? "vencida" : "vencidas"}
          </button>
        )}
      </div>

      {/* Nota de acceso */}
      <div className="mt-2 flex items-start gap-2.5 rounded-xl border bg-card px-3.5 py-3 text-[12px] text-muted-foreground">
        <Info className="mt-px size-[15px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
        <span className="leading-relaxed">
          Tu acceso: <b className="font-semibold text-foreground">{rolInfo?.nombre ?? "Miembro"}</b>{" "}
          — {rolInfo?.desc}
        </span>
      </div>

      {/* Grupos por área */}
      {grupos.length === 0 ? (
        <p className="mt-6 text-sm italic text-muted-foreground">
          {alcance === "mis"
            ? "No tienes tareas asignadas por ahora."
            : "No hay tareas para mostrar."}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-5">
          {grupos.map(({ area, tasks }) => {
            const abierta = abiertas.has(area.id);
            return (
            <div key={area.id}>
              <button
                type="button"
                onClick={() => alternar(area.id)}
                aria-expanded={abierta}
                className="mb-2.5 flex w-full items-center gap-2 px-0.5"
              >
                <span
                  className="size-2 rounded-[3px]"
                  style={{ backgroundColor: area.color }}
                  aria-hidden="true"
                />
                <span className="text-[13px] font-bold">{area.nombre}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                  {tasks.length}
                </span>
                <ChevronDown
                  className={cn(
                    "ml-auto size-4 text-muted-foreground transition-transform",
                    !abierta && "-rotate-90",
                  )}
                  strokeWidth={2}
                  aria-hidden="true"
                />
              </button>

              {/* Expandir/colapsar animado: grid-template-rows 0fr→1fr evita el
                  salto brusco del montaje/desmontaje directo. */}
              <div
                className={cn(
                  "grid transition-[grid-template-rows] duration-300 ease-out",
                  abierta ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                )}
              >
                <div className="overflow-hidden">
                <div
                  className={cn(
                    "flex flex-col gap-2 transition-opacity duration-300",
                    abierta ? "opacity-100" : "opacity-0",
                  )}
                >
                {tasks.map((t) => {
                  const estado = ESTILO_ESTADO[t.estado];
                  const prioridad = obtenerPrioridad(t.prioridad);
                  const vencida = esVencida(t.fecha_limite, t.estado);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onAbrir(t)}
                      className="rounded-2xl border bg-card p-3.5 text-left transition-colors hover:bg-accent/40"
                    >
                      <div className="text-[14.5px] font-semibold leading-snug text-foreground">
                        {t.titulo}
                      </div>

                      {/* Responsable */}
                      <div className="mt-2.5 flex items-center gap-2">
                        {t.responsable ? (
                          <>
                            <span
                              className="flex size-[22px] shrink-0 items-center justify-center rounded-full text-[9.5px] font-semibold text-white"
                              style={{ backgroundColor: t.responsable.color }}
                              aria-hidden="true"
                            >
                              {iniciales(t.responsable.nombre)}
                            </span>
                            <span className="truncate text-[12.5px] text-muted-foreground">
                              {t.responsable.nombre}
                            </span>
                          </>
                        ) : (
                          <span className="text-[12.5px] italic text-muted-foreground">
                            Sin asignar
                          </span>
                        )}
                      </div>

                      {/* Estado + prioridad + fecha */}
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11.5px] font-semibold"
                          style={{ backgroundColor: estado.bg, color: estado.color }}
                        >
                          <span
                            className="size-[5px] rounded-full"
                            style={{ backgroundColor: estado.dot }}
                          />
                          {estado.nombre}
                        </span>
                        {prioridad && (
                          <span className="inline-flex items-center gap-1.5 text-[11.5px] text-foreground/80">
                            <span
                              className="size-1.5 rounded-full"
                              style={{ backgroundColor: prioridad.color }}
                            />
                            {prioridad.nombre}
                          </span>
                        )}
                        {t.fecha_limite && (
                          <span
                            className={cn(
                              "ml-auto text-[11.5px] font-semibold",
                              vencida ? "text-red-600" : "text-muted-foreground",
                            )}
                          >
                            {formatearFecha(t.fecha_limite)}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}
                </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* FAB — Nueva tarea (solo gestores) */}
      {gestor && (
        <button
          type="button"
          onClick={onNueva}
          aria-label="Nueva tarea"
          className="fixed bottom-5 right-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[0_10px_22px_-8px_rgba(232,67,147,0.65)]"
        >
          <Plus className="size-6" strokeWidth={2.3} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
