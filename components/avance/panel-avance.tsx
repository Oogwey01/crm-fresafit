"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AlertTriangle, CalendarDays, Check, FileDown, Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pastilla } from "@/components/compartido/pastilla";
import { Seccion } from "@/components/compartido/seccion";
import { RangoFechas } from "@/components/compartido/rango-fechas";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { DialogoBitacora } from "@/components/avance/dialogo-bitacora";
import { DialogoEvento } from "@/components/avance/dialogo-evento";
import { DialogoIncidencia } from "@/components/avance/dialogo-incidencia";
import {
  guardarEstadoActual,
  moverIncidenciaCliente,
} from "@/app/(app)/agencia/clientes/acciones/avance";
import {
  obtenerEstadoIncidencia,
  obtenerLadoIncidencia,
  obtenerVisibilidad,
} from "@/lib/catalogos";
import { formatearFechaHora, formatearFechaLarga } from "@/lib/fecha";
import { cn } from "@/lib/utils";
import type { AvanceCompleto } from "@/lib/avance/consulta";
import type { EmpresaIncidencia, TaskConResponsable } from "@/lib/types";

/* ============================================================================
   El avance del proyecto — la misma pantalla para los dos lados
   ----------------------------------------------------------------------------
   El cliente entra aquí a saber en qué vamos sin preguntar; el equipo, a
   contarlo. Por eso es un solo componente con un interruptor (`puedeEditar`):
   si fueran dos, lo que se escribe y lo que se lee acabarían enseñando cosas
   distintas, que es justo el problema que el módulo viene a resolver.
   ============================================================================ */

