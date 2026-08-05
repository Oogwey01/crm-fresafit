"use client";

import { useMemo, useState } from "react";
import { Calculator, CircleDollarSign, Clock, Plus, Wallet } from "lucide-react";
import { toast } from "sonner";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { Pastilla } from "@/components/compartido/pastilla";
import { StatCard } from "@/components/compartido/stat-card";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CorteDialog } from "@/components/agencia/corte-dialog";
import { IngresoDialog } from "@/components/agencia/ingreso-dialog";
import { cambiarEstadoIngreso } from "@/app/(app)/agencia/actions";
import {
  ESTADOS_INGRESO,
  nombrePeriodo,
  obtenerEstadoIngreso,
  obtenerTipoIngreso,
  type EstadoIngresoId,
} from "@/lib/agencia";
import { formatearMXN } from "@/lib/moneda";
import type { AgenciaContrato, AgenciaEmpresa, AgenciaIngresoConEmpresa } from "@/lib/types";

const COLS = "grid-cols-[minmax(190px,1fr)_130px_150px_120px_130px_120px]";

type Filtro = "pendientes" | "todos" | "pagados";

const FILTROS: readonly (readonly [Filtro, string])[] = [
  ["pendientes", "Por cobrar"],
  ["pagados", "Pagados"],
  ["todos", "Todos"],
] as const;

/* Lo que la agencia gana: el fondo delegado se le cobra al cliente pero es
   dinero suyo camino a terceros, así que no cuenta como ingreso. */
function honorarios(i: AgenciaIngresoConEmpresa): number {
  return Math.max(0, i.total - i.fondo_delegado);
}

