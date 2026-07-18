"use client";

import { useState, useTransition } from "react";
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
import { TIPOS_PRODUCTO } from "@/lib/catalogos";
import {
  guardarProducto,
  borrarProducto,
  type ProductoInput,
} from "@/app/(app)/inventario/actions";
import type { ProductConProveedor, Supplier, TipoProductoId } from "@/lib/types";

const SIN_PROVEEDOR = "none";

/* Convierte el texto de un input numérico a number|null (vacío = null). */
function aNumero(texto: string): number | null {
  if (texto.trim() === "") return null;
  const n = Number(texto);
  return Number.isFinite(n) ? n : null;
}

/* Alta y edición de un producto. */
export function ProductoDialog({
  producto,
  proveedores,
  gestor,
  onClose,
}: {
  producto: ProductConProveedor | null; // null = alta
  proveedores: Supplier[];
  gestor: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  /* Vinculado a un canal: nombre/variante se administran allá (la sync los
     pisaría). El stock de un producto vinculado NO se edita aquí: solo cambia
     con los botones +/− de la tabla (esa es la única vía que escribe stock en
     los canales). El precio/costo desde este diálogo solo aplican a Tienda Nube
     (el de ML se administra en ML). */
  const deTiendaNube = producto?.tiendanube_variant_id != null;
  const deMeli = producto?.meli_item_id != null;
  const vinculado = deTiendaNube || deMeli;
  const avisoCanales =
    deTiendaNube && deMeli
      ? "Vinculado a Tienda Nube y Mercado Libre: el precio y costo que guardes aquí se actualizan en Tienda Nube. El stock se ajusta con los botones +/− de la tabla."
      : deTiendaNube
        ? "Producto vinculado a Tienda Nube: el nombre y la variante se editan en la tienda; el precio y costo que guardes aquí se actualizan también allá. El stock se ajusta con los botones +/− de la tabla."
        : deMeli
          ? "Publicación vinculada a Mercado Libre: nombre, variante y precio se editan allá. El stock se ajusta con los botones +/− de la tabla."
          : null;
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [tipo, setTipo] = useState<TipoProductoId>(producto?.tipo ?? "cinturones");
  const [variante, setVariante] = useState(producto?.variante ?? "");
  const [costo, setCosto] = useState(producto?.costo?.toString() ?? "");
  const [precio, setPrecio] = useState(producto?.precio?.toString() ?? "");
  const [stock, setStock] = useState(producto?.stock?.toString() ?? "0");
  const [stockMinimo, setStockMinimo] = useState(producto?.stock_minimo?.toString() ?? "5");
  const [proveedorId, setProveedorId] = useState(producto?.proveedor_id ?? SIN_PROVEEDOR);
  const [activo, setActivo] = useState(producto?.activo ?? true);
  const [notas, setNotas] = useState(producto?.notas ?? "");

  function guardar() {
    if (!nombre.trim()) {
      toast.error("El producto necesita un nombre.");
      return;
    }
    const input: ProductoInput = {
      nombre,
      tipo,
      variante,
      costo: aNumero(costo),
      precio: aNumero(precio),
      stock: Math.max(0, Math.trunc(Number(stock) || 0)),
      stock_minimo: Math.max(0, Math.trunc(Number(stockMinimo) || 0)),
      proveedor_id: proveedorId === SIN_PROVEEDOR ? null : proveedorId,
      activo,
      notas,
    };
    startTransition(async () => {
      try {
        const r = await guardarProducto(producto?.id ?? null, input);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success(producto ? "Producto actualizado." : "Producto creado.");
        onClose();
      } catch {
        toast.error("No se pudo guardar. Revisa tu conexión.");
      }
    });
  }

  function borrar() {
    if (!producto) return;
    if (!window.confirm(`¿Borrar «${producto.nombre}»? Esto no se puede deshacer.`)) return;
    startTransition(async () => {
      try {
        const r = await borrarProducto(producto.id);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success("Producto borrado.");
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
          <DialogTitle>{producto ? "Editar producto" : "Nuevo producto"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {avisoCanales && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              {avisoCanales}
            </p>
          )}

          {/* Galería importada de Tienda Nube (solo lectura; click para ampliar). */}
          {producto && producto.imagenes.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <Label>Fotos ({producto.imagenes.length})</Label>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {producto.imagenes.map((src, i) => (
                  <a
                    key={src}
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="shrink-0"
                    title={`Foto ${i + 1} — abrir en tamaño completo`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`${producto.nombre} — foto ${i + 1}`}
                      loading="lazy"
                      className="size-20 rounded-md border object-cover transition hover:opacity-80"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-nombre">Nombre</Label>
              <Input
                id="prod-nombre"
                autoFocus={!vinculado}
                disabled={vinculado}
                placeholder="Cinturón de palanca"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-variante">Variante (opcional)</Label>
              <Input
                id="prod-variante"
                disabled={vinculado}
                placeholder="Rosa / M"
                value={variante}
                onChange={(e) => setVariante(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => v && setTipo(v as TipoProductoId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => TIPOS_PRODUCTO.find((t) => t.id === v)?.nombre ?? "Tipo"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_PRODUCTO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Proveedor</Label>
              <Select value={proveedorId} onValueChange={(v) => setProveedorId(v ?? SIN_PROVEEDOR)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === SIN_PROVEEDOR
                        ? "Sin proveedor"
                        : (proveedores.find((p) => p.id === v)?.nombre ?? "Proveedor")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_PROVEEDOR}>Sin proveedor</SelectItem>
                  {proveedores.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-costo">Costo ($)</Label>
              <Input
                id="prod-costo"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-precio">Precio ($)</Label>
              <Input
                id="prod-precio"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                disabled={deMeli && !deTiendaNube}
                value={precio}
                onChange={(e) => setPrecio(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-stock">Stock</Label>
              <Input
                id="prod-stock"
                type="number"
                min="0"
                step="1"
                disabled={vinculado}
                title={vinculado ? "El stock se ajusta con los botones +/− de la tabla" : undefined}
                value={stock}
                onChange={(e) => setStock(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prod-minimo" title="Se avisa cuando el stock baja a este número o menos">
                Aviso si ≤
              </Label>
              <Input
                id="prod-minimo"
                type="number"
                min="0"
                step="1"
                value={stockMinimo}
                onChange={(e) => setStockMinimo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prod-notas">Notas (opcional)</Label>
            <Textarea
              id="prod-notas"
              rows={2}
              placeholder="Detalles del producto…"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>

          {producto && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                className="size-4 accent-primary"
              />
              Producto activo (desmárcalo para retirarlo del catálogo sin borrarlo)
            </label>
          )}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {producto && gestor && (
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
              {pending ? "Guardando…" : producto ? "Guardar cambios" : "Crear producto"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