export function PanelAvance({
  empresaId,
  empresaNombre,
  empresaSlug,
  datos,
  pendientes,
  puedeEditar,
  rango,
}: {
  /* Para armar la ruta de impresión del lado del equipo. El portal no lo
     necesita: su ruta imprime siempre la propia empresa. */
  empresaSlug?: string;
  empresaId: string;
  empresaNombre: string;
  datos: AvanceCompleto;
  /* Lo que falta de cada lado. Salen de las tareas compartidas abiertas, no de
     una tabla propia: ver pendientesPorLado() en lib/avance/consulta.ts. */
  pendientes: { deFresafit: TaskConResponsable[]; delCliente: TaskConResponsable[] };
  puedeEditar: boolean;
  /* El filtro de fechas de la bitácora, ya aplicado en el servidor. */
  rango: { desde: string; hasta: string };
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [editandoEstado, setEditandoEstado] = useState(false);
  const [estado, setEstado] = useState(datos.avance?.estado_actual ?? "");
  const [nuevaEntrada, setNuevaEntrada] = useState(false);
  const [nuevoEvento, setNuevoEvento] = useState(false);
  const [nuevaIncidencia, setNuevaIncidencia] = useState(false);
  const [editandoIncidencia, setEditandoIncidencia] = useState<EmpresaIncidencia | null>(null);

  const abiertas = datos.incidencias.filter((i) => i.estado !== "resuelta");
  const ahora = new Date().toISOString();
  const proximos = datos.eventos.filter((e) => e.inicia_en >= ahora);

  /* Cada lado imprime desde su espacio: el layout de /agencia expulsa a los
     externos, así que el portal tiene su propia ruta con el mismo reporte. */
  const rutaImprimir = puedeEditar
    ? `/agencia/clientes/${empresaSlug}/imprimir`
    : "/portal/avance/imprimir";
  const urlImprimir = `${rutaImprimir}?desde=${rango.desde}&hasta=${rango.hasta}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          render={<a href={urlImprimir} target="_blank" rel="noopener" />}
        >
          <FileDown className="size-4" strokeWidth={1.9} />
          Exportar PDF del periodo
        </Button>
      </div>

      {/* ---- Estado actual: lo primero que se lee ------------------------- */}
      <section className="rounded-xl border bg-card p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted-foreground">
            En qué vamos
          </h2>
          {puedeEditar && !editandoEstado && (
            <Button variant="ghost" size="sm" onClick={() => setEditandoEstado(true)}>
              <Pencil className="size-3.5" strokeWidth={1.9} />
            </Button>
          )}
        </div>

        {editandoEstado ? (
          <div className="mt-2 flex flex-col gap-2">
            <Textarea
              value={estado}
              onChange={(e) => setEstado(e.target.value)}
              rows={3}
              placeholder="Onboarding — reclutamiento de equipo completado, pendiente verificación de categoría en TikTok."
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setEstado(datos.avance?.estado_actual ?? "");
                  setEditandoEstado(false);
                }}
              >
                Cancelar
              </Button>
              <Button
                size="sm"
                disabled={pending}
                onClick={() =>
                  ejecutar(() => guardarEstadoActual(empresaId, estado), {
                    ok: "Estado actualizado.",
                    error: "No se pudo guardar el estado.",
                    alExito: () => setEditandoEstado(false),
                  })
                }
              >
                Guardar
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-1.5 whitespace-pre-wrap text-[15px] leading-relaxed">
            {datos.avance?.estado_actual || (
              <span className="text-muted-foreground">
                Todavía no se ha escrito en qué va el proyecto.
              </span>
            )}
          </p>
        )}

        {datos.avance?.updated_at && datos.avance.estado_actual && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            Actualizado el {formatearFechaHora(datos.avance.updated_at)}
          </p>
        )}
      </section>

      {/* ---- Incidencias: lo que está frenando --------------------------- */}
      <Seccion titulo={`Incidencias y bloqueos (${abiertas.length})`}>
        {puedeEditar && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setNuevaIncidencia(true)}>
              <Plus className="size-3.5" strokeWidth={2.2} />
              Registrar bloqueo
            </Button>
          </div>
        )}

        {datos.incidencias.length === 0 ? (
          <p className="text-[13.5px] text-muted-foreground">Nada frenando el proyecto ahora mismo.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {datos.incidencias.map((i) => {
              const est = obtenerEstadoIncidencia(i.estado);
              const lado = obtenerLadoIncidencia(i.desbloquea);
              const resuelta = i.estado === "resuelta";
              /* Del lado del cliente: puede decir «ya lo estoy viendo» en lo que
                 está en su cancha. Cerrarlo es de quien comprueba que se
                 desbloqueó (lo impone el trigger de la BD). */
              const puedeMover = !puedeEditar && i.desbloquea === "cliente" && !resuelta;

              return (
                <li
                  key={i.id}
                  className={cn(
                    "rounded-xl border bg-card p-3.5",
                    !resuelta && i.desbloquea === "cliente" && "border-amber-500/45",
                    !resuelta && i.desbloquea === "fresafit" && "border-destructive/35",
                    resuelta && "opacity-60",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    {!resuelta && (
                      <AlertTriangle
                        className="size-4 shrink-0 text-amber-600"
                        strokeWidth={2}
                        aria-hidden="true"
                      />
                    )}
                    <span className="text-[14.5px] font-semibold">{i.titulo}</span>
                    {est && <Pastilla nombre={est.nombre} color={est.color} className="text-[11px]" />}
                    <span className="text-[12.5px] text-muted-foreground">
                      En cancha de {lado?.nombre}
                    </span>
                  </div>

                  {i.descripcion && (
                    <p className="mt-1.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted-foreground">
                      {i.descripcion}
                    </p>
                  )}
                  {i.impacto && (
                    <p className="mt-1.5 text-[13px]">
                      <span className="font-semibold">Está deteniendo:</span> {i.impacto}
                    </p>
                  )}

                  <div className="mt-2 flex flex-wrap items-center gap-3 text-[12px] text-muted-foreground">
                    <span>Detectada el {formatearFechaLarga(i.detectada_en)}</span>
                    {i.resuelta_en && <span>Resuelta el {formatearFechaLarga(i.resuelta_en)}</span>}

                    {puedeEditar && (
                      <button
                        type="button"
                        onClick={() => setEditandoIncidencia(i)}
                        className="font-medium text-foreground hover:underline"
                      >
                        Editar
                      </button>
                    )}

                    {puedeMover && i.estado === "abierta" && (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() =>
                          ejecutar(() => moverIncidenciaCliente(i.id, "en_resolucion"), {
                            ok: "Marcado como «lo estamos viendo».",
                            error: "No se pudo actualizar.",
                          })
                        }
                        className="inline-flex items-center gap-1 font-semibold text-foreground hover:underline"
                      >
                        <Check className="size-3.5" strokeWidth={2.2} />
                        Ya lo estamos viendo
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>

      {/* ---- Pendientes de cada lado ------------------------------------- */}
      <Seccion titulo="Qué falta de cada lado">
        <div className="grid gap-3 sm:grid-cols-2">
          <ListaPendientes
            titulo={`De Fresafit (${pendientes.deFresafit.length})`}
            tareas={pendientes.deFresafit}
          />
          <ListaPendientes
            titulo={`De ${empresaNombre} (${pendientes.delCliente.length})`}
            tareas={pendientes.delCliente}
          />
        </div>
        <p className="text-[12px] text-muted-foreground">
          Salen de las tareas compartidas que siguen abiertas: se actualizan solas al moverlas.
        </p>
      </Seccion>

      {/* ---- Próximos eventos -------------------------------------------- */}
      <Seccion titulo={`Próximos eventos (${proximos.length})`}>
        {puedeEditar && (
          <div className="flex justify-end">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setNuevoEvento(true)}>
              <Plus className="size-3.5" strokeWidth={2.2} />
              Agendar
            </Button>
          </div>
        )}
        {proximos.length === 0 ? (
          <p className="text-[13.5px] text-muted-foreground">No hay nada agendado.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {proximos.map((e) => {
              const vis = obtenerVisibilidad(e.visibilidad);
              return (
                <li key={e.id} className="flex items-start gap-3 rounded-xl border bg-card p-3">
                  <CalendarDays
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    strokeWidth={1.9}
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold">{e.titulo}</span>
                      {puedeEditar && vis && e.visibilidad !== "compartido" && (
                        <span className="text-[11.5px] text-muted-foreground">{vis.nombre}</span>
                      )}
                    </div>
                    <span className="text-[12.5px] text-muted-foreground">
                      {formatearFechaHora(e.inicia_en)}
                    </span>
                    {e.descripcion && (
                      <p className="mt-1 text-[13px] text-muted-foreground">{e.descripcion}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Seccion>

      {/* ---- Bitácora ---------------------------------------------------- */}
      <Seccion titulo="Bitácora">
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* El rango viaja por la URL: así el filtro sobrevive a un refresco y
              se puede mandar el enlace de un periodo concreto. */}
          <RangoBitacora rango={rango} />
          {puedeEditar && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setNuevaEntrada(true)}>
              <Plus className="size-3.5" strokeWidth={2.2} />
              Nueva entrada
            </Button>
          )}
        </div>

        {datos.bitacora.length === 0 ? (
          <p className="text-[13.5px] text-muted-foreground">
            No hay entradas en este periodo.
          </p>
        ) : (
          <ol className="flex flex-col gap-3 border-l pl-4">
            {datos.bitacora.map((b) => {
              const vis = obtenerVisibilidad(b.visibilidad);
              return (
                <li key={b.id} className="relative">
                  <span
                    className="absolute -left-[21px] top-1.5 size-2.5 rounded-full bg-primary"
                    aria-hidden="true"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {formatearFechaLarga(b.fecha)}
                    </span>
                    {puedeEditar && vis && b.visibilidad !== "compartido" && (
                      <span className="text-[11.5px] text-muted-foreground">{vis.nombre}</span>
                    )}
                  </div>
                  <p className="text-[14.5px] font-semibold">{b.titulo}</p>
                  {b.descripcion && (
                    <p className="mt-0.5 whitespace-pre-wrap text-[13.5px] leading-relaxed text-muted-foreground">
                      {b.descripcion}
                    </p>
                  )}
                  {b.autor && (
                    <p className="mt-0.5 text-[12px] text-muted-foreground">{b.autor.nombre}</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </Seccion>

      {nuevaEntrada && (
        <DialogoBitacora empresaId={empresaId} onCerrar={() => setNuevaEntrada(false)} />
      )}
      {nuevoEvento && <DialogoEvento empresaId={empresaId} onCerrar={() => setNuevoEvento(false)} />}
      {(nuevaIncidencia || editandoIncidencia) && (
        <DialogoIncidencia
          empresaId={empresaId}
          empresaNombre={empresaNombre}
          incidencia={editandoIncidencia ?? undefined}
          onCerrar={() => {
            setNuevaIncidencia(false);
            setEditandoIncidencia(null);
          }}
        />
      )}
    </div>
  );
}

/* Empuja el rango elegido a la URL; el servidor lo lee de searchParams y
   recorta la bitácora. RangoFechas es controlado (pide onChange), así que este
   envoltorio es quien decide que «cambiar el rango» = navegar. */
function RangoBitacora({ rango }: { rango: { desde: string; hasta: string } }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <RangoFechas
      desde={rango.desde}
      hasta={rango.hasta}
      onChange={(desde, hasta) => {
        const params = new URLSearchParams({ desde, hasta });
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      }}
    />
  );
}

function ListaPendientes({ titulo, tareas }: { titulo: string; tareas: TaskConResponsable[] }) {
  return (
    <div className="rounded-xl border bg-card p-3.5">
      <h3 className="text-[13px] font-semibold">{titulo}</h3>
      {tareas.length === 0 ? (
        <p className="mt-1.5 text-[13px] text-muted-foreground">Nada pendiente.</p>
      ) : (
        <ul className="mt-1.5 flex flex-col gap-1.5">
          {tareas.slice(0, 8).map((t) => (
            <li key={t.id} className="text-[13.5px]">
              · {t.titulo}
              {t.fecha_limite && (
                <span className="text-muted-foreground">
                  {" "}
                  — {formatearFechaLarga(t.fecha_limite)}
                </span>
              )}
            </li>
          ))}
          {tareas.length > 8 && (
            <li className="text-[12.5px] text-muted-foreground">
              y {tareas.length - 8} más en la pestaña de tareas
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
