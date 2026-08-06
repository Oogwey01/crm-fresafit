"use client";

import { useMemo, useState } from "react";
import { ArrowDownCircle, ArrowUpCircle, Paperclip, Plus, Wallet } from "lucide-react";
import { CATEGORIAS_GASTO, obtenerCategoriaGasto, obtenerEstadoComprobante } from "@/lib/catalogos";
import {
  formatearFecha,
  hoyISO,
  nombreMes,
  rangoPersonalizado,
  rangosDePeriodo,
  type PresetRangoId,
} from "@/lib/fecha";
import { RangoFechas } from "@/components/compartido/rango-fechas";
import { ETIQUETA_DELTA, deltaPct, enRango } from "@/lib/metricas";
import { formatearMXN } from "@/lib/moneda";
import type { ExpenseConComprobantes } from "@/lib/types";
import type { SugerenciasGasto } from "@/lib/finanzas/sugerencias";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pastilla } from "@/components/compartido/pastilla";
import { StatCard } from "@/components/compartido/stat-card";
import { ListaBarras } from "@/components/compartido/lista-barras";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { GastoDialog } from "@/components/finanzas/gasto-dialog";
import { ImportarGastos } from "@/components/finanzas/importar-gastos";

/* "" = rango elegido a mano en el calendario (sin atajo activo). */
type PeriodoId = PresetRangoId | "";

const ETIQUETA_PERIODO: Record<PeriodoId, string> = {
  ...ETIQUETA_DELTA,
  "": "vs. periodo anterior",
};

const COLS = "grid-cols-[95px_minmax(180px,1fr)_130px_140px_120px_150px_40px]";

/* La cola de trabajo de administración: gastos a los que todavía se les debe un
   papel. "Aún no" (`pendiente`) es deuda por recoger; "No" significa que no va
   a haber —el changarro no factura— y perseguirlo sería perder el tiempo. */
function faltanPapeles(g: ExpenseConComprobantes): boolean {
  return g.factura === "pendiente" || g.recibo === "pendiente";
}

