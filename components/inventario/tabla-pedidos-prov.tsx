"use client";

import { useState, useTransition } from "react";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { ESTADOS_PEDIDO_PROVEEDOR, obtenerEstadoPedidoProv } from "@/lib/catalogos";
import { formatearFecha, hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import {
  cambiarEstadoPedidoProv,
  recibirPedidoProv,
} from "@/app/(app)/inventario/actions";
import type { EstadoPedidoProvId, SupplierOrderConDetalle } from "@/lib/types";
import { TablaSimple, filaSimpleClases } from "@/components/compartido/tabla-simple";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[140px_minmax(180px,1fr)_110px_120px_130px_110px]";

function PastillaEstadoProv({ estado }: { estado: string }) {
  const e = obtenerEstadoPedidoProv(estado);
  if (!e) return null;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-white"
      style={{ backgroundColor: e.color }}
    >
      {e.nombre}
    </span>
  );
}

/* Resumen de los renglones: "10× Cinturón Rosa, 5× straps…" */
function resumenItems(pedido: SupplierOrderConDetalle): string {
  return pedido.items
    .map((i) => `${i.cantidad}× ${i.producto ? i.producto.nombre : (i.descripcion ?? "?")}`)
    .join(", ");
}

export function TablaPedidosProv({
  pedidos,
  onEditar,
}: {
  pedidos: SupplierOrderConDetalle[];
  onEditar: (p: SupplierOrderConDetalle) => void;
}) {
  const [, startTransition] = useTransition();
  /* Pedido en proceso de "marcar recibido" (abre la pregunta del stock). */
  const [recibir, setRecibir] = useState<SupplierOrderConDetalle | null>(null);
  const [pendingRecibir, setPendingRecibir] = useState(false);

  function cambiarEstado(p: SupplierOrderConDetalle, estado: EstadoPedidoProvId) {
    if (estado === p.estado) return;
    /* "Recibido" pasa por la pregunta de sumar stock (si hay renglones con producto). */
    if (estado === "recibido" && p.items.some((i) => i.producto_id)) {
      setRecibir(p);
      return;
    }
    startTransition(async () => {
      try {
        const r = await cambiarEstadoPedidoProv(p.id, estado);
        if ("error" in r) toast.error(r.error);
      } catch {
        toast.error("No se pudo actualizar el pedido. Revisa tu conexión.");
      }
    });
  }

  async function confirmarRecibir(sumarStock: boolean) {
    if (!recibir) return;
    setPendingRecibir(true);
    try {
      const r = await recibirPedidoProv(recibir.id, sumarStock);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success(sumarStock ? "Pedido recibido y stock actualizado." : "Pedido marcado como recibido.");
      setRecibir(null);
    } catch {
      toast.error("No se pudo recibir el pedido. Revisa tu conexión.");
    } finally {
      setPendingRecibir(false);
    }
  }

  if (pedidos.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Aún no hay pedidos a proveedor. Registra el primero con «+ Nuevo pedido».
      </p>
    );
  }

  return (
    <>
      <TablaSimple
        cols={COLS}
        encabezados={["Proveedor", "Productos", "Pedido", "Llega", "Estado", "Total"]}
        minW="min-w-[840px]"
      >
        {pedidos.map((p) => {
          const abierto = p.estado !== "recibido" && p.estado !== "cancelado";
          const atrasado = abierto && !!p.fecha_estimada && p.fecha_estimada < hoyISO();
          return (
            <div key={p.id} className={filaSimpleClases(COLS)}>
              <button
                type="button"
                onClick={() => onEditar(p)}
                className="truncate text-left font-medium hover:underline"
                title={`Pedido a ${p.proveedor?.nombre ?? "proveedor"}`}
              >
                {p.proveedor?.nombre ?? "—"}
              </button>

              <div className="truncate text-muted-foreground" title={resumenItems(p)}>
                {resumenItems(p) || "—"}
              </div>

              <div>{formatearFecha(p.fecha_pedido)}</div>

              <div>
                {p.fecha_estimada ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-1",
                      atrasado && "font-semibold text-red-600",
                    )}
                  >
                    {atrasado && <AlertTriangle className="size-3.5" aria-label="Atrasado" />}
                    {formatearFecha(p.fecha_estimada)}
                  </span>
                ) : (
                  <span className="text-muted-foreground/50">—</span>
                )}
              </div>

              {/* Estado editable en celda */}
              <div>
                <Select
                  value={p.estado}
                  onValueChange={(v) => v && cambiarEstado(p, v as EstadoPedidoProvId)}
                >
                  <SelectTrigger className="h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0">
                    <PastillaEstadoProv estado={p.estado} />
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS_PEDIDO_PROVEEDOR.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>{formatearMXN(p.costo_total)}</div>
            </div>
          );
        })}
      </TablaSimple>

      {/* Pregunta al recibir: ¿sumar los renglones al stock? */}
      {recibir && (
        <Dialog open onOpenChange={(v) => !v && !pendingRecibir && setRecibir(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Recibir pedido de {recibir.proveedor?.nombre}</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              ¿Sumar las cantidades al stock de los productos? ({resumenItems(recibir)})
            </p>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setRecibir(null)} disabled={pendingRecibir}>
                Cancelar
              </Button>
              <Button variant="outline" onClick={() => confirmarRecibir(false)} disabled={pendingRecibir}>
                Solo marcar recibido
              </Button>
              <Button onClick={() => confirmarRecibir(true)} disabled={pendingRecibir}>
                {pendingRecibir ? "Guardando…" : "Sumar al stock"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
