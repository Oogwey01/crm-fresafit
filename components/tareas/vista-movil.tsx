"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, Info, Plus } from "lucide-react";
import { AREAS, ESTADOS, ROLES, obtenerPrioridad } from "@/lib/catalogos";
import { esVencida, formatearFecha } from "@/lib/fecha";
import { type EstadoId, type RolId, type TaskConResponsable } from "@/lib/types";
import { trabajaLaTarea } from "@/lib/tareas/reglas";
import { cn } from "@/lib/utils";
import { AvataresEquipo } from "@/components/tareas/avatares-equipo";
import { FiltroEtiquetas, ChipsEtiquetas } from "@/components/tareas/filtro-etiquetas";

/* Vista móvil del módulo Tareas (portada del diseño de Claude Design).
   Lista agrupada por ÁREA con tarjetas compactas — en vez de las vistas
   tabla/tablero/calendario que manda en escritorio. Comparte el estado global
   (alcance / solo vencidas) y los modales con el <Board>. */

type Alcance = "mis" | "delegadas" | "todas";

/* Chips de la barra de filtros: reparten el ancho a partes iguales (flex-1) y
   recortan antes de empujar a los de al lado (min-w-0 + truncate). */
const CHIP =
  "min-w-0 flex-1 truncate rounded-full px-2 py-2 text-center text-[12px] font-semibold transition-colors";
const CHIP_ACTIVO = "bg-foreground text-background";
const CHIP_INACTIVO = "border bg-card text-foreground";

/* Pastilla de estado. Solo los tintes suaves (fondo y texto) son del diseño
   móvil; el nombre y el punto de color salen de ESTADOS (lib/catalogos.ts)
   para que esta vista no se desvíe de la tabla y el calendario — el verde de
   «hecho» ya se había desviado una vez. */
const TINTE_ESTADO: Record<EstadoId, { bg: string; color: string }> = {
  por_hacer: { bg: "#F1F3F6", color: "#5A6474" },
  en_proceso: { bg: "#FEF3E2", color: "#B45309" },
  atorado: { bg: "#FEE9DC", color: "#C2410C" },
  en_revision: { bg: "#F1ECFE", color: "#6D28D9" },
  hecho: { bg: "#E9F8F1", color: "#0E8A5F" },
  cancelada: { bg: "#EEF1F5", color: "#475569" },
};

const ESTILO_ESTADO = Object.fromEntries(
  ESTADOS.map((e) => [e.id, { nombre: e.nombre, dot: e.color, ...TINTE_ESTADO[e.id] }]),
) as Record<EstadoId, { nombre: string; bg: string; color: string; dot: string }>;

