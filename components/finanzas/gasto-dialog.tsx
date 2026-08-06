"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ExternalLink, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
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
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/compartido/date-picker";
import { CampoSugerido } from "@/components/compartido/campo-sugerido";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  CATEGORIAS_GASTO,
  ESTADOS_COMPROBANTE,
  obtenerCategoriaGasto,
  obtenerEstadoComprobante,
} from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import { SUGERENCIAS_VACIAS, type Sugerencia, type SugerenciasGasto } from "@/lib/finanzas/sugerencias";
import {
  guardarGasto,
  borrarGasto,
  subirComprobante,
  borrarComprobante,
  urlComprobante,
  type GastoInput,
} from "@/app/(app)/finanzas/actions";
import type {
  CategoriaGastoId,
  EstadoComprobanteId,
  ExpenseConComprobantes,
  ExpenseReceipt,
} from "@/lib/types";

/* Frase del aviso cuando el concepto elegido arrastra sus datos de siempre. */
function enumerar(partes: string[]): string {
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(", ")} y ${partes[partes.length - 1]}`;
}

/* El comprobante a lo ancho de su columna: los tickets y facturas son fotos
   casi siempre, y para saber cuál era cuál había que abrirlos de uno en uno.
   El bucket es privado, así que cada imagen pide su enlace firmado al montarse;
   los PDF conservan el clip (no hay vista previa que valga la pena inventar). */
function VistaComprobante({ comprobante }: { comprobante: ExpenseReceipt }) {
  const esImagen = (comprobante.tipo ?? "").startsWith("image/");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!esImagen) return;
    let vivo = true;
    urlComprobante(comprobante.storage_path).then((r) => {
      if (vivo && !("error" in r)) setUrl(r.url);
    });
    return () => {
      vivo = false;
    };
  }, [comprobante.storage_path, esImagen]);

  if (!esImagen || !url) {
    return (
      <span className="flex h-24 w-full items-center justify-center gap-2 bg-muted/40 text-xs text-muted-foreground">
        <Paperclip className="size-4" />
        {esImagen ? "Cargando…" : "PDF"}
      </span>
    );
  }
  return (
    <Image
      src={url}
      alt={comprobante.nombre}
      width={640}
      height={640}
      unoptimized
      className="max-h-[420px] w-full bg-muted/30 object-contain"
    />
  );
}

/* Alta y edición de un gasto. Los comprobantes (facturas, tickets) solo se
   pueden adjuntar en un gasto ya guardado: necesitan su id para la ruta. */
export function GastoDialog({
  gasto,
  sugerencias = SUGERENCIAS_VACIAS,
  onClose,
}: {
  gasto: ExpenseConComprobantes | null; // null = alta
  /* Lo ya capturado antes, agrupado por cuántas veces se usó (ver lib/finanzas). */
  sugerencias?: SugerenciasGasto;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
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
  const [metodoPago, setMetodoPago] = useState(gasto?.metodo_pago ?? "");
  const [factura, setFactura] = useState<EstadoComprobanteId>(gasto?.factura ?? "pendiente");
  const [recibo, setRecibo] = useState<EstadoComprobanteId>(gasto?.recibo ?? "pendiente");

  /* La categoría arranca en «operación» sin que nadie la haya elegido: hay que
     saber si sigue intacta para poder rellenarla desde el concepto. */
  const [categoriaTocada, setCategoriaTocada] = useState(false);
  /* Qué se copió del último gasto igual, para decirlo en vez de hacerlo a escondidas. */
  const [copiado, setCopiado] = useState<string | null>(null);

  /* Al tomar un concepto de la lista se traen los datos con los que se capturó
     la última vez. Solo en un alta y solo sobre campos que nadie ha tocado:
     editando un gasto viejo, cambiar el concepto no debe mover nada más. */
  function usarConcepto(s: Sugerencia) {
    if (gasto) return;
    const copiados: string[] = [];
    if (s.categoria && !categoriaTocada && s.categoria !== categoria) {
      setCategoria(s.categoria);
      copiados.push(`la categoría «${obtenerCategoriaGasto(s.categoria)?.nombre ?? s.categoria}»`);
    }
    if (s.proveedor && !proveedor.trim()) {
      setProveedor(s.proveedor);
      copiados.push(`a quién se le paga (${s.proveedor})`);
    }
    if (s.metodoPago && !metodoPago.trim()) {
      setMetodoPago(s.metodoPago);
      copiados.push(`el método de pago (${s.metodoPago})`);
    }
    setCopiado(copiados.length ? enumerar(copiados) : null);
  }

  function guardar() {
    const input: GastoInput = {
      fecha,
      concepto,
      monto: Math.round((Number(monto) || 0) * 100) / 100,
      categoria,
      proveedor,
      notas,
      metodo_pago: metodoPago,
      factura,
      recibo,
    };
    ejecutar(() => guardarGasto(gasto?.id ?? null, input), {
      ok: gasto ? "Gasto actualizado." : "Gasto registrado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!gasto) return;
    ejecutar(() => borrarGasto(gasto.id), {
      confirmar: `¿Borrar el gasto «${gasto.concepto}»? También se borran sus comprobantes.`,
      ok: "Gasto borrado.",
      error: "No se pudo borrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  /* Se aceptan VARIOS archivos de un jalón (un gasto suele traer ticket +
     factura, o varias fotos). Suben en orden, y si uno falla los demás siguen:
     un ticket borroso no debe tirar la factura buena. */
  async function adjuntarTodos(lista: FileList | null) {
    if (!gasto || !lista?.length) return;
    setSubiendo(true);
    let subidos = 0;
    try {
      for (const archivo of Array.from(lista)) {
        const fd = new FormData();
        fd.set("file", archivo);
        const r = await subirComprobante(gasto.id, fd);
        if ("error" in r) {
          toast.error(`${archivo.name}: ${r.error}`);
          continue;
        }
        setComprobantes((prev) => [...prev, r.comprobante]);
        subidos++;
      }
      if (subidos > 0) {
        toast.success(subidos === 1 ? "Comprobante guardado." : `${subidos} comprobantes guardados.`);
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
      {/* Rectangular en escritorio: el formulario a la izquierda y los
          comprobantes a lo alto del lado derecho, en grande — que la factura se
          LEA sin abrirla era el punto de enseñarla aquí. */}
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg md:max-w-4xl">
        <DialogHeader>
          <DialogTitle>{gasto ? "Editar gasto" : "Nuevo gasto"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 md:grid md:grid-cols-[minmax(0,1fr)_340px] md:items-start md:gap-6">
        <div className="flex flex-col gap-3">
          {/* Los gastos se repiten mes con mes: el campo propone los de siempre
              ordenados por cuántas veces se han capturado y completa al teclear. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="gasto-concepto">Concepto</Label>
            <CampoSugerido
              id="gasto-concepto"
              autoFocus
              autocompletar
              placeholder="Publicidad en Meta, caja de envíos…"
              value={concepto}
              onChange={(v) => {
                setConcepto(v);
                setCopiado(null);
              }}
              onElegir={usarConcepto}
              sugerencias={sugerencias.conceptos}
              siguiente="gasto-monto"
              detalle={(s) =>
                [obtenerCategoriaGasto(s.categoria ?? "")?.nombre, s.proveedor]
                  .filter(Boolean)
                  .join(" · ") || null
              }
            />
            {copiado && (
              <p className="text-[11.5px] text-muted-foreground">
                Se copió {copiado} del último gasto igual. Cámbialo si esta vez no aplica.
              </p>
            )}
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
              <Select
                value={categoria}
                onValueChange={(v) => {
                  if (!v) return;
                  setCategoria(v as CategoriaGastoId);
                  setCategoriaTocada(true);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => obtenerCategoriaGasto(v)?.nombre ?? "Categoría"}
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

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gasto-proveedor">Pagado a (opcional)</Label>
              <CampoSugerido
                id="gasto-proveedor"
                placeholder="Meta, Estafeta, Nancy…"
                value={proveedor}
                onChange={setProveedor}
                sugerencias={sugerencias.proveedores}
                siguiente="gasto-metodo"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="gasto-metodo">Método de pago</Label>
              <CampoSugerido
                id="gasto-metodo"
                placeholder="Transferencia, TC Mercado Pago…"
                value={metodoPago}
                onChange={setMetodoPago}
                sugerencias={sugerencias.metodosPago}
                siguiente="gasto-notas"
              />
            </div>
          </div>

          {/* Lo que la hoja de facturas vigila: qué papel falta por cobrar al
              proveedor. «Aún no» = se pagó, pero no ha llegado. */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>¿Ya hay factura?</Label>
              <Select value={factura} onValueChange={(v) => v && setFactura(v as EstadoComprobanteId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => obtenerEstadoComprobante(v)?.nombre ?? "Factura"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS_COMPROBANTE.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>¿Ya hay recibo?</Label>
              <Select value={recibo} onValueChange={(v) => v && setRecibo(v as EstadoComprobanteId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => obtenerEstadoComprobante(v)?.nombre ?? "Recibo"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS_COMPROBANTE.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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

        </div>

        {/* Comprobantes: solo con el gasto ya creado (la ruta usa su id). En
            escritorio es la columna derecha completa; en el teléfono queda
            debajo del formulario. */}
        <div className="flex min-w-0 flex-col gap-2 md:h-full md:border-l md:pl-6">
          <Label>Facturas y comprobantes</Label>
          {!gasto ? (
            <p className="text-xs text-muted-foreground">
              Guarda el gasto y vuelve a abrirlo para adjuntar la factura o el ticket.
            </p>
          ) : (
            <>
              {comprobantes.length > 0 && (
                <ul className="flex flex-col gap-2.5">
                  {comprobantes.map((c) => (
                    <li key={c.id} className="overflow-hidden rounded-lg border bg-card">
                      <button
                        type="button"
                        onClick={() => abrirComprobante(c.storage_path)}
                        title="Ver el archivo completo"
                        className="block w-full transition-opacity hover:opacity-80"
                      >
                        <VistaComprobante comprobante={c} />
                      </button>
                      <div className="flex items-center gap-1.5 border-t px-2.5 py-1.5 text-xs">
                        <button
                          type="button"
                          onClick={() => abrirComprobante(c.storage_path)}
                          className="flex min-w-0 flex-1 items-center gap-1 truncate text-left hover:underline"
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
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <input
                ref={inputArchivo}
                type="file"
                accept="image/*,application/pdf"
                multiple
                disabled={subiendo}
                onChange={(e) => adjuntarTodos(e.target.files)}
                className="text-xs text-muted-foreground file:mr-2 file:rounded-md file:border file:bg-card file:px-2.5 file:py-1 file:text-xs file:font-semibold"
              />
              {subiendo && <p className="text-xs text-muted-foreground">Subiendo…</p>}
            </>
          )}
        </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={gasto ? "Guardar cambios" : "Registrar gasto"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={gasto ? borrar : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
