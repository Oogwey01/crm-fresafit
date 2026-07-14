"use client";

import { useMemo, useState, useTransition } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CANALES, esGestor, obtenerCanal } from "@/lib/catalogos";
import { diasDesdeHoy, formatearFecha, rangosDePeriodo } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import { importarVentasTiendanube } from "@/app/(app)/metricas/actions";
import type { Product, RolId, SaleConProducto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/compartido/stat-card";
import { ListaBarras } from "@/components/compartido/lista-barras";
import { TablaSimple, filaSimpleClases } from "@/components/compartido/tabla-simple";
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

const COLS_VENTAS = "grid-cols-[90px_130px_minmax(160px,1fr)_70px_110px_90px]";

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
  rol,
  tiendanube,
}: {
  ventas: SaleConProducto[];
  productos: Pick<Product, "id" | "nombre" | "variante" | "sku" | "precio" | "activo">[];
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
  const maxDia = Math.max(...dias.map((d) => d.total), 1);

  /* --- Por canal (periodo elegido) --- */
  const porCanal = useMemo(() => {
    const sumas = new Map<string, number>();
    for (const v of delPeriodo) sumas.set(v.canal, (sumas.get(v.canal) ?? 0) + v.monto);
    return CANALES.filter((c) => sumas.has(c.id)).map((c) => ({
      id: c.id,
      nombre: c.nombre,
      valor: sumas.get(c.id)!,
      color: c.color,
    })).sort((a, b) => b.valor - a.valor);
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
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Métricas del negocio</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Los números clave de un vistazo: qué se vende, por dónde y cuánto deja.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tiendanube.conectada && (
            <Button variant="outline" onClick={importar} disabled={importando}>
              <RefreshCw className={cn("size-4", importando && "animate-spin")} aria-hidden="true" />
              {importando ? "Importando…" : "Importar de Tienda Nube"}
            </Button>
          )}
          <div className="inline-flex rounded-lg bg-muted p-0.5">
            {PERIODOS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setPeriodo(id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  periodo === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Button onClick={() => setVentaDialog("nueva")}>+ Registrar venta</Button>
        </div>
      </div>

      {/* Números clave */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
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
        <StatCard etiqueta="Piezas vendidas" valor={String(piezas)} />
        <StatCard etiqueta="Ticket promedio" valor={formatearMXN(ticket)} />
      </div>

      {/* Ventas por día (14 días) — barras verticales CSS */}
      <div className="mb-4 rounded-lg border bg-card p-4">
        <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Ventas por día · últimos 14 días
        </h2>
        <div className="flex h-32 items-end gap-1">
          {dias.map((d) => (
            <div key={d.iso} className="group flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t bg-primary/80 transition-colors group-hover:bg-primary"
                  style={{ height: `${(d.total / maxDia) * 100}%`, minHeight: d.total > 0 ? 3 : 0 }}
                  title={`${formatearFecha(d.iso)}: ${formatearMXN(d.total)}`}
                />
              </div>
              <span className="text-[10px] text-muted-foreground">{Number(d.iso.slice(8, 10))}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Por canal + Top productos */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Por canal
          </h2>
          <ListaBarras items={porCanal} formatear={formatearMXN} />
        </div>
        <div className="rounded-lg border bg-card p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Productos estrella
          </h2>
          <ListaBarras items={topProductos} formatear={formatearMXN} />
        </div>
      </div>

      {/* Sin movimiento */}
      <div className="mb-4 rounded-lg border bg-card p-4">
        <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
          Sin movimiento en el periodo · {sinMovimiento.length}{" "}
          {sinMovimiento.length === 1 ? "producto" : "productos"}
        </h2>
        {sinMovimiento.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">Todo el catálogo activo tuvo ventas. 🎉</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {sinMovimiento.slice(0, 12).map((p) => (
              <span key={p.id} className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
                {p.nombre}
                {p.variante ? ` · ${p.variante}` : ""}
              </span>
            ))}
            {sinMovimiento.length > 12 && (
              <span className="px-1 text-xs text-muted-foreground">
                +{sinMovimiento.length - 12} más
              </span>
            )}
          </div>
        )}
      </div>

      {/* Últimas ventas (clic para corregir) */}
      <h2 className="mb-2 text-sm font-bold uppercase tracking-wide text-muted-foreground">
        Últimas ventas
      </h2>
      {ultimas.length === 0 ? (
        <p className="text-sm italic text-muted-foreground">
          Aún no hay ventas registradas. Usa «+ Registrar venta»
          {tiendanube.conectada ? " o «Importar de Tienda Nube»" : ""}.
        </p>
      ) : (
        <TablaSimple
          cols={COLS_VENTAS}
          encabezados={["Fecha", "Canal", "Producto", "Cant.", "Total", "Origen"]}
        >
          {ultimas.map((v) => {
            const canal = obtenerCanal(v.canal);
            return (
              <div key={v.id} className={filaSimpleClases(COLS_VENTAS)}>
                <div>{formatearFecha(v.fecha)}</div>
                <div>
                  {canal && (
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-white"
                      style={{ backgroundColor: canal.color }}
                    >
                      {canal.nombre}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setVentaDialog(v)}
                  className="truncate text-left font-medium hover:underline"
                  title={v.notas ?? nombreVenta(v)}
                >
                  {nombreVenta(v)}
                </button>
                <div className="tabular-nums">{v.cantidad}</div>
                <div className="font-semibold tabular-nums">{formatearMXN(v.monto)}</div>
                <div className="text-xs text-muted-foreground">
                  {v.origen === "api" ? "Automática" : v.origen === "csv" ? "CSV" : "Manual"}
                </div>
              </div>
            );
          })}
        </TablaSimple>
      )}

      {ventaDialog && (
        <VentaDialog
          venta={ventaDialog === "nueva" ? null : ventaDialog}
          productos={productos}
          gestor={gestor}
          onClose={() => setVentaDialog(null)}
        />
      )}
    </div>
  );
}
