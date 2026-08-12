"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CircleDollarSign, Factory, Package, Plus, Truck } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/compartido/stat-card";
import { TabsSeccion } from "@/components/compartido/tabs-seccion";
import { TablaProveedores } from "@/components/proveedores/tabla-proveedores";
import { ProveedorDialog } from "@/components/proveedores/proveedor-dialog";
import { TablaPedidosProv } from "@/components/proveedores/tabla-pedidos-prov";
import { PedidoProvDialog, type ItemInicialPedido } from "@/components/proveedores/pedido-prov-dialog";
import { ImportarRenglonesPedido } from "@/components/proveedores/importar-renglones-pedido";
import { ImportarFactura } from "@/components/proveedores/importar-factura";
import { TablaReabastecer } from "@/components/proveedores/tabla-reabastecer";
import type { ProductoProveedor, ProductoReordenProv } from "@/lib/proveedores/tipos";
import type {
  EnCamino,
  GrupoReorden,
  ParamsReorden,
  VentaReorden,
} from "@/lib/inventario/reabastecimiento";
import { formatearMXN } from "@/lib/moneda";
import type { Supplier, SupplierOrderConDetalle } from "@/lib/types";

/* «Qué pedir» va primero: es la pregunta que abre el flujo del módulo —qué le
   compro a quién— y de ella cuelga armar el pedido. Vivía en Inventario, que es
   la pantalla de «cuánto tengo» y la ve todo el equipo; aquí, además, es solo de
   dirección sin necesidad de un candado aparte. */
const PESTANAS = [
  ["reabastecer", "Qué pedir"],
  ["proveedores", "Proveedores"],
  ["pedidos", "Pedidos a proveedor"],
] as const;

type Pestana = (typeof PESTANAS)[number][0];

/* Un pedido en estos estados todavía no llegó. */
const EN_CAMINO = ["pedido", "en_transito", "en_aduana"];

