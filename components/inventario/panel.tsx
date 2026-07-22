"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Boxes,
  DollarSign,
  Lock,
  PackageX,
  Plus,
  RefreshCw,
  Search,
  ShoppingCart,
  Store,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { esGestor } from "@/lib/catalogos";
import { ESTADOS_STOCK, estadoStock, obtenerEstadoStock } from "@/lib/inventario/stock";
import {
  calcularReabastecimiento,
  esFull,
  type EnCamino,
  type GrupoReorden,
  type ParamsReorden,
  type VentaReorden,
} from "@/lib/inventario/reabastecimiento";
import { formatearMXN } from "@/lib/moneda";
import {
  revisarDescuadres,
  sincronizarMercadolibre,
  sincronizarTiendanube,
} from "@/app/(app)/inventario/actions";
import type {
  ProductConProveedor,
  Supplier,
  SupplierOrderConDetalle,
  StockLog,
  RolId,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/compartido/stat-card";
import { cn } from "@/lib/utils";
import { TIPOS_PRODUCTO, obtenerTipoProducto } from "@/lib/catalogos";
import { TablaProductos } from "@/components/inventario/tabla-productos";
import { ProductoDialog } from "@/components/inventario/producto-dialog";
import { ProductoVista } from "@/components/inventario/producto-vista";
import { TablaProveedores } from "@/components/inventario/tabla-proveedores";
import { ProveedorDialog } from "@/components/inventario/proveedor-dialog";
import { TablaPedidosProv } from "@/components/inventario/tabla-pedidos-prov";
import { PedidoProvDialog } from "@/components/inventario/pedido-prov-dialog";
import { TablaMovimientos } from "@/components/inventario/tabla-movimientos";
import { TablaDescuadres } from "@/components/inventario/tabla-descuadres";
import { FichasDuplicadas } from "@/components/inventario/fichas-duplicadas";
import { PanelPiloto } from "@/components/inventario/panel-piloto";
import type { EstadoPiloto } from "@/lib/inventario/piloto";
import { TablaReabastecer } from "@/components/inventario/tabla-reabastecer";
import type { ItemInicialPedido } from "@/components/inventario/pedido-prov-dialog";
import type { ResumenReconciliacion } from "@/lib/inventario/reconciliacion";

type Pestana =
  | "productos"
  | "reabastecer"
  | "proveedores"
  | "pedidos"
  | "movimientos"
  | "reconciliacion";

const PESTANAS = [
  ["productos", "Productos"],
  ["reabastecer", "Qué pedir"],
  ["proveedores", "Proveedores"],
  ["pedidos", "Pedidos a proveedor"],
  ["movimientos", "Historial de stock"],
  ["reconciliacion", "Reconciliación"],
] as const;

/* Ventana de ventas del reorden que se muestra al entrar (la tabla «Qué pedir»
   la deja cambiar; la tarjeta KPI y el pop-up de producto usan ésta). */
const VENTANA_REORDEN = 30;

/* Solo las pestañas que permiten dar de alta algo (movimientos es de lectura). */
const ETIQUETA_NUEVO: Partial<Record<Pestana, string>> = {
  productos: "Nuevo producto",
  proveedores: "Nuevo proveedor",
  pedidos: "Nuevo pedido",
};

/* Filtro de dónde está guardado el stock (solo tiene sentido con ML conectado):
   Mercado Full es un almacén distinto al de la bodega. */
const LOGISTICAS = [
  ["todos", "Full y bodega"],
  ["full", "Solo Mercado Full"],
  ["bodega", "Solo bodega"],
] as const;

/* Filtro de canal para el historial de movimientos. */
const CANALES_MOV = [
  ["todos", "Todos los canales"],
  ["crm", "CRM (local)"],
  ["tienda_nube", "Tienda Nube"],
  ["mercado_libre", "Mercado Libre"],
  ["tiktok_shop", "TikTok Shop"],
] as const;

/* Valor compacto para la tarjeta KPI: "$684K" en vez de "$684,231.00". */
function valorCompacto(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return formatearMXN(n);
}

function fechaCorta(iso: string): string {
  // timeZone fija: el servidor (UTC) y el navegador deben pintar lo mismo.
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

export function PanelInventario({
  productos,
  proveedores,
  pedidos,
  movimientos,
  ventas,
  enCamino,
  paramsReorden,
  rol,
  tiendanube,
  mercadolibre,
  escrituraCanales,
  piloto,
}: {
  productos: ProductConProveedor[];
  proveedores: Supplier[];
  pedidos: SupplierOrderConDetalle[];
  movimientos: StockLog[];
  /* Ventas de los últimos 90 días: la velocidad de salida de cada producto. */
  ventas: VentaReorden[];
  /* Unidades pedidas a proveedor que aún no llegan, por producto. */
  enCamino: EnCamino;
  paramsReorden: ParamsReorden;
  rol: RolId;
  tiendanube: { conectada: boolean; ultimaSync: string | null };
  mercadolibre: { conectada: boolean; ultimaSync: string | null };
  /* false (el default del sistema) = el CRM no modifica nada en las plataformas. */
  escrituraCanales: boolean;
  /* Estado del piloto de escritura: qué productos manda el CRM y cómo van. */
  piloto: EstadoPiloto;
}) {
  const gestor = esGestor(rol);
  const [pestana, setPestana] = useState<Pestana>("productos");
  const [sincronizando, startSync] = useTransition();
  const [sincronizandoML, startSyncML] = useTransition();

  /* Avisos al volver del OAuth (?tiendanube=… / ?mercadolibre=…). */
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tn = params.get("tiendanube");
    const ml = params.get("mercadolibre");
    if (!tn && !ml) return;
    if (tn === "conectada") {
      const n = params.get("productos");
      toast.success(`Tienda Nube conectada${n ? ` · ${n} productos importados` : ""}.`);
      if (params.get("webhooks") === "pendientes")
        toast.info("La actualización automática (webhooks) se activará con el deploy en Vercel.");
    } else if (tn) {
      toast.error("No se pudo conectar Tienda Nube. Intenta de nuevo.");
    }
    if (ml === "conectada") {
      const n = params.get("items");
      const v = params.get("vinculados");
      toast.success(
        `Mercado Libre conectado${n ? ` · ${n} publicaciones importadas` : ""}${v && v !== "0" ? ` (${v} vinculadas por SKU)` : ""}.`,
      );
    } else if (ml) {
      toast.error("No se pudo conectar Mercado Libre. Intenta de nuevo.");
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, []);

  function sincronizar() {
    startSync(async () => {
      const r = await sincronizarTiendanube();
      if ("error" in r) toast.error(r.error);
      else toast.success(r.detalle);
    });
  }

  function sincronizarML() {
    startSyncML(async () => {
      const r = await sincronizarMercadolibre();
      if ("error" in r) toast.error(r.error);
      else toast.success(r.detalle);
    });
  }

  /* null = cerrado; "nuevo" = alta; objeto = edición. */
  const [productoDialog, setProductoDialog] = useState<ProductConProveedor | "nuevo" | null>(null);
  /* La vista rápida guarda el id, no el producto: así el pop-up abierto refleja
     lo que se ajusta desde él (stock, fotos) cuando la página revalida. */
  const [productoVistaId, setProductoVistaId] = useState<string | null>(null);
  const productoVista = productoVistaId
    ? (productos.find((p) => p.id === productoVistaId) ?? null)
    : null;
  const [proveedorDialog, setProveedorDialog] = useState<Supplier | "nuevo" | null>(null);
  const [pedidoDialog, setPedidoDialog] = useState<SupplierOrderConDetalle | "nuevo" | null>(null);
  /* Renglones con los que abre un pedido nuevo (viene de «Qué pedir»). */
  const [itemsIniciales, setItemsIniciales] = useState<ItemInicialPedido[] | undefined>(undefined);

  /* Búsqueda y filtro de tipo — viven aquí para poder pintarlos junto a las
     pestañas (aplican a "Productos" y a "Qué pedir"). */
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");

  /* Filtro de semáforo de stock (solo aplica a la pestaña de productos). */
  const [filtroStock, setFiltroStock] = useState("todos");

  /* Filtro de almacén: Mercado Full vs. bodega (solo con ML conectado). */
  const [filtroLogistica, setFiltroLogistica] = useState("todos");
  const productosVisibles =
    filtroLogistica === "todos"
      ? productos
      : productos.filter((p) => (filtroLogistica === "full" ? esFull(p) : !esFull(p)));

  /* Reconciliación: se corre a demanda (lee los catálogos en vivo de cada
     canal), así que el resultado vive aquí hasta que se vuelva a pedir. */
  const [revisando, startRevision] = useTransition();
  const [reconciliacion, setReconciliacion] = useState<ResumenReconciliacion | null>(null);

  function revisar() {
    startRevision(async () => {
      const r = await revisarDescuadres();
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      setReconciliacion(r.resumen);
      const n = r.resumen.descuadres.length;
      const dup = r.resumen.duplicados.length;
      const repetidas = dup ? ` · ${dup} artículo${dup === 1 ? "" : "s"} con fichas repetidas` : "";
      if (n === 0) toast.success(`Todo cuadra: ${r.resumen.revisados} productos revisados.${repetidas}`);
      else
        toast.warning(
          `${n} producto${n === 1 ? "" : "s"} con descuadre de ${r.resumen.revisados} revisados.${repetidas}`,
        );
    });
  }

  /* Filtro de canal del historial (solo aplica a la pestaña de movimientos). */
  const [filtroCanalMov, setFiltroCanalMov] = useState("todos");
  const movimientosFiltrados =
    filtroCanalMov === "todos" ? movimientos : movimientos.filter((m) => m.canal === filtroCanalMov);

  /* Agotado (ya no hay) y por acabarse (queda poco: lo accionable) son cosas
     distintas; juntarlos ahogaba el aviso con cientos de variantes agotadas. */
  const agotados = productos.filter((p) => estadoStock(p) === "agotado");
  const porAcabarse = productos.filter((p) => estadoStock(p) === "por_acabarse");
  const pedidosEnCamino = pedidos.filter((p) => p.estado !== "recibido" && p.estado !== "cancelado");
  const valorInventario = productos.reduce((acc, p) => acc + p.stock * (p.costo ?? 0), 0);

  /* Reorden con la ventana y la plataforma por defecto de «Qué pedir» (30 días,
     todas), para que la tarjeta KPI, la tabla y el pop-up de un producto cuenten
     lo mismo al entrar. */
  const reorden = useMemo(
    () =>
      calcularReabastecimiento({
        productos,
        ventas,
        enCamino,
        ventanaDias: VENTANA_REORDEN,
        params: paramsReorden,
      }),
    [productos, ventas, enCamino, paramsReorden],
  );
  const porPedir = reorden.filter((g) => g.urgencia === "pedir_ya");
  /* El reorden agrupa por SKU: la ficha abierta puede compartir grupo con sus
     publicaciones gemelas. Los inactivos y los de bajo pedido no tienen grupo. */
  const grupoVista = productoVista
    ? (reorden.find((g) => g.productoIds.includes(productoVista.id)) ?? null)
    : null;

  function abrirNuevo() {
    if (pestana === "productos") setProductoDialog("nuevo");
    else if (pestana === "proveedores") setProveedorDialog("nuevo");
    else if (pestana === "pedidos") {
      setItemsIniciales(undefined);
      setPedidoDialog("nuevo");
    }
  }

  /* Desde el aviso de stock bajo: llevar a Pedidos y abrir uno nuevo. */
  function generarPedido() {
    setItemsIniciales(undefined);
    setPestana("pedidos");
    setPedidoDialog("nuevo");
  }

  /* Desde «Qué pedir»: pedido nuevo con el renglón y la cantidad sugerida. */
  function pedirSugerido(grupo: GrupoReorden) {
    setItemsIniciales([{ producto_id: grupo.productoId, cantidad: grupo.sugerido }]);
    setPedidoDialog("nuevo");
  }

  /* Desde el aviso o las tarjetas: ver la lista filtrada por semáforo. */
  function verProductosPorStock(estado: string) {
    setPestana("productos");
    setFiltroStock(estado);
  }

  return (
    <div>
      {/* Encabezado: título a la izquierda, acciones a la derecha */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Inventario y proveedores</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Cuánto hay de cada producto, quién lo surte y qué viene en camino.
          </p>
          {(tiendanube.conectada || mercadolibre.conectada) && (
            <div className="mt-2.5 flex flex-wrap gap-2">
              {tiendanube.conectada && tiendanube.ultimaSync && (
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  Tienda Nube sincronizada · {fechaCorta(tiendanube.ultimaSync)}
                </span>
              )}
              {mercadolibre.conectada && mercadolibre.ultimaSync && (
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  Mercado Libre sincronizado · {fechaCorta(mercadolibre.ultimaSync)}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          {tiendanube.conectada ? (
            <Button
              variant="outline"
              onClick={sincronizar}
              disabled={sincronizando}
              className="h-auto flex-1 gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:flex-none"
            >
              <RefreshCw className={cn("size-[15px]", sincronizando && "animate-spin")} strokeWidth={1.9} aria-hidden="true" />
              {sincronizando ? "Sincronizando…" : "Sincronizar"}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = "/api/tiendanube/conectar";
              }}
              className="h-auto flex-1 gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:flex-none"
            >
              <Store className="size-[15px]" strokeWidth={1.9} aria-hidden="true" />
              Conectar Tienda Nube
            </Button>
          )}
          {mercadolibre.conectada ? (
            <Button
              variant="outline"
              onClick={sincronizarML}
              disabled={sincronizandoML}
              className="h-auto flex-1 gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:flex-none"
            >
              <RefreshCw className={cn("size-[15px]", sincronizandoML && "animate-spin")} strokeWidth={1.9} aria-hidden="true" />
              {sincronizandoML ? "Sincronizando…" : "Mercado Libre"}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = "/api/mercadolibre/conectar";
              }}
              className="h-auto flex-1 gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:flex-none"
            >
              <ShoppingCart className="size-[15px]" strokeWidth={1.9} aria-hidden="true" />
              Conectar Mercado Libre
            </Button>
          )}
          {ETIQUETA_NUEVO[pestana] && (
            <Button
              onClick={abrirNuevo}
              className="h-auto w-full gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
            >
              <Plus className="size-4" strokeWidth={2.1} />
              {ETIQUETA_NUEVO[pestana]}
            </Button>
          )}
        </div>
      </div>

      {/* Tarjetas KPI */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-3 lg:grid-cols-6">
        <StatCard etiqueta="SKUs" valor={String(productos.length)} icono={Boxes} />
        <button type="button" onClick={() => setPestana("reabastecer")} className="text-left">
          <StatCard
            etiqueta="Por pedir"
            valor={String(porPedir.length)}
            icono={ShoppingCart}
            nota="con la venta de 30 días"
            valorClassName={porPedir.length > 0 ? "text-red-600" : undefined}
            className="h-full transition-colors hover:bg-accent/40"
          />
        </button>
        <StatCard
          etiqueta="Por acabarse"
          valor={String(porAcabarse.length)}
          icono={AlertTriangle}
          valorClassName={porAcabarse.length > 0 ? "text-amber-600" : undefined}
        />
        <StatCard
          etiqueta="Agotados"
          valor={String(agotados.length)}
          icono={PackageX}
          valorClassName={agotados.length > 0 ? "text-red-600" : undefined}
        />
        <StatCard etiqueta="En camino" valor={String(pedidosEnCamino.length)} icono={Truck} />
        <StatCard
          etiqueta="Valor inventario"
          valor={valorCompacto(valorInventario)}
          icono={DollarSign}
          className="hidden md:block"
        />
      </div>

      {/* Barra de herramientas: pestañas a la izquierda, búsqueda/filtro a la derecha */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Móvil: Select (los labels no caben en un segmentado). Escritorio: segmentado. */}
        <Select value={pestana} onValueChange={(v) => v && setPestana(v as Pestana)}>
          <SelectTrigger className="w-full bg-card md:hidden">
            <SelectValue>
              {(v: string) => PESTANAS.find(([id]) => id === v)?.[1] ?? "Sección"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PESTANAS.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="hidden rounded-lg bg-muted p-0.5 md:inline-flex">
          {PESTANAS.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setPestana(id)}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                pestana === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {(pestana === "productos" || pestana === "reabastecer") && (
          <>
            <div className="relative flex min-w-[260px] items-center">
              <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" strokeWidth={1.9} />
              <Input
                placeholder="Buscar producto, SKU o proveedor…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-auto rounded-[10px] bg-card py-2 pl-9"
              />
            </div>
            <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v ?? "todos")}>
              <SelectTrigger className="w-[190px] bg-card">
                <SelectValue>
                  {(v: string) =>
                    v === "todos" ? "Todos los tipos" : (obtenerTipoProducto(v)?.nombre ?? "Tipo")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los tipos</SelectItem>
                {TIPOS_PRODUCTO.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}

        {pestana === "productos" && (
          <>
            <Select value={filtroStock} onValueChange={(v) => setFiltroStock(v ?? "todos")}>
              <SelectTrigger className="w-[165px] bg-card">
                <SelectValue>
                  {(v: string) =>
                    v === "todos" ? "Todo el stock" : (obtenerEstadoStock(v)?.nombre ?? "Stock")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todo el stock</SelectItem>
                {ESTADOS_STOCK.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {mercadolibre.conectada && (
              <Select value={filtroLogistica} onValueChange={(v) => setFiltroLogistica(v ?? "todos")}>
                <SelectTrigger className="w-[175px] bg-card">
                  <SelectValue>
                    {(v: string) => LOGISTICAS.find(([id]) => id === v)?.[1] ?? "Almacén"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {LOGISTICAS.map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}

        {pestana === "movimientos" && (
          <Select value={filtroCanalMov} onValueChange={(v) => setFiltroCanalMov(v ?? "todos")}>
            <SelectTrigger className="w-full bg-card md:w-[190px]">
              <SelectValue>
                {(v: string) => CANALES_MOV.find(([id]) => id === v)?.[1] ?? "Canal"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {CANALES_MOV.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Aviso de reorden: lo que se va a agotar ANTES de que llegue un pedido
          nuevo, según lo que se está vendiendo. Es distinto de «por acabarse»
          (umbral fijo): aquí manda la velocidad de salida. */}
      {porPedir.length > 0 && pestana !== "reabastecer" && (
        <button
          type="button"
          onClick={() => setPestana("reabastecer")}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:hover:bg-red-900/50"
        >
          <ShoppingCart className="size-[18px] shrink-0 text-red-600 dark:text-red-400" strokeWidth={1.9} aria-hidden="true" />
          <span className="flex-1 text-[13.5px] leading-relaxed text-red-800 dark:text-red-300">
            <b className="font-bold">
              {porPedir.length === 1
                ? "1 producto hay que pedirlo ya."
                : `${porPedir.length} productos hay que pedirlos ya.`}
            </b>{" "}
            Con la venta de los últimos 30 días se acaban antes de que llegue un pedido nuevo:{" "}
            {porPedir
              .slice(0, 3)
              .map((g) => g.nombre)
              .join(", ")}
            {porPedir.length > 3 ? "…" : ""}
          </span>
          <span className="shrink-0 text-[12.5px] font-semibold text-red-700 underline-offset-2 hover:underline dark:text-red-300">
            Ver qué pedir
          </span>
        </button>
      )}

      {/* Aviso: SOLO lo que está por acabarse (lo accionable). Lo agotado se
          consulta con el filtro; en la tienda hay cientos y ahogaban el aviso. */}
      {porAcabarse.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
          <AlertTriangle className="size-[18px] shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={1.9} aria-hidden="true" />
          <button
            type="button"
            onClick={() => verProductosPorStock("por_acabarse")}
            className="flex-1 text-left text-[13.5px] leading-relaxed text-amber-800 hover:underline dark:text-amber-300"
          >
            <b className="font-bold text-amber-700 dark:text-amber-300">
              {porAcabarse.length === 1
                ? "1 producto está por acabarse."
                : `${porAcabarse.length} productos están por acabarse.`}
            </b>{" "}
            {porAcabarse
              .slice(0, 3)
              .map((p) => p.nombre)
              .join(", ")}
            {porAcabarse.length > 3 ? "…" : ""}
          </button>
          {agotados.length > 0 && (
            <button
              type="button"
              onClick={() => verProductosPorStock("agotado")}
              className="shrink-0 text-[12.5px] font-semibold text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
            >
              Ver {agotados.length} agotados
            </button>
          )}
          {gestor && (
            <Button
              variant="outline"
              size="sm"
              onClick={generarPedido}
              className="h-auto shrink-0 rounded-[9px] border-amber-200 bg-card px-3 py-1.5 text-[12.5px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300"
            >
              Generar pedido
            </Button>
          )}
        </div>
      )}

      {/* Modo solo lectura: el CRM importa de las plataformas pero no escribe
          nada allá. Se avisa donde se edita el stock, para que nadie espere que
          el ajuste viaje a la tienda. */}
      {!escrituraCanales && (tiendanube.conectada || mercadolibre.conectada) && pestana === "productos" && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border bg-muted/40 px-4 py-3">
          <Lock className="mt-0.5 size-[16px] shrink-0 text-muted-foreground" strokeWidth={1.9} aria-hidden="true" />
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            <b className="font-semibold text-foreground">Modo solo lectura.</b> El CRM importa el inventario de
            Tienda Nube y Mercado Libre, pero no modifica nada allá. Los ajustes de stock, precio y costo que
            hagas aquí se quedan en el CRM.
          </p>
        </div>
      )}

      {pestana === "productos" && (
        <TablaProductos
          productos={productosVisibles}
          busqueda={busqueda}
          filtroTipo={filtroTipo}
          filtroStock={filtroStock}
          escrituraCanales={escrituraCanales}
          onAbrir={(p) => setProductoVistaId(p.id)}
        />
      )}
      {pestana === "reabastecer" && (
        <TablaReabastecer
          productos={productos}
          ventas={ventas}
          enCamino={enCamino}
          params={paramsReorden}
          busqueda={busqueda}
          filtroTipo={filtroTipo}
          onPedir={pedirSugerido}
        />
      )}
      {pestana === "proveedores" && (
        <TablaProveedores
          proveedores={proveedores}
          productos={productos}
          diasEntregaDefault={paramsReorden.diasEntregaDefault}
          onEditar={setProveedorDialog}
        />
      )}
      {pestana === "pedidos" && (
        <TablaPedidosProv pedidos={pedidos} onEditar={setPedidoDialog} />
      )}
      {pestana === "movimientos" && <TablaMovimientos movimientos={movimientosFiltrados} />}

      {pestana === "reconciliacion" && (
        <div className="flex flex-col gap-4">
          {/* Monitor del piloto: solo aparece cuando el CRM tiene el mando de
              algún producto. Va arriba porque es lo que hay que vigilar a diario
              mientras dura la transición. */}
          <PanelPiloto estado={piloto} />
          <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3.5 md:flex-row md:items-center md:justify-between">
            <p className="text-[13.5px] leading-relaxed text-muted-foreground">
              Compara el stock del CRM contra el que tienen <b>en este momento</b> Tienda Nube y
              Mercado Libre, y lista solo lo que no coincide. Es de solo lectura: no corrige nada.
              Para arreglar un descuadre, ajústalo con los botones +/− en Productos.
            </p>
            <Button
              variant="outline"
              onClick={revisar}
              disabled={revisando}
              className="h-auto shrink-0 gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold"
            >
              <RefreshCw className={cn("size-[15px]", revisando && "animate-spin")} strokeWidth={1.9} aria-hidden="true" />
              {revisando ? "Revisando…" : reconciliacion ? "Revisar de nuevo" : "Revisar ahora"}
            </Button>
          </div>

          {revisando && !reconciliacion && (
            <p className="text-sm italic text-muted-foreground">
              Leyendo los catálogos de los canales… puede tardar un poco si hay muchos productos.
            </p>
          )}

          {reconciliacion && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                <span>
                  <b className="text-foreground">{reconciliacion.revisados}</b> productos revisados ·{" "}
                  <b className={cn(reconciliacion.descuadres.length > 0 ? "text-red-600" : "text-green-600")}>
                    {reconciliacion.descuadres.length}
                  </b>{" "}
                  con descuadre
                </span>
                {!reconciliacion.tnConectada && (
                  <span className="rounded-full border px-2 py-0.5 text-xs">Tienda Nube no conectada</span>
                )}
                {!reconciliacion.mlConectada && (
                  <span className="rounded-full border px-2 py-0.5 text-xs">Mercado Libre no conectado</span>
                )}
              </div>
              <FichasDuplicadas
                grupos={reconciliacion.duplicados}
                onFusionado={(clave) =>
                  setReconciliacion((r) =>
                    r ? { ...r, duplicados: r.duplicados.filter((g) => g.clave !== clave) } : r,
                  )
                }
              />
              <TablaDescuadres descuadres={reconciliacion.descuadres} />
            </>
          )}

          {!reconciliacion && !revisando && (
            <p className="text-sm italic text-muted-foreground">
              Pulsa «Revisar ahora» para generar el reporte.
            </p>
          )}
        </div>
      )}

      {productoVista && (
        <ProductoVista
          producto={productoVista}
          grupo={grupoVista}
          ventanaDias={VENTANA_REORDEN}
          escrituraCanales={escrituraCanales}
          onEditar={() => {
            setProductoVistaId(null);
            setProductoDialog(productoVista);
          }}
          onGenerarPedido={() => {
            setProductoVistaId(null);
            setItemsIniciales([{ producto_id: productoVista.id, cantidad: 1 }]);
            setPedidoDialog("nuevo");
          }}
          onClose={() => setProductoVistaId(null)}
        />
      )}
      {productoDialog && (
        <ProductoDialog
          producto={productoDialog === "nuevo" ? null : productoDialog}
          proveedores={proveedores}
          gestor={gestor}
          escrituraCanales={escrituraCanales}
          onClose={() => setProductoDialog(null)}
        />
      )}
      {proveedorDialog && (
        <ProveedorDialog
          proveedor={proveedorDialog === "nuevo" ? null : proveedorDialog}
          diasEntregaDefault={paramsReorden.diasEntregaDefault}
          gestor={gestor}
          onClose={() => setProveedorDialog(null)}
        />
      )}
      {pedidoDialog && (
        <PedidoProvDialog
          pedido={pedidoDialog === "nuevo" ? null : pedidoDialog}
          proveedores={proveedores}
          productos={productos}
          gestor={gestor}
          itemsIniciales={pedidoDialog === "nuevo" ? itemsIniciales : undefined}
          onClose={() => {
            setPedidoDialog(null);
            setItemsIniciales(undefined);
          }}
        />
      )}
    </div>
  );
}