export function VistaMovil({
  tareas,
  currentUserId,
  puedeCrear,
  rol,
  alcance,
  setAlcance,
  soloVencidas,
  setSoloVencidas,
  filtroEtiquetas,
  setFiltroEtiquetas,
  onAbrir,
  onNueva,
  checklistPorTarea,
  titulo,
  empresas,
}: {
  tareas: TaskConResponsable[];
  currentUserId: string;
  /* Todo el equipo de casa puede abrir tareas y delegarlas; `externo` no. */
  puedeCrear: boolean;
  rol: RolId;
  alcance: Alcance;
  setAlcance: (a: Alcance) => void;
  soloVencidas: boolean;
  setSoloVencidas: (fn: (v: boolean) => boolean) => void;
  /* Etiquetas marcadas. El estado vive en el <Board> y se comparte con las
     vistas de escritorio, igual que el alcance. */
  filtroEtiquetas: string[];
  setFiltroEtiquetas: (ids: string[]) => void;
  onAbrir: (t: TaskConResponsable) => void;
  onNueva: () => void;
  checklistPorTarea?: Record<string, { total: number; hechos: number }>;
  /* Encabezado alterno (el tablero de la Agencia no dice "del equipo"). */
  titulo?: string;
  /* Con clientes, la lista se agrupa por cliente en vez de por área: en la
     agencia el área es siempre la misma (contenido, diseño) y agrupar por ella
     dejaba una sola pila con todo adentro. */
  empresas?: { id: string; nombre: string; color: string }[];
}) {
  const porCliente = !!empresas;
  /* "mis" = lo asignado a mí; "delegadas" = lo que yo delegué; "todas" = todo
     (los filtros de persona/área son de escritorio y aquí no aplican). */
  const porAlcance =
    alcance === "mis"
      ? tareas.filter((t) => trabajaLaTarea(t, currentUserId))
      : alcance === "delegadas"
        ? tareas.filter((t) => t.created_by === currentUserId)
        : tareas;

  /* Etiquetas: la tarea entra si tiene ALGUNA de las marcadas. Va antes de
     contar vencidas para que el chip rojo hable de lo que se está viendo. */
  const base =
    filtroEtiquetas.length === 0
      ? porAlcance
      : porAlcance.filter((t) => (t.etiquetas ?? []).some((e) => filtroEtiquetas.includes(e)));

  const vencidas = base.filter((t) => esVencida(t.fecha_limite, t.estado)).length;
  const filtradas = soloVencidas
    ? base.filter((t) => esVencida(t.fecha_limite, t.estado))
    : base;

  /* Agrupado por cliente (agencia) o por área (Fresafit), omitiendo los grupos
     vacíos. `area` conserva el nombre porque es lo que pinta el encabezado:
     lleva id, nombre y color, que es todo lo que necesita el carril. */
  const grupos = (
    porCliente
      ? [
          ...empresas!.map((e) => ({ area: e, tasks: filtradas.filter((t) => t.empresa_id === e.id) })),
          {
            area: { id: "sin-empresa", nombre: "De la agencia", color: "#94a3b8" },
            tasks: filtradas.filter((t) => !t.empresa_id),
          },
        ]
      : AREAS.map((area) => ({ area, tasks: filtradas.filter((t) => t.area === area.id) }))
  ).filter((g) => g.tasks.length > 0);

  /* Los temas (áreas) arrancan COLAPSADOS: guardamos las que están abiertas. */
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  function alternar(areaId: string) {
    setAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(areaId)) next.delete(areaId);
      else next.add(areaId);
      return next;
    });
  }

  const rolInfo = ROLES.find((r) => r.id === rol);

  return (
    <div className="pb-24">
      {/* Encabezado */}
      <h1 className="text-[21px] font-bold tracking-tight">{titulo ?? "Tareas del equipo"}</h1>
      <p className="mt-1.5 text-[13.5px] text-muted-foreground">
        {porCliente
          ? "Lo que traemos de cada cliente."
          : "Quién hace qué y en qué va cada cosa."}
      </p>

      {/* Chips de filtro: todos a la vista en una sola fila. Antes iban en un
          carril con scroll lateral, y el filtro de la derecha —justo el de las
          vencidas— quedaba fuera de la pantalla y no se sabía que existía.
          Se reparten el ancho a partes iguales y los rótulos se acortan («Mías»,
          «Delegadas») para que quepan sin recortarse. */}
      <div className="mt-4 flex gap-1.5">
        <button
          type="button"
          onClick={() => setAlcance("todas")}
          aria-pressed={alcance === "todas"}
          className={cn(CHIP, alcance === "todas" ? CHIP_ACTIVO : CHIP_INACTIVO)}
        >
          Todas · {tareas.length}
        </button>
        <button
          type="button"
          onClick={() => setAlcance("mis")}
          aria-pressed={alcance === "mis"}
          className={cn(CHIP, alcance === "mis" ? CHIP_ACTIVO : CHIP_INACTIVO)}
        >
          Mías
        </button>
        {puedeCrear && (
          <button
            type="button"
            onClick={() => setAlcance("delegadas")}
            aria-pressed={alcance === "delegadas"}
            title="Delegadas por mí"
            className={cn(CHIP, alcance === "delegadas" ? CHIP_ACTIVO : CHIP_INACTIVO)}
          >
            Delegadas
          </button>
        )}
        {(vencidas > 0 || soloVencidas) && (
          <button
            type="button"
            onClick={() => setSoloVencidas((v) => !v)}
            aria-pressed={soloVencidas}
            title="Ver solo las tareas vencidas"
            className={cn(
              CHIP,
              soloVencidas
                ? "bg-red-600 text-white"
                : "border border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
            )}
          >
            <AlertTriangle
              className="mr-1 inline-block size-3 align-[-1px]"
              strokeWidth={2.2}
              aria-hidden="true"
            />
            {vencidas}
          </button>
        )}
      </div>

      {/* Filtro por etiqueta. En renglón aparte: la fila de arriba ya reparte su
          ancho entre tres o cuatro chips y uno más los dejaría ilegibles. Solo
          aparece si hay etiquetas puestas en lo que se está mirando. */}
      <div className="mt-1.5 flex">
        <FiltroEtiquetas
          tareas={porAlcance}
          seleccionadas={filtroEtiquetas}
          onCambiar={setFiltroEtiquetas}
          className="h-auto rounded-full px-3 py-2 text-[12px]"
        />
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
          {filtroEtiquetas.length > 0
            ? "Nada con esas etiquetas."
            : alcance === "mis"
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

                      {/* Equipo */}
                      <div className="mt-2.5 flex items-center gap-2">
                        <AvataresEquipo
                          tarea={t}
                          tamano="md"
                          maximo={2}
                          className="text-[12.5px] font-normal text-muted-foreground"
                        />
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
                        {(() => {
                          const chk = checklistPorTarea?.[t.id];
                          return chk && chk.total > 0 ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
                              ☑ {chk.hechos}/{chk.total}
                            </span>
                          ) : null;
                        })()}
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

                      {/* Etiquetas — renglón propio y solo si las trae, como en
                          las tarjetas del tablero. */}
                      {(t.etiquetas ?? []).length > 0 && (
                        <div className="mt-2">
                          <ChipsEtiquetas ids={t.etiquetas} maximo={3} />
                        </div>
                      )}
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

      {/* FAB — Nueva tarea (todo el equipo de casa) */}
      {puedeCrear && (
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
