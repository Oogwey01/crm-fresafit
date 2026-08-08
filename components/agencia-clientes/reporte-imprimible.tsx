"use client";

import { useEffect } from "react";
import { LogoFresafit } from "@/components/layout/logo-fresafit";
import {
  obtenerEstadoIncidencia,
  obtenerLadoIncidencia,
} from "@/lib/catalogos";
import { formatearFechaHora, formatearFechaLarga } from "@/lib/fecha";
import type { AvanceCompleto } from "@/lib/avance/consulta";
import type { AgenciaEmpresa, TaskConResponsable } from "@/lib/types";

/* ============================================================================
   El reporte de periodo, en papel
   ----------------------------------------------------------------------------
   Es el documento que se lleva a la junta con el cliente y el respaldo de lo
   que se hizo. Mismo oficio que components/reportes/imprimible.tsx: A4,
   `print-color-adjust: exact`, `break-inside: avoid` y el PDF lo genera el
   navegador («Guardar como PDF») — texto seleccionable, kilobytes.

   Este componente NO decide qué se enseña: pinta lo que le llegó, y lo que le
   llegó ya pasó por la RLS de quien está mirando. El mismo reporte abierto por
   el cliente sale sin lo interno porque lo interno nunca viajó.
   ============================================================================ */

export function ReportePeriodoImprimible({
  empresa,
  rango,
  datos,
  cerradas,
  pendientes,
  generadoPor,
}: {
  empresa: Pick<AgenciaEmpresa, "id" | "nombre" | "slug" | "color" | "giro">;
  rango: { desde: string; hasta: string };
  datos: AvanceCompleto;
  cerradas: TaskConResponsable[];
  pendientes: { deFresafit: TaskConResponsable[]; delCliente: TaskConResponsable[] };
  generadoPor: string;
}) {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 700);
    return () => clearTimeout(t);
  }, []);

  const abiertas = datos.incidencias.filter((i) => i.estado !== "resuelta");
  const resueltasEnPeriodo = datos.incidencias.filter(
    (i) => i.resuelta_en && i.resuelta_en >= rango.desde && i.resuelta_en <= rango.hasta,
  );

  return (
    <>
      <style>{`
        @page { size: A4; margin: 14mm 12mm; }
        @media print {
          .no-imprimir { display: none !important; }
          body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
        .bloque { break-inside: avoid; }
      `}</style>

      <div className="mx-auto max-w-[720px] px-6 py-8 text-[13px] leading-relaxed text-neutral-900 print:px-0 print:py-0">
        {/* Encabezado */}
        <header className="bloque mb-6 flex items-start justify-between border-b-2 pb-4" style={{ borderColor: empresa.color }}>
          <div>
            <LogoFresafit className="h-6 w-auto" />
            <h1 className="mt-2 text-[19px] font-bold">
              Reporte del proyecto · {empresa.nombre}
            </h1>
            <p className="text-neutral-500">
              Del {formatearFechaLarga(rango.desde)} al {formatearFechaLarga(rango.hasta)}
            </p>
          </div>
          <span
            className="mt-1 size-10 rounded-xl"
            style={{ backgroundColor: empresa.color }}
            aria-hidden="true"
          />
        </header>

        {/* Estado actual */}
        <section className="bloque mb-6">
          <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            En qué vamos
          </h2>
          <p className="whitespace-pre-wrap text-[14px]">
            {datos.avance?.estado_actual ?? "—"}
          </p>
        </section>

        {/* Lo hecho en el periodo */}
        <section className="bloque mb-6">
          <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Avance del periodo ({datos.bitacora.length} entradas)
          </h2>
          {datos.bitacora.length === 0 ? (
            <p className="text-neutral-500">Sin entradas de bitácora en este periodo.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {[...datos.bitacora].reverse().map((b) => (
                <li key={b.id} className="bloque">
                  <span className="font-semibold">{formatearFechaLarga(b.fecha)}</span> — {b.titulo}
                  {b.descripcion && (
                    <p className="whitespace-pre-wrap text-neutral-600">{b.descripcion}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Tareas cerradas */}
        <section className="bloque mb-6">
          <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Tareas cerradas en el periodo ({cerradas.length})
          </h2>
          {cerradas.length === 0 ? (
            <p className="text-neutral-500">Ninguna.</p>
          ) : (
            <ul className="list-disc pl-5">
              {cerradas.map((t) => (
                <li key={t.id}>
                  {t.titulo}
                  {t.estado === "cancelada" && (
                    <span className="text-neutral-500"> (cancelada)</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Incidencias */}
        <section className="bloque mb-6">
          <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
            Bloqueos abiertos ({abiertas.length})
          </h2>
          {abiertas.length === 0 ? (
            <p className="text-neutral-500">Nada frenando el proyecto.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {abiertas.map((i) => (
                <li key={i.id} className="bloque">
                  <span className="font-semibold">{i.titulo}</span>{" "}
                  <span className="text-neutral-500">
                    — {obtenerEstadoIncidencia(i.estado)?.nombre.toLowerCase()}, en cancha de{" "}
                    {obtenerLadoIncidencia(i.desbloquea)?.nombre}
                  </span>
                  {i.impacto && <p className="text-neutral-600">Detiene: {i.impacto}</p>}
                </li>
              ))}
            </ul>
          )}
          {resueltasEnPeriodo.length > 0 && (
            <p className="mt-2 text-neutral-600">
              Resueltos en el periodo: {resueltasEnPeriodo.map((i) => i.titulo).join("; ")}.
            </p>
          )}
        </section>

        {/* Pendientes de cada lado */}
        <section className="bloque mb-6 grid grid-cols-2 gap-4">
          <div>
            <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              Pendiente de Fresafit ({pendientes.deFresafit.length})
            </h2>
            <ul className="list-disc pl-5">
              {pendientes.deFresafit.map((t) => (
                <li key={t.id}>{t.titulo}</li>
              ))}
              {pendientes.deFresafit.length === 0 && <li className="list-none text-neutral-500">Nada.</li>}
            </ul>
          </div>
          <div>
            <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              Pendiente de {empresa.nombre} ({pendientes.delCliente.length})
            </h2>
            <ul className="list-disc pl-5">
              {pendientes.delCliente.map((t) => (
                <li key={t.id}>{t.titulo}</li>
              ))}
              {pendientes.delCliente.length === 0 && <li className="list-none text-neutral-500">Nada.</li>}
            </ul>
          </div>
        </section>

        {/* Próximos eventos */}
        {datos.eventos.length > 0 && (
          <section className="bloque mb-6">
            <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-neutral-500">
              Lo que viene
            </h2>
            <ul className="list-disc pl-5">
              {datos.eventos
                .filter((e) => e.inicia_en >= new Date().toISOString())
                .map((e) => (
                  <li key={e.id}>
                    {e.titulo} — {formatearFechaHora(e.inicia_en)}
                  </li>
                ))}
            </ul>
          </section>
        )}

        <footer className="mt-8 border-t pt-3 text-[11px] text-neutral-500">
          Generado desde el CRM de Fresafit por {generadoPor}. Este reporte refleja el registro del
          sistema al momento de generarse.
        </footer>
      </div>
    </>
  );
}
