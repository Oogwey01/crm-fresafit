"use client";

import { useRef, useState } from "react";
import { FileScan, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { extraerFactura } from "@/app/(app)/proveedores/actions";
import { matchProductoPorSku, normalizarSku } from "@/lib/importar/tsv";
import { aNumero } from "@/lib/validacion";
import { formatearMXN } from "@/lib/moneda";
import type { FacturaExtraida } from "@/lib/facturas/extraer";
import type { ItemInicialPedido } from "@/components/proveedores/pedido-prov-dialog";
import { cn } from "@/lib/utils";
import type { ProductoProveedor } from "@/lib/proveedores/tipos";

/* Renglón ya leído, editable antes de pasar al pedido. */
type Renglon = {
  descripcion: string;
  sku: string;
  cantidad: string;
  costo: string;
  productoId: string | null;
};

/* Subir la factura del proveedor y que la IA saque las partidas. Nada se
   guarda aquí: los renglones se revisan, se corrigen y se pasan al diálogo de
   pedido, que es donde se elige proveedor y se confirma. */
export function ImportarFactura({
  productos,
  onListo,
}: {
  productos: ProductoProveedor[];
  onListo: (items: ItemInicialPedido[], contexto: { proveedor: string | null; notas: string }) => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [abierto, setAbierto] = useState(false);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [factura, setFactura] = useState<FacturaExtraida | null>(null);
  const [renglones, setRenglones] = useState<Renglon[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  function cerrar() {
    setAbierto(false);
    setArchivo(null);
    setFactura(null);
    setRenglones([]);
    if (inputRef.current) inputRef.current.value = "";
  }

  function leer() {
    if (!archivo) {
      toast.error("Elige el archivo de la factura.");
      return;
    }
    const fd = new FormData();
    fd.append("file", archivo);
    ejecutar(() => extraerFactura(fd), {
      error: "No se pudo leer la factura. Revisa tu conexión.",
      alExito: (r) => {
        if (!("datos" in r)) return;
        const datos = r.datos;
        setFactura(datos);
        setRenglones(
          datos.renglones.map((x) => ({
            descripcion: x.descripcion,
            sku: x.sku ?? "",
            cantidad: String(x.cantidad || 1),
            costo: x.costo_unitario != null ? String(x.costo_unitario) : "",
            /* El SKU del proveedor rara vez es el nuestro, pero cuando coincide
               se ahorra elegir el producto a mano. */
            productoId: x.sku
              ? (matchProductoPorSku(x.sku, productos).producto?.id ?? null)
              : null,
          })),
        );
        toast.success(
          `${datos.renglones.length} ${datos.renglones.length === 1 ? "partida leída" : "partidas leídas"}. Revísalas antes de continuar.`,
        );
      },
    });
  }

  function editar(idx: number, cambio: Partial<Renglon>) {
    setRenglones((prev) => prev.map((r, i) => (i === idx ? { ...r, ...cambio } : r)));
  }

  function continuar() {
    const utiles = renglones.filter((r) => r.descripcion.trim() || r.productoId);
    if (!utiles.length) {
      toast.error("No quedan renglones que pasar al pedido.");
      return;
    }
    const items: ItemInicialPedido[] = utiles.map((r) => ({
      producto_id: r.productoId,
      descripcion: r.productoId ? undefined : [r.sku, r.descripcion].filter(Boolean).join(" · "),
      cantidad: Math.max(1, Math.trunc(Number(r.cantidad) || 1)),
      costo_unitario: aNumero(r.costo),
    }));
    const notas = factura
      ? [
          factura.folio && `Factura ${factura.folio}`,
          factura.fecha && `del ${factura.fecha}`,
          factura.moneda !== "MXN" && `importes en ${factura.moneda}`,
          factura.tipo_cambio && `TC ${factura.tipo_cambio}`,
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    onListo(items, { proveedor: factura?.proveedor ?? null, notas });
    cerrar();
  }

  /* Los importes de una factura en dólares NO se convierten: se pasan tal cual
     y la nota del pedido deja dicho en qué moneda venían. Convertir a un tipo
     de cambio adivinado sería peor que dejarlo explícito. */
  const enDolares = factura != null && factura.moneda !== "MXN";
  const suma = renglones.reduce(
    (acc, r) => acc + (Number(r.cantidad) || 0) * (Number(r.costo) || 0),
    0,
  );

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setAbierto(true)}
        className="h-auto w-full gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:w-auto"
      >
        <FileScan className="size-4" strokeWidth={2} />
        Leer factura
      </Button>

      {abierto && (
        <Dialog open onOpenChange={(v) => !v && cerrar()}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Leer factura del proveedor</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Sube la factura en PDF o una foto. El sistema saca las partidas para que no las
                recaptures; tú las revisas antes de que entren al pedido. Nada se guarda hasta que
                confirmes.
              </p>

              <div className="flex flex-wrap items-center gap-2">
                <Input
                  ref={inputRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="max-w-sm"
                  onChange={(e) => {
                    setArchivo(e.target.files?.[0] ?? null);
                    setFactura(null);
                    setRenglones([]);
                  }}
                />
                <Button onClick={leer} disabled={pending || !archivo}>
                  {pending ? "Leyendo…" : "Leer factura"}
                </Button>
              </div>

              {factura && (
                <div className="rounded-lg bg-muted/50 px-3 py-2 text-[13px]">
                  <b className="text-foreground">{factura.proveedor ?? "Proveedor sin nombre"}</b>
                  {factura.folio && ` · factura ${factura.folio}`}
                  {factura.fecha && ` · ${factura.fecha}`}
                  {` · importes en ${factura.moneda}`}
                  {factura.tipo_cambio != null && ` · tipo de cambio ${factura.tipo_cambio}`}
                  {factura.total != null && ` · total ${factura.total}`}
                  {enDolares && (
                    <span className="mt-1 block text-amber-600">
                      Los importes se pasan al pedido tal como vienen, sin convertir. Anota el tipo
                      de cambio al registrar el pago.
                    </span>
                  )}
                </div>
              )}

              {renglones.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[720px] text-sm">
                    <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Qué es</th>
                        <th className="px-3 py-2 font-semibold">SKU</th>
                        <th className="px-3 py-2 font-semibold">Cantidad</th>
                        <th className="px-3 py-2 font-semibold">Costo c/u</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {renglones.map((r, i) => {
                        const producto = productos.find((p) => p.id === r.productoId);
                        return (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-1.5">
                              <Input
                                value={r.descripcion}
                                onChange={(e) => editar(i, { descripcion: e.target.value })}
                                className="h-8"
                              />
                              {producto && (
                                <span className="mt-0.5 block text-[11px] text-green-600">
                                  coincide con {producto.nombre}
                                  {producto.variante ? ` · ${producto.variante}` : ""}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                value={r.sku}
                                onChange={(e) => {
                                  const sku = e.target.value.toUpperCase();
                                  editar(i, {
                                    sku,
                                    productoId: normalizarSku(sku)
                                      ? (matchProductoPorSku(sku, productos).producto?.id ?? null)
                                      : null,
                                  });
                                }}
                                className="h-8 w-28 font-mono text-[12.5px]"
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                type="number"
                                min="1"
                                value={r.cantidad}
                                onChange={(e) => editar(i, { cantidad: e.target.value })}
                                className={cn("h-8 w-20", !Number(r.cantidad) && "text-amber-600")}
                              />
                            </td>
                            <td className="px-3 py-1.5">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={r.costo}
                                onChange={(e) => editar(i, { costo: e.target.value })}
                                className={cn("h-8 w-28", !r.costo && "text-amber-600")}
                              />
                            </td>
                            <td className="px-3 py-1.5 text-right">
                              <button
                                type="button"
                                onClick={() => setRenglones((prev) => prev.filter((_, x) => x !== i))}
                                className="text-muted-foreground hover:text-destructive"
                                aria-label="Quitar renglón"
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {renglones.length > 0 && (
                <p className="text-[13px] text-muted-foreground">
                  Suma de los renglones:{" "}
                  <b className="text-foreground">
                    {enDolares ? `${suma.toFixed(2)} ${factura?.moneda}` : formatearMXN(suma)}
                  </b>
                  {factura?.total != null &&
                    Math.abs(suma - factura.total) > 0.5 &&
                    ` · la factura dice ${factura.total}: revisa las partidas.`}
                </p>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={cerrar} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={continuar} disabled={pending || !renglones.length}>
                Continuar con {renglones.length || ""}{" "}
                {renglones.length === 1 ? "renglón" : "renglones"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
