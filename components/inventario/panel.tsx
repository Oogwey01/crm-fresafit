"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  DollarSign,
  PackageX,
  Plus,
  Search,
  ShoppingCart,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { esGestor } from "@/lib/catalogos";
import { ESTADOS_STOCK, estadoStock, obtenerEstadoStock } from "@/lib/inventario/stock";
import {
  calcularReabastecimiento,
  esDepositoFull,
  tieneFull,
  esTikTokDelegado,
  type EnCamino,
  type GrupoReorden,
  type ParamsReorden,
  type VentaReorden,
} from "@/lib/inventario/reabastecimiento";
import { formatearMXN } from "@/lib/moneda";
import type {
  ProductConProveedor,
  Supplier,
  SupplierOrderConDetalle,
  StockLog,
  RolId,
  ConteoConProducto,
  Profile,
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
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { TIPOS_PRODUCTO, obtenerTipoProducto } from "@/lib/catalogos";
import { TablaProductos } from "@/components/inventario/tabla-productos";
import { ProductoDialog } from "@/components/inventario/producto-dialog";
import { ProductoVista } from "@/components/inventario/producto-vista";
import { TablaProveedores } from "@/components/inventario/tabla-proveedores";
import { ProveedorDialog } from "@/components/inventario/proveedor-dialog";
import { TablaPedidosProv } from "@/components/inventario/tabla-pedidos-prov";
import { PedidoProvDialog } from "@/components/inventario/pedido-prov-dialog";
import { TablaMovimientos } from "@/components/inventario/tabla-movimientos";
import { BarraCanales } from "@/components/inventario/barra-canales";
import { AvisosInventario } from "@/components/inventario/avisos-inventario";
import { PanelReconciliacion } from "@/components/inventario/panel-reconciliacion";
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

/* Filtro de dónde está guardado el stock: Mercado Full y el inventario delegado
   a TikTok son almacenes distintos al de la bodega. */
const LOGISTICAS = [
  ["todos", "Todos los almacenes"],
  ["bodega", "Solo bodega"],
  ["full", "Solo Mercado Full"],
  ["tiktok", "Solo TikTok (delegado)"],
] as const;

/* Filtro de ciclo de vida: por defecto se ocultan los descontinuados para no
   ensuciar el catálogo vigente (siguen consultables eligiendo su opción). */
const VIGENCIAS = [
  ["vigentes", "Vigentes"],
  ["descontinuados", "Descontinuados"],
  ["todos", "Todos"],
] as const;

/* Filtro de canal para el historial de movimientos. */
const CANALES_MOV = [
  ["todos", "Todos los canales"],
  ["crm", "CRM (local)"],
  ["tienda_nube", "Tienda Nube"],
  ["mercado_libre", "Mercado Libre"],
  ["tiktok_shop", "TikTok Shop"],
] as const;

/* Aviso que la page arma en el servidor a partir de los query params del
   redirect de OAuth (?tiendanube=… / ?mercadolibre=… / ?tiktok=…). */
export type AvisoConexion = { tipo: "ok" | "error" | "info"; mensaje: string };

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

/* Búsqueda + los 4 filtros del catálogo, con la lista filtrada y el resumen de
   filtros activos que la tabla usa para explicar por qué salió vacía. */
function useFiltrosProductos(productos: ProductConProveedor[]) {
  /* Búsqueda y filtro de tipo — aplican a "Productos" y a "Qué pedir". */
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  /* Filtro de semáforo de stock (solo aplica a la pestaña de productos). */
  const [filtroStock, setFiltroStock] = useState("todos");
  /* Filtro de almacén: bodega / Mercado Full / TikTok delegado. */
  const [filtroLogistica, setFiltroLogistica] = useState("todos");
  /* Filtro de ciclo de vida: por defecto solo los vigentes. */
  const [filtroVigencia, setFiltroVigencia] = useState("vigentes");

  const productosVisibles = productos.filter((p) => {
    /* «Bodega» deja fuera lo que no está en ella: el depósito que gobierna
       Mercado Full y el inventario delegado a TikTok. Un producto que está en
       los dos sitios (bodega + Full) sale en ambos filtros, que es lo correcto:
       tiene existencias en ambos almacenes. */
    if (filtroLogistica === "bodega" && (esDepositoFull(p) || esTikTokDelegado(p))) return false;
    if (filtroLogistica === "full" && !tieneFull(p)) return false;
    if (filtroLogistica === "tiktok" && !esTikTokDelegado(p)) return false;
    if (filtroVigencia === "vigentes" && p.descontinuado) return false;
    if (filtroVigencia === "descontinuados" && !p.descontinuado) return false;
    return true;
  });

  /* Los filtros se acumulan, así que una combinación inocente («Solo Mercado
     Full» + «Descontinuados») puede no dejar pasar nada. Para que la tabla pueda
     decir POR QUÉ salió vacía, se le pasan los que están puestos con su nombre
     legible. «Vigentes» cuenta como filtro activo aunque sea el default: es el
     que esconde los descontinuados, y no saberlo es justo la trampa. */
  const filtrosActivos = [
    busqueda.trim() && `Búsqueda: «${busqueda.trim()}»`,
    filtroTipo !== "todos" && `Tipo: ${obtenerTipoProducto(filtroTipo)?.nombre ?? filtroTipo}`,
    filtroStock !== "todos" && `Stock: ${obtenerEstadoStock(filtroStock)?.nombre ?? filtroStock}`,
    filtroLogistica !== "todos" &&
      `Almacén: ${LOGISTICAS.find(([id]) => id === filtroLogistica)?.[1] ?? filtroLogistica}`,
    filtroVigencia !== "todos" &&
      `Vigencia: ${VIGENCIAS.find(([id]) => id === filtroVigencia)?.[1] ?? filtroVigencia}`,
  ].filter(Boolean) as string[];

  /* Deja ver TODO el catálogo: incluye la vigencia, que si no seguiría
     escondiendo los descontinuados después de «limpiar». */
  function limpiarFiltros() {
    setBusqueda("");
    setFiltroTipo("todos");
    setFiltroStock("todos");
    setFiltroLogistica("todos");
    setFiltroVigencia("todos");
  }

  return {
    busqueda,
    setBusqueda,
    filtroTipo,
    setFiltroTipo,
    filtroStock,
    setFiltroStock,
    filtroLogistica,
    setFiltroLogistica,
    filtroVigencia,
    setFiltroVigencia,
    productosVisibles,
    filtrosActivos,
    limpiarFiltros,
  };
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
  tiktok,
  escrituraCanales,
  piloto,
  conteos,
  equipo,
  reconciliacionInicial,
  avisosConexion,
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
  tiktok: { conectada: boolean; ultimaSync: string | null };
  /* false (el default del sistema) = el CRM no modifica nada en las plataformas. */
  escrituraCanales: boolean;
  /* Estado del piloto de escritura: qué productos manda el CRM y cómo van. */
  piloto: EstadoPiloto;
  /* Conteos físicos recientes (con su producto). */
  conteos: ConteoConProducto[];
  /* Equipo, para los selectores de "quién contó/corroboró". */
  equipo: Profile[];
  /* Última reconciliación guardada, para mostrarla al instante al entrar. */
  reconciliacionInicial: { resumen: ResumenReconciliacion; creadoEn: string } | null;
  /* Avisos al volver del OAuth, ya resueltos en el servidor por la page. */
  avisosConexion: AvisoConexion[];
}) {
  const gestor = esGestor(rol);
  /* Conectar/sincronizar canales queda solo para dirección: es una acción de
     mantenimiento y da miedo que alguien la pique por error. */
  const esDireccion = rol === "direccion";
  const [pestana, setPestana] = useState<Pestana>("productos");

  /* Avisos al volver del OAuth: la page los arma en el servidor; aquí solo se
     emiten una vez y se limpia la URL para que un refresh no los repita. */
  const avisosEmitidos = useRef(false);
  useEffect(() => {
    if (avisosEmitidos.current || avisosConexion.length === 0) return;
    avisosEmitidos.current = true;
    for (const aviso of avisosConexion) {
      if (aviso.tipo === "ok") toast.success(aviso.mensaje);
      else if (aviso.tipo === "error") toast.error(aviso.mensaje);
      else toast.info(aviso.mensaje);
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, [avisosConexion]);

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

  const {
    busqueda,
    setBusqueda,
    filtroTipo,
    setFiltroTipo,
    filtroStock,
    setFiltroStock,
    filtroLogistica,
    setFiltroLogistica,
    filtroVigencia,
    setFiltroVigencia,
    productosVisibles,
    filtrosActivos,
    limpiarFiltros,
  } = useFiltrosProductos(productos);

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
          {(tiendanube.conectada || mercadolibre.conectada || tiktok.conectada) && (
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
              {tiktok.conectada && tiktok.ultimaSync && (
                <span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground">
                  <span className="size-1.5 rounded-full bg-green-500" />
                  TikTok Shop sincronizado · {fechaCorta(tiktok.ultimaSync)}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          {/* Conectar/sincronizar canales: solo dirección, para que nadie más lo
              pique por error. La sync automática por cron sigue corriendo igual. */}
          {esDireccion && (
            <BarraCanales tiendanube={tiendanube} mercadolibre={mercadolibre} tiktok={tiktok} />
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
        <ControlSegmentado
          opciones={PESTANAS}
          valor={pestana}
          onCambio={setPestana}
          className="hidden md:inline-flex"
        />

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
            {(mercadolibre.conectada || tiktok.conectada) && (
              <Select value={filtroLogistica} onValueChange={(v) => setFiltroLogistica(v ?? "todos")}>
                <SelectTrigger className="w-[185px] bg-card">
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
            <Select value={filtroVigencia} onValueChange={(v) => setFiltroVigencia(v ?? "vigentes")}>
              <SelectTrigger className="w-[155px] bg-card">
                <SelectValue>
                  {(v: string) => VIGENCIAS.find(([id]) => id === v)?.[1] ?? "Vigencia"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {VIGENCIAS.map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      <AvisosInventario
        porPedir={porPedir}
        porAcabarse={porAcabarse}
        agotados={agotados}
        escrituraCanales={escrituraCanales}
        gestor={gestor}
        pestana={pestana}
        algunCanalConectado={tiendanube.conectada || mercadolibre.conectada || tiktok.conectada}
        onVerQuePedir={() => setPestana("reabastecer")}
        onVerPorStock={verProductosPorStock}
        onGenerarPedido={generarPedido}
      />

      {pestana === "productos" && (
        <TablaProductos
          productos={productosVisibles}
          totalCatalogo={productos.length}
          busqueda={busqueda}
          filtroTipo={filtroTipo}
          filtroStock={filtroStock}
          filtrosActivos={filtrosActivos}
          onLimpiarFiltros={limpiarFiltros}
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
        <PanelReconciliacion
          piloto={piloto}
          conteos={conteos}
          productos={productos}
          equipo={equipo}
          reconciliacionInicial={reconciliacionInicial}
        />
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
          diasEntregaDefault={paramsReorden.diasEntregaDefault}
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