export function PanelFinanzas({
  gastos,
  ventas,
  sugerencias,
}: {
  gastos: ExpenseConComprobantes[];
  /* Lo que entró, ya sumado por día en la base (RPC `ingresos_por_dia`).
     `null` = quien mira no ve los ingresos, y entonces no hay ni «Entradas» ni
     «Saldo»: este módulo es el de lo que SALE. Un array vacío significaría otra
     cosa —que no hubo ventas—, y ahí el saldo sí sería un dato. */
  ventas: { fecha: string; monto: number }[] | null;
  /* Conceptos, proveedores y métodos ya usados, con su número de usos: es lo
     que el diálogo propone al capturar (ver lib/finanzas/sugerencias.ts). */
  sugerencias: SugerenciasGasto;
}) {
  const [periodo, setPeriodo] = useState<PeriodoId>("mes");
  /* Rango a mano (cuando no hay atajo activo). */
  const [desde, setDesde] = useState(() => hoyISO().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoyISO);
  const [filtroCategoria, setFiltroCategoria] = useState("todas");
  const [soloPendientesPapeles, setSoloPendientesPapeles] = useState(false);
  const [dialog, setDialog] = useState<ExpenseConComprobantes | "nuevo" | null>(null);

  const rangos = periodo ? rangosDePeriodo(periodo) : rangoPersonalizado(desde, hasta);

  /* El gasto más reciente que hay capturado, sin importar el periodo elegido:
     es lo que permite explicar una pantalla vacía en vez de dejarla muda. */
  const ultimoGasto = gastos.reduce<ExpenseConComprobantes | null>(
    (mayor, g) => (!mayor || g.fecha > mayor.fecha ? g : mayor),
    null,
  );

  /* Salta al mes de ese último gasto (rango a mano, sin atajo activo). */
  function verMesDelUltimoGasto() {
    if (!ultimoGasto) return;
    const [anio, mes] = ultimoGasto.fecha.split("-");
    const finDeMes = new Date(Number(anio), Number(mes), 0).getDate();
    setDesde(`${anio}-${mes}-01`);
    setHasta(`${anio}-${mes}-${String(finDeMes).padStart(2, "0")}`);
    setPeriodo("");
  }

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
    ? ventas.filter((v) => enRango(v.fecha, rangos.actual)).reduce((a, v) => a + v.monto, 0)
    : null;
  const entradasAnterior = ventas
    ? ventas.filter((v) => enRango(v.fecha, rangos.anterior)).reduce((a, v) => a + v.monto, 0)
    : null;

  const salidas = gastosPeriodo.reduce((a, g) => a + g.monto, 0);
  const salidasAnterior = gastosAnterior.reduce((a, g) => a + g.monto, 0);
  const saldo = entradas === null ? null : entradas - salidas;

  const porCategoria = useMemo(() => {
    const sumas = new Map<string, number>();
    for (const g of gastosPeriodo) sumas.set(g.categoria, (sumas.get(g.categoria) ?? 0) + g.monto);
    return CATEGORIAS_GASTO.filter((c) => sumas.has(c.id))
      .map((c) => ({ id: c.id, nombre: c.nombre, valor: sumas.get(c.id)!, color: c.color }))
      .sort((a, b) => b.valor - a.valor);
  }, [gastosPeriodo]);

  /* Cuántos gastos del periodo siguen debiendo factura o recibo: es la carpeta
     del mes que administración le entrega a contabilidad. */
  const pendientesPapeles = gastosPeriodo.filter(faltanPapeles).length;

  const visibles = gastosPeriodo.filter(
    (g) =>
      (filtroCategoria === "todas" || g.categoria === filtroCategoria) &&
      (!soloPendientesPapeles || faltanPapeles(g)),
  );

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
        return cat ? <Pastilla nombre={cat.nombre} color={cat.color} /> : null;
      },
    },
    {
      clave: "proveedor",
      label: "Pagado a",
      celda: (g) => (
        <div className="min-w-0">
          <div className="truncate text-muted-foreground">{g.proveedor ?? "—"}</div>
          {g.metodo_pago && (
            <div className="truncate text-[11.5px] text-muted-foreground">{g.metodo_pago}</div>
          )}
        </div>
      ),
    },
    {
      clave: "monto",
      label: "Monto",
      celda: (g) => <div className="font-semibold tabular-nums">{formatearMXN(g.monto)}</div>,
    },
    {
      /* Lo que la hoja de facturas vigila: qué papel falta por recoger. Solo se
         pintan los pendientes; cuando ya está todo, la columna calla. */
      clave: "papeles",
      label: "Factura · recibo",
      celda: (g) => {
        const faltan = [
          g.factura !== "si" ? `factura ${obtenerEstadoComprobante(g.factura)?.nombre ?? ""}` : null,
          g.recibo !== "si" ? `recibo ${obtenerEstadoComprobante(g.recibo)?.nombre ?? ""}` : null,
        ].filter(Boolean);
        if (!faltan.length) return <Pastilla nombre="Completo" color="#22c55e" />;
        return (
          <span className="text-[12px] text-amber-600">
            {faltan.join(" · ").toLowerCase()}
          </span>
        );
      },
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
          {/* Mismo selector que Métricas: atajos y rango a mano en un solo sitio. */}
          <RangoFechas
            desde={desde}
            hasta={hasta}
            preset={periodo}
            onPreset={setPeriodo}
            onChange={(d, h) => {
              setDesde(d);
              setHasta(h);
              setPeriodo("");
            }}
            className="w-full md:w-[220px]"
          />
          <ImportarGastos />
          <Button
            onClick={() => setDialog("nuevo")}
            className="h-auto w-full gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.1} />
            Nuevo gasto
          </Button>
        </div>
      </div>

      {/* Entradas / Salidas / Saldo. Sin ingresos queda solo la del medio, a
          ancho completo: media tarjeta y dos huecos se leería como que algo
          falló, y no es que falte el dato, es que no toca. */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-3">
        {entradas !== null && (
          <StatCard
            etiqueta="Entradas (ventas)"
            valor={formatearMXN(entradas)}
            icono={ArrowUpCircle}
            valorClassName="text-green-600"
            delta={deltaPct(entradas, entradasAnterior ?? 0)}
            deltaEtiqueta={ETIQUETA_PERIODO[periodo]}
          />
        )}
        <StatCard
          etiqueta="Salidas (gastos)"
          valor={formatearMXN(salidas)}
          icono={ArrowDownCircle}
          valorClassName="text-red-600"
          delta={deltaPct(salidas, salidasAnterior)}
          deltaEtiqueta={ETIQUETA_PERIODO[periodo]}
          className={saldo === null ? "col-span-2 md:col-span-3" : undefined}
        />
        {saldo !== null && (
          <StatCard
            etiqueta="Saldo"
            valor={formatearMXN(saldo)}
            icono={Wallet}
            valorClassName={saldo >= 0 ? "text-green-600" : "text-red-600"}
            className="col-span-2 md:col-span-1"
          />
        )}
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
        {/* La cola de papeles por recoger, a un clic: era el filtro que se hacía
            a ojo recorriendo la columna «Factura · recibo». */}
        <Button
          variant={soloPendientesPapeles ? "default" : "outline"}
          onClick={() => setSoloPendientesPapeles((v) => !v)}
          className="h-auto rounded-[10px] px-3.5 py-2 text-[13px] font-semibold"
        >
          Faltan papeles{pendientesPapeles > 0 ? ` (${pendientesPapeles})` : ""}
        </Button>
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
        gastosPeriodo.length > 0 ? (
          <p className="text-sm italic text-muted-foreground">
            {soloPendientesPapeles
              ? "Nada pendiente de factura o recibo con esos filtros. 🎉"
              : "Ningún gasto en esa categoría."}
          </p>
        ) : ultimoGasto ? (
          /* Hay gastos capturados, pero no en la ventana elegida. Decir solo
             «no hay gastos» hacía pensar que la importación no había entrado:
             mejor apuntar a dónde sí están y llevar de un clic. */
          <div className="flex flex-col items-start gap-2 rounded-2xl border bg-card px-5 py-6 shadow-sm">
            <p className="text-sm text-muted-foreground">
              No hay gastos en este periodo. El último capturado es del{" "}
              <b className="text-foreground">{formatearFecha(ultimoGasto.fecha)}</b>.
            </p>
            <Button variant="outline" size="sm" onClick={verMesDelUltimoGasto}>
              Ver {nombreMes(Number(ultimoGasto.fecha.slice(0, 4)), Number(ultimoGasto.fecha.slice(5, 7)) - 1)}
            </Button>
          </div>
        ) : (
          <p className="text-sm italic text-muted-foreground">
            Aún no hay gastos capturados. Registra el primero con «Nuevo gasto».
          </p>
        )
      ) : (
        <TablaSimple
          cols={COLS}
          columnas={columnasGasto}
          datos={visibles}
          filaKey={(g) => g.id}
          minW="min-w-[780px]"
          onRowClick={(g) => setDialog(g)}
        />
      )}

      {dialog && (
        <GastoDialog
          gasto={dialog === "nuevo" ? null : dialog}
          sugerencias={sugerencias}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}
