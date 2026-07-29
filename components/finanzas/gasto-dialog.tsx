"use client";

import { useRef, useState, useTransition } from "react";
import { ExternalLink, Paperclip, X } from "lucide-react";
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
import { DatePicker } from "@/components/compartido/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CATEGORIAS_GASTO } from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import {
  guardarGasto,
  borrarGasto,
  subirComprobante,
  borrarComprobante,
  urlComprobante,
  type GastoInput,
} from "@/app/(app)/finanzas/actions";
import type { CategoriaGastoId, ExpenseConComprobantes, ExpenseReceipt } from "@/lib/types";

/* Alta y edición de un gasto. Los comprobantes (facturas, tickets) solo se
   pueden adjuntar en un gasto ya guardado: necesitan su id para la ruta. */
export function GastoDialog({
  gasto,
  onClose,
}: {
  gasto: ExpenseConComprobantes | null; // null = alta
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [subiendo, setSubiendo] = useState(false);
  const inputArchivo = useRef<HTMLInputElement>(null);

  /* Lista propia: las props son una foto previa a la subida, así que sin esto
     el comprobante recién adjuntado no aparecería hasta cerrar y reabrir. */
  const [comprobantes, setComprobantes] = useState<ExpenseReceipt[]>(gasto?.comprobantes ?? []);

  const [fecha, setFecha] = useState(gasto?.fecha ?? hoyISO());
  const [concepto, setConcepto] = useState(gasto?.concepto ?? "");
  const [monto, setMonto] = useState(gasto?.monto?.toString() ?? "");
  const [categoria, setCategoria] = useState<CategoriaGastoId>(gasto?.categoria ?? "operacion");
  const [proveedor, setProveedor] = useState(gasto?.proveedor ?? "");
  const [notas, setNotas] = useState(gasto?.notas ?? "");

  function guardar() {
    const input: GastoInput = {
      fecha,
      concepto,
      monto: Math.round((Number(monto) || 0) * 100) / 100,
      categoria,
      proveedor,
      notas,
    };
    startTransition(async () => {
      try {
        const r = await guardarGasto(gasto?.id ?? null, input);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success(gasto ? "Gasto actualizado." : "Gasto registrado.");
        onClose();
      } catch {
        toast.error("No se pudo guardar. Revisa tu conexión.");
      }
    });
  }

  function borrar() {
    if (!gasto) return;
    if (!window.confirm(`¿Borrar el gasto «${gasto.concepto}»? También se borran sus comprobantes.`))
      return;
    startTransition(async () => {
      try {
        const r = await borrarGasto(gasto.id);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success("Gasto borrado.");
        onClose();
      } catch {
        toast.error("No se pudo borrar. Revisa tu conexión.");
      }
    });
  }

  async function adjuntar(archivo: File) {
    if (!gasto) return;
    setSubiendo(true);
    try {
      const fd = new FormData();
      fd.set("file", archivo);
      const r = await subirComprobante(gasto.id, fd);
      if ("error" in r) {
        toast.error(r.error);
      } else {
        setComprobantes((prev) => [...prev, r.comprobante]);
        toast.success("Comprobante guardado.");
      }
    } catch {
      toast.error("No se pudo subir el comprobante.");
    } finally {
      setSubiendo(false);
      if (inputArchivo.current) inputArchivo.current.value = "";
    }
  }

  async function abrirComprobante(storagePath: string) {
    const r = await urlComprobante(storagePath);
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    window.open(r.url, "_blank", "noopener,noreferrer");
  }

  async function quitarComprobante(id: string, storagePath: string) {
    const r = await borrarComprobante(id, storagePath);
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    setComprobantes((prev) => prev.filter((c) => c.id !== id));
    toast.success("Comprobante borrado.");
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{gasto ? "Editar gasto" : "Nuevo gasto"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gasto-concepto">Concepto</Label>
            <Input
              id="gasto-concepto"
              autoFocus
              placeholder="Publicidad en Meta, caja de envíos…"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gasto-monto">Monto ($)</Label>
              <Input
                id="gasto-monto"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gasto-fecha">Fecha</Label>
              <DatePicker id="gasto-fecha" value={fecha} onChange={setFecha} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Categoría</Label>
              <Select value={categoria} onValueChange={(v) => v && setCategoria(v as CategoriaGastoId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => CATEGORIAS_GASTO.find((c) => c.id === v)?.nombre ?? "Categoría"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIAS_GASTO.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gasto-proveedor">Pagado a (opcional)</Label>
            <Input
              id="gasto-proveedor"
              placeholder="Meta, Estafeta, Nancy…"
              value={proveedor}
              onChange={(e) => setProveedor(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gasto-notas">Notas (opcional)</Label>
            <Textarea
              id="gasto-notas"
              rows={2}
              placeholder="Detalles, referencia de pago…"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>

          {/* Comprobantes: solo con el gasto ya creado (la ruta usa su id). */}
          <div className="flex flex-col gap-1.5">
            <Label>Facturas y comprobantes</Label>
            {!gasto ? (
              <p className="text-xs text-muted-foreground">
                Guarda el gasto y vuelve a abrirlo para adjuntar la factura o el ticket.
              </p>
            ) : (
              <>
                {comprobantes.length > 0 && (
                  <ul className="flex flex-col gap-1">
                    {comprobantes.map((c) => (
                      <li
                        key={c.id}
                        className="flex items-center gap-2 rounded-lg border bg-card px-2.5 py-1.5 text-sm"
                      >
                        <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                        <button
                          type="button"
                          onClick={() => abrirComprobante(c.storage_path)}
                          className="flex flex-1 items-center gap-1 truncate text-left hover:underline"
                          title={c.nombre}
                        >
                          <span className="truncate">{c.nombre}</span>
                          <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                        </button>
                        <button
                          type="button"
                          onClick={() => quitarComprobante(c.id, c.storage_path)}
                          aria-label={`Borrar ${c.nombre}`}
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                        >
                          <X className="size-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <input
                  ref={inputArchivo}
                  type="file"
                  accept="image/*,application/pdf"
                  disabled={subiendo}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) adjuntar(f);
                  }}
                  className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:bg-card file:px-2.5 file:py-1 file:text-xs file:font-semibold"
                />
                {subiendo && <p className="text-xs text-muted-foreground">Subiendo…</p>}
              </>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {gasto && (
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
              {pending ? "Guardando…" : gasto ? "Guardar cambios" : "Registrar gasto"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