export function PanelProveedores({
  proveedores,
  pedidos,
  productos,
  productosReorden,
  ventas,
  enCamino,
  paramsReorden,
  /* Días de entrega global (viene de env, se resuelve en el servidor). */
  diasEntregaDefault,
}: {
  proveedores: Supplier[];
  pedidos: SupplierOrderConDetalle[];
  productos: ProductoProveedor[];
  /* El mismo catálogo con su proveedor resuelto: lo que come «Qué pedir». */
  productosReorden: ProductoReordenProv[];
  /* Ventas de los últimos 90 días: la velocidad de salida de cada producto. */
  ventas: VentaReorden[];
  /* Unidades pedidas a proveedor que aún no llegan, por producto. */
  enCamino: EnCamino;
  paramsReorden: ParamsReorden;
  diasEntregaDefault: number;
}) {
  /* Desde el aviso de stock bajo de Inventario se llega con ?producto=…&cantidad=…
     y se abre el alta con ese renglón ya puesto. Dentro del módulo ya no hace
     falta la URL —«Pedir» abre el diálogo directo—, pero el enlace de fuera
     sigue funcionando.

     Se resuelve en el valor INICIAL de cada estado y no en un efecto: abrir el
     diálogo desde un efecto obliga a pintar la pantalla dos veces —y el
     compilador de React lo marca como error—. */
  const params = useSearchParams();
  const producto = params.get("producto");
  const cantidad = params.get("cantidad");

  const [pestana, setPestana] = useState<Pestana>(producto ? "pedidos" : "reabastecer");
  const [proveedorDialog, setProveedorDialog] = useState<Supplier | "nuevo" | null>(null);
  const [pedidoDialog, setPedidoDialog] = useState<SupplierOrderConDetalle | "nuevo" | null>(
    producto ? "nuevo" : null,
  );
  /* Renglones y notas con los que abre un pedido nuevo (vienen de «Qué pedir»
     en Inventario, o de leer la factura del proveedor). */
  const [itemsIniciales, setItemsIniciales] = useState<ItemInicialPedido[] | undefined>(
    producto ? [{ producto_id: producto, cantidad: Math.max(1, Number(cantidad) || 1) }] : undefined,
  );
  const [notasIniciales, setNotasIniciales] = useState<string | undefined>(undefined);

  /* La URL se limpia para que un refresh no vuelva a abrir el mismo alta. Toca
     el historial del navegador, no el estado de React: aquí sí va un efecto. */
  useEffect(() => {
    if (producto) window.history.replaceState(null, "", window.location.pathname);
  }, [producto]);

  /* PEDIDOS en camino, que es distinto de las UNIDADES en camino que llegan por
     prop para el reorden: aquello cuenta piezas por producto, esto cuenta
     pedidos completos. */
  const pedidosEnCamino = pedidos.filter((p) => EN_CAMINO.includes(p.estado));
  const abiertos = pedidos.filter((p) => p.estado !== "recibido" && p.estado !== "cancelado");
  /* Lo comprometido con proveedores y todavía no recibido. */
  const comprometido = abiertos.reduce(
    (acc, p) => acc + p.items.reduce((a, i) => a + i.cantidad * (i.costo_unitario ?? 0), 0),
    0,
  );

  function abrirNuevo() {
    if (pestana === "proveedores") setProveedorDialog("nuevo");
    else {
      setItemsIniciales(undefined);
      setNotasIniciales(undefined);
      setPedidoDialog("nuevo");
    }
  }

  /* «Pedir» en la tabla de reorden: abre el alta de pedido con el renglón y la
     cantidad sugeridos. Ya no pasa por la URL como cuando «Qué pedir» vivía en
     Inventario —es la misma pantalla—, así que tampoco se recarga nada. */
  function pedirGrupo(grupo: GrupoReorden) {
    setItemsIniciales([{ producto_id: grupo.productoId, cantidad: grupo.sugerido }]);
    setNotasIniciales(undefined);
    setPestana("pedidos");
    setPedidoDialog("nuevo");
  }

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Proveedores</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            A quién le compramos, qué le pedimos y qué falta por pagar o por llegar.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          <Link
            href="/inventario"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold",
            )}
          >
            <Package className="size-4" strokeWidth={2} />
            Inventario
          </Link>
          {pestana === "pedidos" && (
            /* Las dos importaciones parten de un archivo de Excel y no se hacen
               desde el teléfono; ahí solo engordaban la cabecera con dos botones
               más antes de la lista. `md:contents` las devuelve a la fila de
               acciones en escritorio, sin caja intermedia. */
            <div className="hidden md:contents">
              {/* La factura del proveedor llega en dólares y hoy se recaptura a
                  mano: leerla evita ese trabajo (se revisa antes de guardar). */}
              <ImportarFactura
                productos={productos}
                onListo={(items, contexto) => {
                  setItemsIniciales(items);
                  setNotasIniciales(
                    [contexto.proveedor, contexto.notas].filter(Boolean).join(" · ") || undefined,
                  );
                  setPedidoDialog("nuevo");
                }}
              />
              {/* Los pedidos se arman en Excel («Pedido FF», «Pedido Cintos»):
                  pegarlos evita recapturar renglón por renglón. */}
              <ImportarRenglonesPedido
                productos={productos}
                onListo={(items) => {
                  setItemsIniciales(items);
                  setNotasIniciales(undefined);
                  setPedidoDialog("nuevo");
                }}
              />
            </div>
          )}
          {/* En «Qué pedir» no se pinta: ahí lo que se hace es pedir UN renglón
              concreto con su cantidad ya calculada, y para eso está el botón de
              cada fila. Un «Nuevo pedido» vacío al lado solo compite con él. */}
          {pestana !== "reabastecer" && (
            <Button
              onClick={abrirNuevo}
              className="h-auto w-full gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
            >
              <Plus className="size-4" strokeWidth={2.1} />
              {pestana === "proveedores" ? "Nuevo proveedor" : "Nuevo pedido"}
            </Button>
          )}
        </div>
      </div>

      <TabsSeccion opciones={PESTANAS} valor={pestana} onCambio={setPestana} className="mb-4" />

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard etiqueta="Proveedores" valor={String(proveedores.length)} icono={Factory} />
        <StatCard etiqueta="Pedidos abiertos" valor={String(abiertos.length)} icono={Package} />
        <StatCard
          etiqueta="En camino"
          valor={String(pedidosEnCamino.length)}
          icono={Truck}
          nota="pedido, en tránsito o en aduana"
          notaClassName="hidden md:block"
        />
        <StatCard
          etiqueta="Comprometido"
          valor={formatearMXN(comprometido)}
          icono={CircleDollarSign}
          nota="pedido y no recibido"
          notaClassName="hidden md:block"
        />
      </div>

      {pestana === "reabastecer" && (
        <TablaReabastecer
          productos={productosReorden}
          ventas={ventas}
          enCamino={enCamino}
          params={paramsReorden}
          onPedir={pedirGrupo}
        />
      )}
      {pestana === "proveedores" && (
        <TablaProveedores
          proveedores={proveedores}
          productos={productos}
          diasEntregaDefault={diasEntregaDefault}
          onEditar={setProveedorDialog}
        />
      )}
      {pestana === "pedidos" && <TablaPedidosProv pedidos={pedidos} onEditar={setPedidoDialog} />}

      {proveedorDialog && (
        <ProveedorDialog
          proveedor={proveedorDialog === "nuevo" ? null : proveedorDialog}
          diasEntregaDefault={diasEntregaDefault}
          gestor
          onClose={() => setProveedorDialog(null)}
        />
      )}
      {pedidoDialog && (
        <PedidoProvDialog
          pedido={pedidoDialog === "nuevo" ? null : pedidoDialog}
          proveedores={proveedores}
          productos={productos}
          gestor
          diasEntregaDefault={diasEntregaDefault}
          itemsIniciales={pedidoDialog === "nuevo" ? itemsIniciales : undefined}
          notasIniciales={pedidoDialog === "nuevo" ? notasIniciales : undefined}
          onClose={() => {
            setPedidoDialog(null);
            setItemsIniciales(undefined);
            setNotasIniciales(undefined);
          }}
        />
      )}
    </div>
  );
}
