"use client";

import { useEffect, useState, useTransition } from "react";
import { AlertTriangle, RefreshCw, ShoppingCart, Store } from "lucide-react";
import { toast } from "sonner";
import { esGestor } from "@/lib/catalogos";
import { sincronizarMercadolibre, sincronizarTiendanube } from "@/app/(app)/inventario/actions";
import type {
  ProductConProveedor,
  Supplier,
  SupplierOrderConDetalle,
  RolId,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
  productos: "+ Nuevo producto",
  proveedores: "+ Nuevo proveedor",
  pedidos: "+ Nuevo pedido",
};

function fechaCorta(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
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

  const bajos = productos.filter((p) => p.activo && p.stock <= p.stock_minimo);

  function abrirNuevo() {
    if (pestana === "productos") setProductoDialog("nuevo");
    else if (pestana === "proveedores") setProveedorDialog("nuevo");
    else setPedidoDialog("nuevo");
  }

  return (
    <div>
      {/* Barra superior */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Inventario y proveedores</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cuánto hay de cada producto, quién lo surte y qué viene en camino.
            {tiendanube.conectada && tiendanube.ultimaSync && (
              <span className="ml-1">· Tienda Nube: {fechaCorta(tiendanube.ultimaSync)}.</span>
            )}
            {mercadolibre.conectada && mercadolibre.ultimaSync && (
              <span className="ml-1">· Mercado Libre: {fechaCorta(mercadolibre.ultimaSync)}.</span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tiendanube.conectada ? (
            <Button variant="outline" onClick={sincronizar} disabled={sincronizando}>
              <RefreshCw className={cn("size-4", sincronizando && "animate-spin")} aria-hidden="true" />
              {sincronizando ? "Sincronizando…" : "Sincronizar Tienda Nube"}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = "/api/tiendanube/conectar";
              }}
            >
              <Store className="size-4" aria-hidden="true" />
              Conectar Tienda Nube
            </Button>
          )}
          {mercadolibre.conectada ? (
            <Button variant="outline" onClick={sincronizarML} disabled={sincronizandoML}>
              <RefreshCw className={cn("size-4", sincronizandoML && "animate-spin")} aria-hidden="true" />
              {sincronizandoML ? "Sincronizando…" : "Sincronizar Mercado Libre"}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => {
                window.location.href = "/api/mercadolibre/conectar";
              }}
            >
              <ShoppingCart className="size-4" aria-hidden="true" />
              Conectar Mercado Libre
            </Button>
          )}
          <div className="inline-flex rounded-lg bg-muted p-0.5">
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
          <Button onClick={abrirNuevo}>{ETIQUETA_NUEVO[pestana]}</Button>
        </div>
      </div>

      {/* Aviso de stock bajo — visible al abrir el módulo, en cualquier pestaña. */}
      {bajos.length > 0 && (
        <button
          type="button"
          onClick={() => setPestana("productos")}
          className="mb-4 flex w-full items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm font-semibold text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          {bajos.length === 1
            ? `1 producto con stock bajo: ${bajos[0].nombre}`
            : `${bajos.length} productos con stock bajo: ${bajos
                .slice(0, 3)
                .map((p) => p.nombre)
                .join(", ")}${bajos.length > 3 ? "…" : ""}`}
        </button>
      )}

      {pestana === "productos" && (
        <TablaProductos productos={productos} onEditar={setProductoDialog} />
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
