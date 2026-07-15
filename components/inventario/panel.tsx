"use client";

import { useEffect, useState, useTransition } from "react";
import {
  AlertTriangle,
  Boxes,
  DollarSign,
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
import { formatearMXN } from "@/lib/moneda";
import { sincronizarMercadolibre, sincronizarTiendanube } from "@/app/(app)/inventario/actions";
import type {
  ProductConProveedor,
  Supplier,
  SupplierOrderConDetalle,
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
import { TablaProveedores } from "@/components/inventario/tabla-proveedores";
import { ProveedorDialog } from "@/components/inventario/proveedor-dialog";
import { TablaPedidosProv } from "@/components/inventario/tabla-pedidos-prov";
import { PedidoProvDialog } from "@/components/inventario/pedido-prov-dialog";

type Pestana = "productos" | "proveedores" | "pedidos";

const PESTANAS = [
  ["productos", "Productos"],
  ["proveedores", "Proveedores"],
  ["pedidos", "Pedidos a proveedor"],
] as const;

const ETIQUETA_NUEVO: Record<Pestana, string> = {
  productos: "Nuevo producto",
  proveedores: "Nuevo proveedor",
  pedidos: "Nuevo pedido",
};

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
  rol,
  tiendanube,
  mercadolibre,
}: {
  productos: ProductConProveedor[];
  proveedores: Supplier[];
  pedidos: SupplierOrderConDetalle[];
  rol: RolId;
  tiendanube: { conectada: boolean; ultimaSync: string | null };
  mercadolibre: { conectada: boolean; ultimaSync: string | null };
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
  const [proveedorDialog, setProveedorDialog] = useState<Supplier | "nuevo" | null>(null);
  const [pedidoDialog, setPedidoDialog] = useState<SupplierOrderConDetalle | "nuevo" | null>(null);

  /* Búsqueda y filtro de tipo — viven aquí para poder pintarlos junto a las
     pestañas (solo aplican a "Productos"). */
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");

  /* Filtro de semáforo de stock (solo aplica a la pestaña de productos). */
  const [filtroStock, setFiltroStock] = useState("todos");

  /* Agotado (ya no hay) y por acabarse (queda poco: lo accionable) son cosas
     distintas; juntarlos ahogaba el aviso con cientos de variantes agotadas. */
  const agotados = productos.filter((p) => estadoStock(p) === "agotado");
  const porAcabarse = productos.filter((p) => estadoStock(p) === "por_acabarse");
  const enCamino = pedidos.filter((p) => p.estado !== "recibido" && p.estado !== "cancelado");
  const valorInventario = productos.reduce((acc, p) => acc + p.stock * (p.costo ?? 0), 0);

  function abrirNuevo() {
    if (pestana === "productos") setProductoDialog("nuevo");
    else if (pestana === "proveedores") setProveedorDialog("nuevo");
    else setPedidoDialog("nuevo");
  }

  /* Desde el aviso de stock bajo: llevar a Pedidos y abrir uno nuevo. */
  function generarPedido() {
    setPestana("pedidos");
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
          <Button
            onClick={abrirNuevo}
            className="h-auto w-full gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.1} />
            {ETIQUETA_NUEVO[pestana]}
          </Button>
        </div>
      </div>

      {/* Tarjetas KPI */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-3 lg:grid-cols-5">
        <StatCard etiqueta="SKUs" valor={String(productos.length)} icono={Boxes} />
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
        <StatCard etiqueta="En camino" valor={String(enCamino.length)} icono={Truck} />
        <StatCard etiqueta="Valor inventario" valor={valorCompacto(valorInventario)} icono={DollarSign} />
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

        {pestana === "productos" && (
          <>
            <div className="relative flex min-w-[260px] items-center">
              <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" strokeWidth={1.9} />
              <Input
                placeholder="Buscar producto, variante o proveedor…"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                className="h-auto rounded-[10px] bg-card py-2 pl-9"
              />
            </div>
            <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v ?? "todos")}>
              <SelectTrigger className="w-[170px] bg-card">
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
          </>
        )}
      </div>

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

      {pestana === "productos" && (
        <TablaProductos
          productos={productos}
          busqueda={busqueda}
          filtroTipo={filtroTipo}
          filtroStock={filtroStock}
          onEditar={setProductoDialog}
        />
      )}
      {pestana === "proveedores" && (
        <TablaProveedores
          proveedores={proveedores}
          productos={productos}
          onEditar={setProveedorDialog}
        />
      )}
      {pestana === "pedidos" && (
        <TablaPedidosProv pedidos={pedidos} onEditar={setPedidoDialog} />
      )}

      {productoDialog && (
        <ProductoDialog
          producto={productoDialog === "nuevo" ? null : productoDialog}
          proveedores={proveedores}
          gestor={gestor}
          onClose={() => setProductoDialog(null)}
        />
      )}
      {proveedorDialog && (
        <ProveedorDialog
          proveedor={proveedorDialog === "nuevo" ? null : proveedorDialog}
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
          onClose={() => setPedidoDialog(null)}
        />
      )}
    </div>
  );
}
