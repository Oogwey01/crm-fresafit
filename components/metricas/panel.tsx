"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CANALES, TIPOS_PRODUCTO, esGestor, obtenerCanal, obtenerTipoProducto } from "@/lib/catalogos";
import { diasDesdeHoy, formatearFecha, hoyISO, rangoPersonalizado, rangosDePeriodo } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import { tallaDeVariante, compararTallas } from "@/lib/talla";
import { ETIQUETA_DELTA as ETIQUETA_DELTA_BASE, enRango, deltaPct } from "@/lib/metricas";
import { nombreVenta } from "@/lib/ventas";
import { GraficaVentasDia } from "@/components/metricas/grafica-ventas-dia";
import { importarVentasTiendanube } from "@/app/(app)/metricas/actions";
import type { CanalId, Customer, Product, RolId, VentaMetricas, TipoProductoId } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/compartido/date-picker";
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
import { VentaDialog } from "@/components/ventas/venta-dialog";
import { cn } from "@/lib/utils";

type PeriodoId = "hoy" | "semana" | "mes" | "mes_pasado" | "personalizado";

const PERIODOS: [PeriodoId, string][] = [
  ["hoy", "Hoy"],
  ["semana", "Semana"],
  ["mes", "Mes"],
  ["mes_pasado", "Mes pasado"],
  ["personalizado", "Fechas"],
];

/* Los cuatro periodos base salen del compartido; este panel añade el rango
   libre, que Finanzas no tiene. */
const ETIQUETA_DELTA: Record<PeriodoId, string> = {
  ...ETIQUETA_DELTA_BASE,
  personalizado: "vs. periodo anterior",
};

/* Ventas que se pintan de golpe en la tabla; el resto entra con «Ver más».
   Con el rango completo son miles de renglones y el navegador se arrastra. */
const VENTAS_POR_PAGINA = 100;

const COLS_VENTAS = "grid-cols-[90px_130px_minmax(220px,1fr)_70px_120px_110px]";

/* Rótulo de sección de las tarjetas. */
const ROTULO = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const TARJETA = "rounded-2xl border bg-card p-5 shadow-sm";

/* Chips de productos sin movimiento que se listan antes del «+N más». */
const CHIPS_SIN_MOVIMIENTO = 12;

