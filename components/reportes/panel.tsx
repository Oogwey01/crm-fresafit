"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, ExternalLink, FileText, Plus } from "lucide-react";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { Pastilla } from "@/components/compartido/pastilla";
import { StatCard } from "@/components/compartido/stat-card";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { Button } from "@/components/ui/button";
import { ReporteDialog } from "@/components/reportes/reporte-dialog";
import { nombrePeriodo } from "@/lib/agencia";
import { formatearFecha } from "@/lib/fecha";
import type { AgenciaEmpresa, AgenciaReporteConEmpresa } from "@/lib/types";

const COLS = "grid-cols-[minmax(200px,1fr)_140px_170px_150px_60px]";

type Filtro = "pendientes" | "entregados" | "todos";

const FILTROS: readonly (readonly [Filtro, string])[] = [
  ["pendientes", "Por entregar"],
  ["entregados", "Entregados"],
  ["todos", "Todos"],
] as const;

export function PanelReportes({
  reportes,
  empresas,
}: {
  reportes: AgenciaReporteConEmpresa[];
  empresas: AgenciaEmpresa[];
}) {
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [dialogo, setDialogo] = useState<AgenciaReporteConEmpresa | "nuevo" | null>(null);

  const visibles = useMemo(
    () =>
      filtro === "todos"
        ? reportes
        : reportes.filter((r) => (filtro === "entregados" ? r.entregado_at : !r.entregado_at)),
    [reportes, filtro],
  );

  const pendientes = reportes.filter((r) => !r.entregado_at).length;
  const entregados = reportes.length - pendientes;

  const columnas: Columna<AgenciaReporteConEmpresa>[] = [
    {
      clave: "titulo",
      label: "Reporte",
      esTitulo: true,
      celda: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium" title={r.titulo}>
            {r.titulo}
          </div>
          {r.resumen && (
            <div className="truncate text-[11.5px] text-muted-foreground" title={r.resumen}>
              {r.resumen}
            </div>
          )}
        </div>
      ),
    },
    {
      clave: "empresa",
      label: "Empresa",
      celda: (r) =>
        r.empresa ? (
          <Pastilla nombre={r.empresa.nombre} color={r.empresa.color} />
        ) : (
          <span className="text-muted-foreground/60">—</span>
        ),
    },
    {
      clave: "periodo",
      label: "Periodo",
      celda: (r) => (
        <span className="text-[13px] text-muted-foreground">
          {r.periodo_desde && r.periodo_hasta
            ? nombrePeriodo(r.periodo_desde, r.periodo_hasta)
            : "—"}
        </span>
      ),
    },
    {
      clave: "estado",
      label: "Entrega",
      celda: (r) =>
        r.entregado_at ? (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-green-600">
            <CheckCircle2 className="size-3.5" strokeWidth={2} />
            {formatearFecha(r.entregado_at.slice(0, 10))}
          </span>
        ) : (
          <Pastilla nombre="Por entregar" color="#fdcb6e" />
        ),
    },
    {
      clave: "url",
      label: "",
      cardValorClassName: "flex justify-end",
      celda: (r) =>
        r.url ? (
          <a
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            title="Abrir el reporte"
            className="ml-auto rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground md:ml-0"
          >
            <ExternalLink className="size-4" />
          </a>
        ) : null,
    },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Reportes</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Qué se le entregó a cada cliente y cuándo. Los del propio Fresafit los calcula el
            CRM en su pantalla de Reportes.
          </p>
        </div>
        <Button onClick={() => setDialogo("nuevo")} className="w-full md:w-auto">
          <Plus className="size-4" strokeWidth={2.2} />
          Nuevo reporte
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          etiqueta="Por entregar"
          valor={String(pendientes)}
          icono={FileText}
          valorClassName={pendientes > 0 ? "text-amber-600" : undefined}
        />
        <StatCard etiqueta="Entregados" valor={String(entregados)} icono={CheckCircle2} />
      </div>

      <div className="mb-4">
        <ControlSegmentado opciones={FILTROS} valor={filtro} onCambio={setFiltro} />
      </div>

      <TablaSimple
        cols={COLS}
        columnas={columnas}
        datos={visibles}
        filaKey={(r) => r.id}
        minW="min-w-[820px]"
        onRowClick={(r) => setDialogo(r)}
        vacio={
          filtro === "pendientes"
            ? "No hay reportes pendientes de entregar. 🎉"
            : "Todavía no hay reportes."
        }
      />

      {dialogo && (
        <ReporteDialog
          reporte={dialogo === "nuevo" ? null : dialogo}
          empresas={empresas}
          onClose={() => setDialogo(null)}
        />
      )}
    </div>
  );
}