export function PanelCobros({
  ingresos,
  empresas,
  contratos,
}: {
  ingresos: AgenciaIngresoConEmpresa[];
  empresas: AgenciaEmpresa[];
  contratos: AgenciaContrato[];
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [filtro, setFiltro] = useState<Filtro>("pendientes");
  const [filtroEmpresa, setFiltroEmpresa] = useState<string>("todas");
  const [corte, setCorte] = useState(false);
  const [ingresoNuevo, setIngresoNuevo] = useState(false);
  const [detalle, setDetalle] = useState<AgenciaIngresoConEmpresa | null>(null);

  const visibles = useMemo(() => {
    const porEstado =
      filtro === "pagados"
        ? ingresos.filter((i) => i.estado === "pagado")
        : filtro === "todos"
          ? ingresos
          : ingresos.filter((i) => i.estado === "calculado" || i.estado === "cobrado");
    return filtroEmpresa === "todas"
      ? porEstado
      : porEstado.filter((i) => i.empresa_id === filtroEmpresa);
  }, [ingresos, filtro, filtroEmpresa]);

  const totales = useMemo(() => {
    let porCobrar = 0,
      cobradoSinPagar = 0,
      pagado = 0,
      delegado = 0;
    for (const i of ingresos) {
      if (i.estado === "calculado") porCobrar += honorarios(i);
      else if (i.estado === "cobrado") {
        cobradoSinPagar += honorarios(i);
        delegado += i.fondo_delegado;
      } else if (i.estado === "pagado") pagado += honorarios(i);
    }
    return { porCobrar, cobradoSinPagar, pagado, delegado };
  }, [ingresos]);

  function mover(id: string, estado: EstadoIngresoId) {
    ejecutar(() => cambiarEstadoIngreso(id, estado), {
      error: "No se pudo actualizar el cobro.",
    });
  }

  const columnas: Columna<AgenciaIngresoConEmpresa>[] = [
    {
      clave: "concepto",
      label: "Concepto",
      esTitulo: true,
      celda: (i) => {
        const tipo = obtenerTipoIngreso(i.tipo);
        return (
          <div className="min-w-0">
            <div className="truncate font-medium" title={i.concepto}>
              {i.concepto}
            </div>
            <div className="truncate text-[11.5px] text-muted-foreground">
              {tipo?.nombre}
              {i.socio ? ` · ${i.socio}` : ""}
              {i.periodo_desde && i.periodo_hasta
                ? ` · ${nombrePeriodo(i.periodo_desde, i.periodo_hasta)}`
                : ""}
            </div>
          </div>
        );
      },
    },
    {
      clave: "empresa",
      label: "Empresa",
      celda: (i) =>
        i.empresa ? (
          <Pastilla nombre={i.empresa.nombre} color={i.empresa.color} />
        ) : (
          <span className="text-muted-foreground/60">—</span>
        ),
    },
    {
      clave: "desglose",
      label: "Cómo se calculó",
      celda: (i) =>
        i.tipo === "contrato" ? (
          <div className="text-[12px] leading-tight text-muted-foreground">
            <div className="tabular-nums">
              {formatearMXN(i.monto_fijo)} + {i.porcentaje}% de {formatearMXN(i.ventas_base)}
            </div>
            <div className="tabular-nums">= {formatearMXN(i.monto_variable)} variable</div>
          </div>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
    {
      clave: "honorarios",
      label: "Honorarios",
      celda: (i) => (
        <span className="font-semibold tabular-nums">{formatearMXN(honorarios(i))}</span>
      ),
    },
    {
      clave: "total",
      label: "Se le cobra",
      celda: (i) => (
        <div>
          <div className="tabular-nums">{formatearMXN(i.total)}</div>
          {i.fondo_delegado > 0 && (
            <div className="text-[11px] text-muted-foreground" title="No cuenta como ingreso">
              incl. {formatearMXN(i.fondo_delegado)} delegados
            </div>
          )}
        </div>
      ),
    },
    {
      clave: "estado",
      label: "Estado",
      celda: (i) => {
        const e = obtenerEstadoIngreso(i.estado);
        return (
          <Select
            value={i.estado}
            onValueChange={(v) => v && mover(i.id, v as EstadoIngresoId)}
            disabled={pending}
          >
            <SelectTrigger className="h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0">
              {e && <Pastilla nombre={e.nombre} color={e.color} />}
            </SelectTrigger>
            <SelectContent>
              {ESTADOS_INGRESO.map((x) => (
                <SelectItem key={x.id} value={x.id}>
                  {x.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      },
    },
  ];

  const hayContratos = contratos.length > 0;

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Cobros</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Lo que se le factura a cada cliente y qué falta por entrar.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
          <Button
            variant="outline"
            onClick={() => {
              if (!hayContratos) {
                toast.error("Primero dale un contrato vigente a alguna empresa.");
                return;
              }
              setCorte(true);
            }}
            className="flex-1 md:flex-none"
          >
            <Calculator className="size-4" strokeWidth={2} />
            Calcular corte
          </Button>
          <Button onClick={() => setIngresoNuevo(true)} className="flex-1 md:flex-none">
            <Plus className="size-4" strokeWidth={2.2} />
            Otro cobro
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          etiqueta="Sin facturar"
          valor={formatearMXN(totales.porCobrar)}
          nota="calculado, falta pasarlo"
          icono={Calculator}
        />
        <StatCard
          etiqueta="Por cobrar"
          valor={formatearMXN(totales.cobradoSinPagar)}
          nota="facturado sin pagar"
          icono={Clock}
          valorClassName={totales.cobradoSinPagar > 0 ? "text-amber-600" : undefined}
        />
        <StatCard
          etiqueta="Cobrado"
          valor={formatearMXN(totales.pagado)}
          nota="honorarios que entraron"
          icono={Wallet}
        />
        <StatCard
          etiqueta="Fondos delegados"
          valor={formatearMXN(totales.delegado)}
          nota="dinero ajeno pendiente"
          icono={CircleDollarSign}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ControlSegmentado opciones={FILTROS} valor={filtro} onCambio={setFiltro} />
        <Select value={filtroEmpresa} onValueChange={(v) => setFiltroEmpresa(v ?? "todas")}>
          <SelectTrigger className="w-full bg-card md:w-[200px]">
            <SelectValue>
              {(v: string) =>
                v === "todas"
                  ? "Todas las empresas"
                  : (empresas.find((e) => e.id === v)?.nombre ?? "Empresa")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las empresas</SelectItem>
            {empresas.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <TablaSimple
        cols={COLS}
        columnas={columnas}
        datos={visibles}
        filaKey={(i) => i.id}
        minW="min-w-[900px]"
        onRowClick={(i) => setDetalle(i)}
        vacio={
          filtro === "pendientes"
            ? "Nada por cobrar. Todo al corriente. 🎉"
            : "No hay cobros que mostrar."
        }
      />

      {corte && (
        <CorteDialog
          contratos={contratos}
          empresas={empresas}
          ingresos={ingresos}
          onClose={() => setCorte(false)}
        />
      )}
      {(ingresoNuevo || detalle) && (
        <IngresoDialog
          ingreso={detalle}
          empresas={empresas}
          onClose={() => {
            setIngresoNuevo(false);
            setDetalle(null);
          }}
        />
      )}
    </div>
  );
}