export function PanelMetricas({
  ventas,
  productos,
  clientes,
  rol,
  tiendanube,
}: {
  ventas: VentaMetricas[];
  productos: Pick<Product, "id" | "nombre" | "variante" | "sku" | "precio" | "activo">[];
  clientes: Pick<Customer, "id" | "nombre" | "correo" | "telefono">[];
  rol: RolId;
  tiendanube: { conectada: boolean; ultimaSync: string | null };
}) {
  const gestor = esGestor(rol);
  const [periodo, setPeriodo] = useState<PeriodoId>("mes");
  /* Rango a mano (solo con periodo = "personalizado"). Arranca en el mes en
     curso para que al abrirlo ya muestre algo coherente. */
  const [desde, setDesde] = useState(() => hoyISO().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoyISO);
  /* Plataforma: "todas" o un canal. Afecta TODO el panel, no solo la tabla. */
  const [canal, setCanal] = useState<CanalId | "todas">("todas");
  const [visibles, setVisibles] = useState(VENTAS_POR_PAGINA);
  const [ventaDialog, setVentaDialog] = useState<VentaMetricas | "nueva" | null>(null);
  const [importando, startImportar] = useTransition();
  /* Desglose de «Productos estrella» por categoría y talla. */
  const [catEstrella, setCatEstrella] = useState<TipoProductoId | "todas">("todas");
  const [tallaEstrella, setTallaEstrella] = useState<string>("todas");

  const rangos =
    periodo === "personalizado" ? rangoPersonalizado(desde, hasta) : rangosDePeriodo(periodo);

  /* El filtro de plataforma se aplica una sola vez, aquí: de estas dos listas
     salen los KPIs, las gráficas, el top de productos y la tabla. */
  const delCanal = useMemo(
    () => (canal === "todas" ? ventas : ventas.filter((v) => v.canal === canal)),
    [ventas, canal],
  );
  const delPeriodo = useMemo(
    () => delCanal.filter((v) => enRango(v.fecha, rangos.actual)),
    [delCanal, rangos.actual],
  );
  const delAnterior = useMemo(
    () => delCanal.filter((v) => enRango(v.fecha, rangos.anterior)),
    [delCanal, rangos.anterior],
  );

  /* --- Números clave --- */
  const total = delPeriodo.reduce((a, v) => a + v.monto, 0);
  const totalAnterior = delAnterior.reduce((a, v) => a + v.monto, 0);
  const piezas = delPeriodo.reduce((a, v) => a + v.cantidad, 0);
  const ticket = delPeriodo.length > 0 ? total / delPeriodo.length : 0;
  const piezasPorVenta = delPeriodo.length > 0 ? piezas / delPeriodo.length : 0;

  /* --- Ventas por día (últimos 14 días, fijo; respeta la plataforma) --- */
  const dias = useMemo(() => {
    const lista: { iso: string; total: number; ventas: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const iso = diasDesdeHoy(-i);
      lista.push({ iso, total: 0, ventas: 0 });
    }
    const porDia = new Map(lista.map((d) => [d.iso, d]));
    for (const v of delCanal) {
      const d = porDia.get(v.fecha);
      if (d) {
        d.total += v.monto;
        d.ventas += 1;
      }
    }
    return lista;
  }, [delCanal]);

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

  /* --- Productos estrella, desglosables por categoría y talla --- */
  /* Ventas del periodo acotadas a la categoría elegida (sin aplicar aún la
     talla): base para el ranking de tallas y para las tallas disponibles. */
  const ventasCategoria = useMemo(
    () => (catEstrella === "todas" ? delPeriodo : delPeriodo.filter((v) => v.producto?.tipo === catEstrella)),
    [delPeriodo, catEstrella],
  );
  /* Tallas presentes en la categoría (para poblar el filtro). */
  const tallasDisponibles = useMemo(() => {
    const s = new Set<string>();
    for (const v of ventasCategoria) {
      const t = tallaDeVariante(v.producto?.variante);
      if (t) s.add(t);
    }
    return [...s].sort(compararTallas);
  }, [ventasCategoria]);
  /* Ventas ya acotadas por categoría Y talla → top de productos. */
  const topProductos = useMemo(() => {
    const filtradas =
      tallaEstrella === "todas"
        ? ventasCategoria
        : ventasCategoria.filter((v) => tallaDeVariante(v.producto?.variante) === tallaEstrella);
    const grupos = new Map<string, { nombre: string; monto: number; piezas: number }>();
    for (const v of filtradas) {
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
  }, [ventasCategoria, tallaEstrella]);
  /* Ranking de tallas más vendidas (por piezas) en la categoría elegida. */
  const tallasMasVendidas = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of ventasCategoria) {
      const t = tallaDeVariante(v.producto?.variante) ?? "Sin talla";
      m.set(t, (m.get(t) ?? 0) + v.cantidad);
    }
    return [...m.entries()]
      .map(([nombre, piezas]) => ({ id: nombre, nombre, valor: piezas }))
      .sort((a, b) => b.valor - a.valor);
  }, [ventasCategoria]);

  const sinMovimiento = useMemo(() => {
    const vendidos = new Set(delPeriodo.map((v) => v.producto_id).filter(Boolean));
    return productos.filter((p) => p.activo && !vendidos.has(p.id));
  }, [delPeriodo, productos]);

  /* Todas las ventas del filtro (no las 20 últimas de siempre): es la lista que
     se revisa para cuadrar contra la plataforma. Se pinta por páginas. */
  const listadas = delPeriodo.slice(0, visibles);
  const totalListado = delPeriodo.reduce((a, v) => a + v.monto, 0);

  const columnasVenta: Columna<VentaMetricas>[] = [
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
                onClick={() => {
                  setPeriodo(id);
                  setVisibles(VENTAS_POR_PAGINA);
                }}
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
          <Select
            value={canal}
            onValueChange={(v) => {
              setCanal((v ?? "todas") as CanalId | "todas");
              setVisibles(VENTAS_POR_PAGINA);
            }}
          >
            <SelectTrigger className="w-full bg-card md:w-[185px]">
              <SelectValue>
                {(v: string) =>
                  v === "todas" ? "Todas las plataformas" : (obtenerCanal(v)?.nombre ?? "Plataforma")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las plataformas</SelectItem>
              {CANALES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => setVentaDialog("nueva")}
            className="h-10 w-full rounded-xl text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_var(--primary)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.4} aria-hidden="true" />
            Registrar venta
          </Button>
        </div>
      </div>

      {/* Rango a mano: solo estorba cuando no se está usando */}
      {periodo === "personalizado" && (
        <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-xl border bg-card px-4 py-3">
          <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="ventas-desde">
            Del
          </label>
          <div className="w-[150px]">
            <DatePicker
              id="ventas-desde"
              value={desde}
              max={hasta}
              onChange={(v) => {
                setDesde(v);
                setVisibles(VENTAS_POR_PAGINA);
              }}
            />
          </div>
          <label className="text-[13px] font-semibold text-muted-foreground" htmlFor="ventas-hasta">
            al
          </label>
          <div className="w-[150px]">
            <DatePicker
              id="ventas-hasta"
              value={hasta}
              min={desde}
              onChange={(v) => {
                setHasta(v);
                setVisibles(VENTAS_POR_PAGINA);
              }}
            />
          </div>
          <span className="text-[12.5px] text-muted-foreground">
            {delPeriodo.length} {delPeriodo.length === 1 ? "venta" : "ventas"} ·{" "}
            {formatearMXN(totalListado)}
          </span>
        </div>
      )}

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
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          Arriba de cada barra, cuánto se vendió ese día; debajo, cuántas ventas fueron.
        </p>
      </div>

      {/* Por canal + Top productos */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={cn(TARJETA, "px-6")}>
          <h2 className={cn(ROTULO, "mb-4")}>Por canal</h2>
          <ListaBarras items={porCanal} formatear={formatearMXN} punto altoBarra={26} />
        </div>
        <div className={cn(TARJETA, "px-6")}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className={ROTULO}>Productos estrella</h2>
            <div className="flex items-center gap-1.5">
              <Select
                value={catEstrella}
                onValueChange={(v) => {
                  setCatEstrella((v ?? "todas") as TipoProductoId | "todas");
                  setTallaEstrella("todas");
                }}
              >
                <SelectTrigger className="h-8 w-[150px] bg-card text-[12.5px]">
                  <SelectValue>
                    {(v: string) =>
                      v === "todas" ? "Todas las categorías" : (obtenerTipoProducto(v)?.nombre ?? "Categoría")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las categorías</SelectItem>
                  {TIPOS_PRODUCTO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tallasDisponibles.length > 0 && (
                <Select value={tallaEstrella} onValueChange={(v) => setTallaEstrella(v ?? "todas")}>
                  <SelectTrigger className="h-8 w-[110px] bg-card text-[12.5px]">
                    <SelectValue>{(v: string) => (v === "todas" ? "Todas las tallas" : v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas las tallas</SelectItem>
                    {tallasDisponibles.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <ListaBarras
            items={topProductos}
            formatear={formatearMXN}
            anchoEtiqueta={190}
            vacio="Sin ventas con estos filtros en el periodo."
          />
        </div>
      </div>

      {/* Tallas más vendidas (de la categoría elegida arriba) */}
      <div className={cn(TARJETA, "mb-4 px-6")}>
        <h2 className={cn(ROTULO, "mb-4")}>
          Tallas más vendidas
          {catEstrella !== "todas" && (
            <span className="ml-1.5 font-medium normal-case tracking-normal text-muted-foreground">
              · {obtenerTipoProducto(catEstrella)?.nombre}
            </span>
          )}
        </h2>
        <ListaBarras
          items={tallasMasVendidas}
          formatear={(n) => `${n} pzas`}
          anchoEtiqueta={130}
          vacio="Sin ventas con talla identificable en el periodo."
        />
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

      {/* Ventas del periodo (clic en el producto para corregir) */}
      {delPeriodo.length === 0 ? (
        <div className={cn(TARJETA, "px-6")}>
          <h2 className={cn(ROTULO, "mb-2")}>Ventas</h2>
          <p className="text-sm italic text-muted-foreground">
            {ventas.length === 0
              ? `Aún no hay ventas registradas. Usa «+ Registrar venta»${tiendanube.conectada ? " o «Importar de Tienda Nube»" : ""}.`
              : "No hubo ventas con esos filtros. Prueba con otro periodo o plataforma."}
          </p>
        </div>
      ) : (
        <>
          <TablaSimple
            cols={COLS_VENTAS}
            titulo={
              <>
                Ventas del periodo · {delPeriodo.length}{" "}
                {delPeriodo.length === 1 ? "venta" : "ventas"} ·{" "}
                <span className="text-foreground">{formatearMXN(totalListado)}</span>
              </>
            }
            columnas={columnasVenta}
            datos={listadas}
            filaKey={(v) => v.id}
            onRowClick={(v) => setVentaDialog(v)}
          />
          {listadas.length < delPeriodo.length && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                onClick={() => setVisibles((n) => n + VENTAS_POR_PAGINA)}
                className="h-10 rounded-xl text-[13.5px] font-semibold"
              >
                Ver más ({delPeriodo.length - listadas.length} restantes)
              </Button>
            </div>
          )}
        </>
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
