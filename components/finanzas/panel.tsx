"use client";

import { useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Paperclip, Plus, Wallet } from "lucide-react";
import { CATEGORIAS_GASTO, obtenerCategoriaGasto } from "@/lib/catalogos";
import { formatearFecha, rangosDePeriodo } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { ExpenseConComprobantes, Sale } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/compartido/stat-card";
import { ListaBarras } from "@/components/compartido/lista-barras";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { GastoDialog } from "@/components/finanzas/gasto-dialog";
import { cn } from "@/lib/utils";

type PeriodoId = "hoy" | "semana" | "mes" | "mes_pasado";

const PERIODOS: [PeriodoId, string][] = [
  ["hoy", "Hoy"],
  ["semana", "Semana"],
  ["mes", "Mes"],
  ["mes_pasado", "Mes pasado"],
];

const ETIQUETA_DELTA: Record<PeriodoId, string> = {
  hoy: "vs. ayer",
  semana: "vs. semana pasada",
  mes: "vs. mes pasado",
  mes_pasado: "vs. antepasado",
};

const COLS = "grid-cols-[95px_minmax(180px,1fr)_130px_140px_120px_40px]";

function enRango(fecha: string, r: { desde: string; hasta: string }) {
  return fecha >= r.desde && fecha <= r.hasta;
}

function deltaPct(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

export function PanelFinanzas({
  gastos,
  ventas,
}: {
  gastos: ExpenseConComprobantes[];
  ventas: Pick<Sale, "fecha" | "monto">[];
}) {
  const [periodo, setPeriodo] = useState<PeriodoId>("mes");
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [dialog, setDialog] = useState<ExpenseConComprobantes | "nuevo" | null>(null);

  const rangos = rangosDePeriodo(periodo);

  const gastosPeriodo = useMemo(
    () => gastos.filter((g) => enRango(g.fecha, rangos.actual)),
    [gastos, rangos.actual],
  );
  const gastosAnterior = useMemo(
    () => gastos.filter((g) => enRango(g.fecha, rangos.anterior)),
    [gastos, rangos.anterior],
  );

  /* Entradas: se derivan de las ventas (nunca se capturan dos veces). */
  const entradas = ventas
    .filter((v) => enRango(v.fecha, rangos.actual))
    .reduce((a, v) => a + v.monto, 0);
  const entradasAnterior = ventas
    .filter((v) => enRango(v.fecha, rangos.anterior))
    .reduce((a, v) => a + v.monto, 0);

  const salidas = gastosPeriodo.reduce((a, g) => a + g.monto, 0);
  const salidasAnterior = gastosAnterior.reduce((a, g) => a + g.monto, 0);
  const saldo = entradas - salidas;

  const porCategoria = useMemo(() => {
    const sumas = new Map<string, number>();
    for (const g of gastosPeriodo) sumas.set(g.categoria, (sumas.get(g.categoria) ?? 0) + g.monto);
    return CATEGORIAS_GASTO.filter((c) => sumas.has(c.id))
      .map((c) => ({ id: c.id, nombre: c.nombre, valor: sumas.get(c.id)!, color: c.color }))
      .sort((a, b) => b.valor - a.valor);
  }, [gastosPeriodo]);

  const visibles =
    filtroCategoria === "todas"
      ? gastosPeriodo
      : gastosPeriodo.filter((g) => g.categoria === filtroCategoria);

  const columnasGasto: Columna<(typeof visibles)[number]>[] = [
    { clave: "fecha", label: "Fecha", celda: (g) => <div>{formatearFecha(g.fecha)}</div> },
    {
      clave: "concepto",
      label: "Concepto",
      esTitulo: true,
      celda: (g) => (
        <button
          type="button"
          onClick={() => setDialog(g)}
          className="truncate text-left font-medium hover:underline"
          title={g.notas ?? g.concepto}
        >
          {g.concepto}
        </button>
      ),
    },
    {
      clave: "categoria",
      label: "Categoría",
      celda: (g) => {
        const cat = obtenerCategoriaGasto(g.categoria);
        return cat ? (
          <span
            className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold"
            style={{ backgroundColor: `${cat.color}1F`, color: cat.color }}
          >
            {cat.nombre}
          </span>
        ) : null;
      },
    },
    {
      clave: "proveedor",
      label: "Pagado a",
      celda: (g) => <div className="truncate text-muted-foreground">{g.proveedor ?? "—"}</div>,
    },
    {
      clave: "monto",
      label: "Monto",
      celda: (g) => <div className="font-semibold tabular-nums">{formatearMXN(g.monto)}</div>,
    },
    {
      clave: "comprobantes",
      label: "Comprobantes",
      celda: (g) =>
        g.comprobantes.length > 0 ? (
          <span
            className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"
            title={`${g.comprobantes.length} comprobante(s)`}
          >
            <Paperclip className="size-3.5" />
            {g.comprobantes.length}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
  ];

  return (
    <div>
      {/* Encabezado */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Finanzas y gastos</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Cuánto entra, cuánto sale y cuánto queda. Solo Dirección ve este módulo.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto">
          <div className="flex w-full rounded-lg bg-muted p-0.5 md:inline-flex md:w-auto">
            {PERIODOS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setPeriodo(id)}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors md:flex-none",
                  periodo === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            onClick={() => setDialog("nuevo")}
            className="h-auto w-full gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.1} />
            Nuevo gasto
          </Button>
        </div>
      </div>

      {/* Entradas / Salidas / Saldo */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-3">
        <StatCard
          etiqueta="Entradas (ventas)"
          valor={formatearMXN(entradas)}
          icono={ArrowUpCircle}
          valorClassName="text-green-600"
          delta={deltaPct(entradas, entradasAnterior)}
          deltaEtiqueta={ETIQUETA_DELTA[periodo]}
        />
        <StatCard
          etiqueta="Salidas (gastos)"
          valor={formatearMXN(salidas)}
          icono={ArrowDownCircle}
          valorClassName="text-red-600"
          delta={deltaPct(salidas, salidasAnterior)}
          deltaEtiqueta={ETIQUETA_DELTA[periodo]}
        />
        <StatCard
          etiqueta="Saldo"
          valor={formatearMXN(saldo)}
          icono={Wallet}
          valorClassName={saldo >= 0 ? "text-green-600" : "text-red-600"}
          className="col-span-2 md:col-span-1"
        />
      </div>

      {/* Gastos por categoría */}
      <div className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Gastos por categoría
        </h2>
        <ListaBarras items={porCategoria} formatear={formatearMXN} vacio="Sin gastos en este periodo." />
      </div>

      {/* Lista de gastos */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Gastos del periodo
        </h2>
        <div className="flex-1" />
        <Select value={filtroCategoria} onValueChange={(v) => setFiltroCategoria(v ?? "todas")}>
          <SelectTrigger className="w-[180px] bg-card">
            <SelectValue>
              {(v: string) =>
                v === "todas" ? "Todas las categorías" : (obtenerCategoriaGasto(v)?.nombre ?? "Categoría")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las categorías</SelectItem>
            {CATEGORIAS_GASTO.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {visibles.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          {gastosPeriodo.length === 0
            ? "Aún no hay gastos en este periodo. Registra el primero con «Nuevo gasto»."
            : "Ningún gasto en esa categoría."}
        </p>
      ) : (
        <TablaSimple
          cols={COLS}
          columnas={columnasGasto}
          datos={visibles}
          filaKey={(g) => g.id}
          minW="min-w-[780px]"
        />
      )}

      {dialog && (
        <GastoDialog
          gasto={dialog === "nuevo" ? null : dialog}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
