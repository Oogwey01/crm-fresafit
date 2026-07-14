"use client";

import { useMemo, useState, useTransition } from "react";
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
import { Label } from "@/components/ui/label";
import { CANALES } from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import {
  registrarVenta,
  editarVenta,
  borrarVenta,
  type VentaInput,
} from "@/app/(app)/metricas/actions";
import type { CanalId, Product, SaleConProducto } from "@/lib/types";

function etiquetaProducto(p: Pick<Product, "nombre" | "variante">): string {
  return `${p.nombre}${p.variante ? ` · ${p.variante}` : ""}`;
}

function aNumero(texto: string): number {
  const n = Number(texto);
  return Number.isFinite(n) ? n : 0;
}

/* Alta y edición de una venta. El producto se elige con un buscador (el
   catálogo trae cientos de variantes; un Select plano no sirve). */
export function VentaDialog({
  venta,
  productos,
  gestor,
  onClose,
}: {
  venta: SaleConProducto | null; // null = alta
  productos: Pick<Product, "id" | "nombre" | "variante" | "sku" | "precio" | "activo">[];
  gestor: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [fecha, setFecha] = useState(venta?.fecha ?? hoyISO());
  const [canal, setCanal] = useState<CanalId>(venta?.canal ?? "punto_fisico");
  const [productoId, setProductoId] = useState<string | null>(venta?.producto_id ?? null);
  const [descripcion, setDescripcion] = useState(venta?.descripcion ?? "");
  const [cantidad, setCantidad] = useState(venta?.cantidad?.toString() ?? "1");
  const [monto, setMonto] = useState(venta?.monto?.toString() ?? "");
  const [montoTocado, setMontoTocado] = useState(!!venta);
  const [notas, setNotas] = useState(venta?.notas ?? "");
  const [busqueda, setBusqueda] = useState("");

  const seleccionado = productoId ? (productos.find((p) => p.id === productoId) ?? null) : null;

  const coincidencias = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (q.length < 2) return [];
    return productos
      .filter(
        (p) =>
          p.activo &&
          (p.nombre.toLowerCase().includes(q) ||
            (p.variante ?? "").toLowerCase().includes(q) ||
            (p.sku ?? "").toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [busqueda, productos]);

  /* Autollenar monto = precio × cantidad mientras el usuario no lo haya tocado. */
  function recalcularMonto(prod: typeof seleccionado, cant: string, tocado: boolean) {
    if (tocado || !prod?.precio) return;
    const n = Math.max(1, Math.trunc(aNumero(cant)));
    setMonto((prod.precio * n).toFixed(2));
  }

  function elegirProducto(p: (typeof productos)[number]) {
    setProductoId(p.id);
    setBusqueda("");
    recalcularMonto(p, cantidad, montoTocado);
  }

  function guardar() {
    const input: VentaInput = {
      fecha,
      canal,
      producto_id: productoId,
      descripcion,
      cantidad: Math.max(1, Math.trunc(aNumero(cantidad))),
      monto: Math.round(aNumero(monto) * 100) / 100,
      notas,
    };
    startTransition(async () => {
      try {
        const r = venta ? await editarVenta(venta.id, input) : await registrarVenta(input);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success(venta ? "Venta actualizada." : "Venta registrada.");
        onClose();
      } catch {
        toast.error("No se pudo guardar. Revisa tu conexión.");
      }
    });
  }

  function borrar() {
    if (!venta) return;
    if (!window.confirm("¿Borrar esta venta? Esto no se puede deshacer.")) return;
    startTransition(async () => {
      try {
        const r = await borrarVenta(venta.id);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success("Venta borrada.");
        onClose();
      } catch {
        toast.error("No se pudo borrar. Revisa tu conexión.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{venta ? "Editar venta" : "Registrar venta"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {venta?.origen === "api" && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Venta importada de {venta.canal === "tienda_nube" ? "Tienda Nube" : "una plataforma"}
              {venta.referencia_externa ? ` (ref. ${venta.referencia_externa})` : ""}. Si la orden
              cambia allá, la sincronización puede volver a ajustarla.
            </p>
          )}

          {/* Producto: chip seleccionado o buscador */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="venta-producto">Producto</Label>
            {seleccionado ? (
              <div className="flex items-center gap-2">
                <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-1 text-sm font-medium">
                  <span className="truncate">{etiquetaProducto(seleccionado)}</span>
                  <button
                    type="button"
                    onClick={() => setProductoId(null)}
                    aria-label="Quitar producto"
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              </div>
            ) : (
              <div className="relative">
                <Input
                  id="venta-producto"
                  autoFocus={!venta}
                  placeholder="Busca por nombre, variante o SKU…"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                />
                {coincidencias.length > 0 && (
                  <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
                    {coincidencias.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => elegirProducto(p)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent"
                      >
                        <span className="truncate">{etiquetaProducto(p)}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {p.precio ? formatearMXN(p.precio) : (p.sku ?? "")}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {!seleccionado && (
              <Input
                placeholder="…o describe qué se vendió (fuera de catálogo)"
                value={descripcion}
                onChange={(e) => setDescripcion(e.target.value)}
              />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1">
              <Label>Canal</Label>
              <Select value={canal} onValueChange={(v) => v && setCanal(v as CanalId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => CANALES.find((c) => c.id === v)?.nombre ?? "Canal"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CANALES.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="venta-fecha">Fecha</Label>
              <Input id="venta-fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="venta-cantidad">Cantidad</Label>
              <Input
                id="venta-cantidad"
                type="number"
                min="1"
                step="1"
                value={cantidad}
                onChange={(e) => {
                  setCantidad(e.target.value);
                  recalcularMonto(seleccionado, e.target.value, montoTocado);
                }}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="venta-monto">Total ($)</Label>
              <Input
                id="venta-monto"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={monto}
                onChange={(e) => {
                  setMontoTocado(true);
                  setMonto(e.target.value);
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="venta-notas">Notas (opcional)</Label>
            <Input
              id="venta-notas"
              placeholder="Mayoreo, cliente frecuente…"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {venta && gestor && (
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
              {pending ? "Guardando…" : venta ? "Guardar cambios" : "Registrar venta"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
