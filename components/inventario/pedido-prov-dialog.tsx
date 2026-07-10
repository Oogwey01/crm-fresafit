"use client";

import { useState, useTransition } from "react";
import { X } from "lucide-react";
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
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ESTADOS_PEDIDO_PROVEEDOR } from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import {
  guardarPedidoProv,
  borrarPedidoProv,
  type PedidoProvInput,
} from "@/app/(app)/inventario/actions";
import type {
  EstadoPedidoProvId,
  ProductConProveedor,
  Supplier,
  SupplierOrderConDetalle,
} from "@/lib/types";

const PRODUCTO_LIBRE = "libre";

/* Renglón editable del pedido (estado local del formulario). */
type Renglon = {
  producto_id: string | null; // null = descripción libre
  descripcion: string;
  cantidad: string;
  costo_unitario: string;
};

function renglonVacio(): Renglon {
  return { producto_id: null, descripcion: "", cantidad: "1", costo_unitario: "" };
}

function aNumero(texto: string): number | null {
  if (texto.trim() === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/* Alta y edición de un pedido a proveedor, con sus renglones. */
export function PedidoProvDialog({
  pedido,
  proveedores,
  productos,
  gestor,
  onClose,
}: {
  pedido: SupplierOrderConDetalle | null; // null = alta
  proveedores: Supplier[];
  productos: ProductConProveedor[];
  gestor: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [proveedorId, setProveedorId] = useState(pedido?.proveedor_id ?? "");
  const [fechaPedido, setFechaPedido] = useState(pedido?.fecha_pedido ?? hoyISO());
  const [fechaEstimada, setFechaEstimada] = useState(pedido?.fecha_estimada ?? "");
  const [estado, setEstado] = useState<EstadoPedidoProvId>(pedido?.estado ?? "pedido");
  const [notas, setNotas] = useState(pedido?.notas ?? "");
  const [renglones, setRenglones] = useState<Renglon[]>(
    pedido && pedido.items.length > 0
      ? pedido.items.map((i) => ({
          producto_id: i.producto_id,
          descripcion: i.descripcion ?? "",
          cantidad: String(i.cantidad),
          costo_unitario: i.costo_unitario?.toString() ?? "",
        }))
      : [renglonVacio()],
  );
  /* Total: se sugiere la suma de renglones, pero se puede escribir a mano. */
  const [totalManual, setTotalManual] = useState(pedido?.costo_total?.toString() ?? "");

  const sumaRenglones = renglones.reduce((acc, r) => {
    const cant = Number(r.cantidad) || 0;
    const costo = Number(r.costo_unitario) || 0;
    return acc + cant * costo;
  }, 0);
  const total = totalManual.trim() !== "" ? aNumero(totalManual) : sumaRenglones > 0 ? sumaRenglones : null;

  function editarRenglon(idx: number, cambio: Partial<Renglon>) {
    setRenglones((prev) => prev.map((r, i) => (i === idx ? { ...r, ...cambio } : r)));
  }

  function guardar() {
    const input: PedidoProvInput = {
      proveedor_id: proveedorId,
      fecha_pedido: fechaPedido,
      fecha_estimada: fechaEstimada || null,
      estado,
      costo_total: total,
      notas,
      items: renglones.map((r) => ({
        producto_id: r.producto_id,
        descripcion: r.descripcion,
        cantidad: Math.trunc(Number(r.cantidad) || 0),
        costo_unitario: aNumero(r.costo_unitario),
      })),
    };
    startTransition(async () => {
      try {
        const r = await guardarPedidoProv(pedido?.id ?? null, input);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success(pedido ? "Pedido actualizado." : "Pedido registrado.");
        onClose();
      } catch {
        toast.error("No se pudo guardar. Revisa tu conexión.");
      }
    });
  }

  function borrar() {
    if (!pedido) return;
    if (!window.confirm("¿Borrar este pedido a proveedor? Esto no se puede deshacer.")) return;
    startTransition(async () => {
      try {
        const r = await borrarPedidoProv(pedido.id);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success("Pedido borrado.");
        onClose();
      } catch {
        toast.error("No se pudo borrar. Revisa tu conexión.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{pedido ? "Editar pedido a proveedor" : "Nuevo pedido a proveedor"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
              <Label>Proveedor</Label>
              <Select value={proveedorId || undefined} onValueChange={(v) => v && setProveedorId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Elegir…">
                    {(v: string) => proveedores.find((p) => p.id === v)?.nombre ?? "Elegir…"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {proveedores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ped-fecha">Fecha del pedido</Label>
              <Input
                id="ped-fecha"
                type="date"
                value={fechaPedido}
                onChange={(e) => setFechaPedido(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ped-eta">Llega (aprox.)</Label>
              <Input
                id="ped-eta"
                type="date"
                value={fechaEstimada}
                onChange={(e) => setFechaEstimada(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Estado</Label>
              <Select value={estado} onValueChange={(v) => v && setEstado(v as EstadoPedidoProvId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => ESTADOS_PEDIDO_PROVEEDOR.find((e) => e.id === v)?.nombre ?? "Estado"}
                  </SelectValue>
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
          </div>

          {/* Renglones del pedido */}
          <div className="flex flex-col gap-1.5">
            <Label>Qué se pidió</Label>
            <div className="flex flex-col gap-2">
              {renglones.map((r, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_80px_110px_32px] items-center gap-2">
                  {/* Producto del catálogo o descripción libre */}
                  <div className="flex items-center gap-2">
                    <Select
                      value={r.producto_id ?? PRODUCTO_LIBRE}
                      onValueChange={(v) =>
                        editarRenglon(idx, { producto_id: !v || v === PRODUCTO_LIBRE ? null : v })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue>
                          {(v: string) => {
                            if (v === PRODUCTO_LIBRE) return "Otro (describir)";
                            const p = productos.find((x) => x.id === v);
                            return p ? `${p.nombre}${p.variante ? ` · ${p.variante}` : ""}` : "Producto";
                          }}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={PRODUCTO_LIBRE}>Otro (describir)</SelectItem>
                        {productos
                          .filter((p) => p.activo)
                          .map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.nombre}
                              {p.variante ? ` · ${p.variante}` : ""}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    {r.producto_id === null && (
                      <Input
                        placeholder="Descripción"
                        value={r.descripcion}
                        onChange={(e) => editarRenglon(idx, { descripcion: e.target.value })}
                      />
                    )}
                  </div>
                  <Input
                    type="number"
                    min="1"
                    step="1"
                    aria-label="Cantidad"
                    title="Cantidad"
                    value={r.cantidad}
                    onChange={(e) => editarRenglon(idx, { cantidad: e.target.value })}
                  />
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="$ c/u"
                    aria-label="Costo unitario"
                    title="Costo unitario"
                    value={r.costo_unitario}
                    onChange={(e) => editarRenglon(idx, { costo_unitario: e.target.value })}
                  />
                  <button
                    type="button"
                    onClick={() => setRenglones((prev) => prev.filter((_, i) => i !== idx))}
                    disabled={renglones.length === 1}
                    className="flex size-8 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent disabled:opacity-40"
                    aria-label="Quitar renglón"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRenglones((prev) => [...prev, renglonVacio()])}
                >
                  + Agregar renglón
                </Button>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ped-total">
                Costo total{" "}
                {sumaRenglones > 0 && totalManual.trim() === "" && (
                  <span className="font-normal text-muted-foreground">
                    (sugerido: {formatearMXN(sumaRenglones)})
                  </span>
                )}
              </Label>
              <Input
                id="ped-total"
                type="number"
                min="0"
                step="0.01"
                placeholder={sumaRenglones > 0 ? sumaRenglones.toFixed(2) : "0.00"}
                value={totalManual}
                onChange={(e) => setTotalManual(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ped-notas">Notas (opcional)</Label>
              <Textarea
                id="ped-notas"
                rows={1}
                placeholder="Guía, condiciones, aduana…"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
              />
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {pedido && gestor && (
              <Button variant="destructive" onClick={borrar} disabled={pending}>
                Borrar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={pending}>
              {pending ? "Guardando…" : pedido ? "Guardar cambios" : "Registrar pedido"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
