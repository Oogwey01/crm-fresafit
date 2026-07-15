"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CANALES, esGestor, obtenerCanal } from "@/lib/catalogos";
import { diasDesdeHoy, formatearFecha, rangosDePeriodo } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import { importarVentasTiendanube } from "@/app/(app)/metricas/actions";
import type { Customer, Product, RolId, SaleConProducto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/compartido/stat-card";
import { ListaBarras } from "@/components/compartido/lista-barras";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { VentaDialog } from "@/components/ventas/venta-dialog";
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

const COLS_VENTAS = "grid-cols-[90px_130px_minmax(220px,1fr)_70px_120px_110px]";

/* Rótulo de sección de las tarjetas. */
const ROTULO = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const TARJETA = "rounded-2xl border bg-card p-5 shadow-sm";

/* Alto (px) de la barra más alta en "ventas por día". */
const ALTO_BARRAS = 190;

/* Chips de productos sin movimiento que se listan antes del «+N más». */
const CHIPS_SIN_MOVIMIENTO = 12;

/* Gráfica de barras verticales «ventas por día». Recalcula su propio máximo
   sobre los días que recibe, así el subconjunto móvil (7 días) no se aplana por
   un pico fuera de la ventana. Columnas por `gridTemplateColumns` inline: el
   número es dinámico y no puede ir en una clase Tailwind estática. */
function GraficaVentasDia({ dias }: { dias: { iso: string; total: number }[] }) {
  const max = Math.max(...dias.map((d) => d.total), 1);
  const cols = { gridTemplateColumns: `repeat(${dias.length}, minmax(0, 1fr))` };
  return (
    <>
      {/* Altura en PÍXELES, no en %: dentro de un flex/grid sin altura definida
          el navegador resuelve `height: X%` a cero y las barras se aplanan. */}
      <div className="grid items-end gap-2.5" style={{ ...cols, height: ALTO_BARRAS }}>
        {dias.map((d) => (
          <div
            key={d.iso}
            className="w-full rounded-t-[7px] rounded-b-[3px] bg-primary transition-[filter] hover:brightness-110"
            style={{
              height: d.total > 0 ? Math.max(3, Math.round((d.total / max) * ALTO_BARRAS)) : 0,
            }}
            title={`${formatearFecha(d.iso)}: ${formatearMXN(d.total)}`}
          />
        ))}
      </div>
      <div className="mt-2.5 grid gap-2.5 border-t pt-2.5" style={cols}>
        {dias.map((d) => (
          <span
            key={d.iso}
            className="text-center text-[11.5px] font-medium text-muted-foreground"
          >
            {Number(d.iso.slice(8, 10))}
          </span>
        ))}
      </div>
    </>
  );
}

function nombreVenta(v: SaleConProducto): string {
  return v.producto
    ? `${v.producto.nombre}${v.producto.variante ? ` · ${v.producto.variante}` : ""}`
    : (v.descripcion ?? "—");
}

function enRango(fecha: string, r: { desde: string; hasta: string }): boolean {
  return fecha >= r.desde && fecha <= r.hasta;
}

/* Δ porcentual entre dos totales (null si no hay base de comparación). */
function deltaPct(actual: number, anterior: number): number | null {
  if (anterior <= 0) return null;
  return ((actual - anterior) / anterior) * 100;
}

export function PanelMetricas({
  ventas,
  productos,
  clientes,
  rol,
  tiendanube,
}: {
  ventas: SaleConProducto[];
  productos: Pick<Product, "id" | "nombre" | "variante" | "sku" | "precio" | "activo">[];
  clientes: Pick<Customer, "id" | "nombre" | "correo" | "telefono">[];
  rol: RolId;
  tiendanube: { conectada: boolean; ultimaSync: string | null };
}) {
  const gestor = esGestor(rol);
  const [periodo, setPeriodo] = useState<PeriodoId>("mes");
  const [ventaDialog, setVentaDialog] = useState<SaleConProducto | "nueva" | null>(null);
  const [importando, startImportar] = useTransition();

  const rangos = rangosDePeriodo(periodo);
  const delPeriodo = useMemo(
    () => ventas.filter((v) => enRango(v.fecha, rangos.actual)),
    [ventas, rangos.actual],
  );
  const delAnterior = useMemo(
    () => ventas.filter((v) => enRango(v.fecha, rangos.anterior)),
    [ventas, rangos.anterior],
  );

  /* --- Números clave --- */
  const total = delPeriodo.reduce((a, v) => a + v.monto, 0);
  const totalAnterior = delAnterior.reduce((a, v) => a + v.monto, 0);
  const piezas = delPeriodo.reduce((a, v) => a + v.cantidad, 0);
  const ticket = delPeriodo.length > 0 ? total / delPeriodo.length : 0;
  const piezasPorVenta = delPeriodo.length > 0 ? piezas / delPeriodo.length : 0;

  /* --- Ventas por día (últimos 14 días, fijo) --- */
  const dias = useMemo(() => {
    const lista: { iso: string; total: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const iso = diasDesdeHoy(-i);
      lista.push({ iso, total: 0 });
    }
    const porDia = new Map(lista.map((d) => [d.iso, d]));
    for (const v of ventas) {
      const d = porDia.get(v.fecha);
      if (d) d.total += v.monto;
    }
    return lista;
  }, [ventas]);

  /* --- Por canal: se listan todos los canales del catálogo, incluso en cero
     (atenuados), para que se vea de dónde NO está entrando dinero. "Otro" solo
     aparece si tuvo ventas. --- */
  const porCanal = useMemo(() => {
    const sumas = new Map<string, number>();
    for (const v of delPeriodo) sumas.set(v.canal, (sumas.get(v.canal) ?? 0) + v.monto);
    return CANALES.filter((c) => c.id !== "otro" || sumas.has(c.id))
      .map((c) => ({
        id: c.id,
        nombre: c.nombre,
        valor: sumas.get(c.id) ?? 0,
        color: c.color,
      }))
      .sort((a, b) => b.valor - a.valor);
  }, [delPeriodo]);

  /* --- Top productos y sin movimiento (periodo elegido) --- */
  const topProductos = useMemo(() => {
    const grupos = new Map<string, { nombre: string; monto: number; piezas: number }>();
    for (const v of delPeriodo) {
      const clave = v.producto_id ?? `libre:${v.descripcion ?? "otro"}`;
      const g = grupos.get(clave) ?? { nombre: nombreVenta(v), monto: 0, piezas: 0 };
      g.monto += v.monto;
      g.piezas += v.cantidad;
      grupos.set(clave, g);
    }
    return [...grupos.entries()]
      .map(([id, g]) => ({ id, nombre: g.nombre, valor: g.monto, detalle: `${g.piezas} pzas` }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5);
  }, [delPeriodo]);

  const sinMovimiento = useMemo(() => {
    const vendidos = new Set(delPeriodo.map((v) => v.producto_id).filter(Boolean));
    return productos.filter((p) => p.activo && !vendidos.has(p.id));
  }, [delPeriodo, productos]);

  const ultimas = ventas.slice(0, 20);

  const columnasVenta: Columna<SaleConProducto>[] = [
    {
      clave: "fecha",
      label: "Fecha",
      celda: (v) => <div className="text-[13.5px] text-muted-foreground">{formatearFecha(v.fecha)}</div>,
    },
    {
      clave: "canal",
      label: "Canal",
      celda: (v) => {
        const canal = obtenerCanal(v.canal);
        return canal ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold"
            style={{ backgroundColor: `${canal.color}1a`, color: canal.color }}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: canal.color }} />
            {canal.nombre}
          </span>
        ) : null;
      },
    },
    {
      clave: "producto",
      label: "Producto",
      esTitulo: true,
      celda: (v) => (
        <button
          type="button"
          onClick={() => setVentaDialog(v)}
          className="truncate text-left text-[14px] font-medium hover:underline"
          title={v.notas ?? nombreVenta(v)}
        >
          {nombreVenta(v)}
        </button>
      ),
    },
    {
      clave: "cantidad",
      label: "Cant.",
      celda: (v) => <div className="text-[13.5px] tabular-nums">{v.cantidad}</div>,
    },
    {
      clave: "total",
      label: "Total",
      celda: (v) => <div className="text-[13.5px] font-bold tabular-nums">{formatearMXN(v.monto)}</div>,
    },
    {
      clave: "origen",
      label: "Origen",
      celda: (v) => (
        <div className="text-[12.5px] text-muted-foreground">
          {v.origen === "api" ? "Automática" : v.origen === "csv" ? "CSV" : "Manual"}
        </div>
      ),
    },
  ];

  function importar() {
    startImportar(async () => {
      const r = await importarVentasTiendanube();
      if ("error" in r) toast.error(r.error);
      else toast.success(r.detalle);
    });
  }

  return (
    <div>
      {/* Barra superior */}
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Métricas del negocio</h1>
          <p className="mt-1.5 max-w-[620px] text-[14.5px] text-muted-foreground">
            Los números clave de un vistazo: qué se vende, por dónde y cuánto deja.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2.5 md:w-auto md:justify-end">
          {tiendanube.conectada && (
            <Button
              variant="outline"
              onClick={importar}
              disabled={importando}
              className="h-10 w-full rounded-xl text-[13.5px] font-semibold md:w-auto"
            >
              <RefreshCw className={cn("size-4", importando && "animate-spin")} aria-hidden="true" />
              {importando ? "Importando…" : "Importar de Tienda Nube"}
            </Button>
          )}
          <div className="flex w-full rounded-xl bg-muted p-[3px] md:inline-flex md:w-auto">
            {PERIODOS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setPeriodo(id)}
                className={cn(
                  "flex-1 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition-colors md:flex-none",
                  periodo === id
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button
            onClick={() => setVentaDialog("nueva")}
            className="h-10 w-full rounded-xl text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_var(--primary)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.4} aria-hidden="true" />
            Registrar venta
          </Button>
        </div>
      </div>

      {/* Números clave */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard
          etiqueta="Ventas"
          valor={formatearMXN(total)}
          delta={deltaPct(total, totalAnterior)}
          deltaEtiqueta={ETIQUETA_DELTA[periodo]}
        />
        <StatCard
          etiqueta="Nº de ventas"
          valor={String(delPeriodo.length)}
          delta={deltaPct(delPeriodo.length, delAnterior.length)}
          deltaEtiqueta={ETIQUETA_DELTA[periodo]}
        />
        <StatCard
          etiqueta="Piezas vendidas"
          valor={String(piezas)}
          nota={
            piezasPorVenta > 0
              ? `${piezasPorVenta.toFixed(piezasPorVenta % 1 === 0 ? 0 : 1)} ${
                  piezasPorVenta === 1 ? "pieza" : "piezas"
                } por venta`
              : "Sin ventas en el periodo"
          }
        />
        <StatCard etiqueta="Ticket promedio" valor={formatearMXN(ticket)} nota="por transacción" />
      </div>

      {/* Ventas por día — 7 barras en móvil (sin astillas), 14 en escritorio */}
      <div className={cn(TARJETA, "mb-4 px-6")}>
        <h2 className={cn(ROTULO, "mb-4")}>
          Ventas por día · últimos <span className="md:hidden">7</span>
          <span className="hidden md:inline">14</span> días
        </h2>
        <div className="md:hidden">
          <GraficaVentasDia dias={dias.slice(-7)} />
        </div>
        <div className="hidden md:block">
          <GraficaVentasDia dias={dias} />
        </div>
      </div>

      {/* Por canal + Top productos */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={cn(TARJETA, "px-6")}>
          <h2 className={cn(ROTULO, "mb-4")}>Por canal</h2>
          <ListaBarras items={porCanal} formatear={formatearMXN} punto altoBarra={26} />
        </div>
        <div className={cn(TARJETA, "px-6")}>
          <h2 className={cn(ROTULO, "mb-4")}>Productos estrella</h2>
          <ListaBarras items={topProductos} formatear={formatearMXN} anchoEtiqueta={190} />
        </div>
      </div>

      {/* Sin movimiento */}
      <div className={cn(TARJETA, "mb-4 px-6")}>
        <h2 className={cn(ROTULO, "mb-3.5")}>
          Sin movimiento en el periodo ·{" "}
          <span className={sinMovimiento.length > 0 ? "text-red-600" : "text-green-600"}>
            {sinMovimiento.length} {sinMovimiento.length === 1 ? "producto" : "productos"}
          </span>
        </h2>
        {sinMovimiento.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            Todo el catálogo activo tuvo ventas. 🎉
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {sinMovimiento.slice(0, CHIPS_SIN_MOVIMIENTO).map((p) => (
              <span
                key={p.id}
                className="rounded-full border bg-muted/40 px-3 py-1.5 text-[12.5px] text-muted-foreground"
              >
                {p.nombre}
                {p.variante ? ` · ${p.variante}` : ""}
              </span>
            ))}
            {sinMovimiento.length > CHIPS_SIN_MOVIMIENTO && (
              <span className="px-2 text-[12.5px] font-medium text-muted-foreground">
                +{sinMovimiento.length - CHIPS_SIN_MOVIMIENTO} más
              </span>
            )}
          </div>
        )}
      </div>

      {/* Últimas ventas (clic en el producto para corregir) */}
      {ultimas.length === 0 ? (
        <div className={cn(TARJETA, "px-6")}>
          <h2 className={cn(ROTULO, "mb-2")}>Últimas ventas</h2>
          <p className="text-sm italic text-muted-foreground">
            Aún no hay ventas registradas. Usa «+ Registrar venta»
            {tiendanube.conectada ? " o «Importar de Tienda Nube»" : ""}.
          </p>
        </div>
      ) : (
        <TablaSimple
          cols={COLS_VENTAS}
          titulo="Últimas ventas"
          columnas={columnasVenta}
          datos={ultimas}
          filaKey={(v) => v.id}
        />
      )}

      {ventaDialog && (
        <VentaDialog
          venta={ventaDialog === "nueva" ? null : ventaDialog}
          productos={productos}
          clientes={clientes}
          gestor={gestor}
          onClose={() => setVentaDialog(null)}
        />
      )}
    </div>
  );
}
