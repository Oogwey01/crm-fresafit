"use client";

import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { esGestor } from "@/lib/catalogos";
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

export function PanelInventario({
  productos,
  proveedores,
  pedidos,
  rol,
}: {
  productos: ProductConProveedor[];
  proveedores: Supplier[];
  pedidos: SupplierOrderConDetalle[];
  rol: RolId;
}) {
  const gestor = esGestor(rol);
  const [pestana, setPestana] = useState<Pestana>("productos");

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
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
