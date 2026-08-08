"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { ExternalLink, Paperclip, X } from "lucide-react";
import { toast } from "sonner";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
  SeccionFormulario,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaFecha,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import {
  PastillaPropiedad,
  useCerrarPastilla,
} from "@/components/compartido/pastilla-propiedad";
import { CampoSugerido } from "@/components/compartido/campo-sugerido";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  CATEGORIAS_GASTO,
  ESTADOS_COMPROBANTE,
  obtenerCategoriaGasto,
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

/* Pastilla con un CampoSugerido dentro del popover: «pagado a» y «método de
   pago» conservan su memoria de lo ya capturado también en escritorio. En el
   teléfono se pinta el campo con label de siempre. */
function PastillaSugerida({
  etiqueta,
  valor,
  onCambio,
  sugerencias,
  placeholder,
  opcional = false,
  idMovil,
  siguienteMovil,
}: {
  etiqueta: string;
  valor: string;
  onCambio: (v: string) => void;
  sugerencias: Sugerencia[];
  placeholder?: string;
  opcional?: boolean;
  idMovil?: string;
  /* id del campo móvil al que salta Enter (solo aplica bajo md:). */
  siguienteMovil?: string;
}) {
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      vacia={!valor && opcional}
      etiquetaVacia={etiqueta}
      valor={valor || <span className="text-muted-foreground">{etiqueta}</span>}
      textoValor={valor || undefined}
      anchoPopover="w-72"
      contenidoMovil={
        <Campo etiqueta={etiqueta} opcional={opcional} htmlFor={idMovil}>
          <CampoSugerido
            id={idMovil}
            placeholder={placeholder}
            value={valor}
            onChange={onCambio}
            sugerencias={sugerencias}
            siguiente={siguienteMovil}
          />
        </Campo>
      }
    >
      <SugeridoConCierre
        valor={valor}
        onCambio={onCambio}
        sugerencias={sugerencias}
        placeholder={placeholder}
      />
    </PastillaPropiedad>
  );
}

/* Separado para usar useCerrarPastilla dentro del popover: Enter confirma lo
   escrito y cierra la pastilla (CampoSugerido ya consumió la tecla, pero el
   evento sigue burbujeando hasta aquí). */
function SugeridoConCierre({
  valor,
  onCambio,
  sugerencias,
  placeholder,
}: {
  valor: string;
  onCambio: (v: string) => void;
  sugerencias: Sugerencia[];
  placeholder?: string;
}) {
  const cerrar = useCerrarPastilla();
  return (
    <div
      onKeyDown={(e) => {
        if (e.key === "Enter") cerrar();
      }}
    >
      <CampoSugerido
        value={valor}
        onChange={onCambio}
        sugerencias={sugerencias}
        placeholder={placeholder}
      />
    </div>
  );
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
    <DialogoFormulario
      titulo={gasto ? "Editar gasto" : "Nuevo gasto"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={gasto ? "Guardar cambios" : "Registrar gasto"}
      pending={pending}
      onBorrar={gasto ? borrar : undefined}
      anchoEscritorio="md:max-w-xl"
    >
      <Hero pasoTitulo="¿Qué se pagó?">
        {/* Los gastos se repiten mes con mes: el campo propone los de siempre
            ordenados por cuántas veces se han capturado y completa al teclear. */}
        <Campo
          etiqueta="Concepto"
          htmlFor="gasto-concepto"
          ayuda={
            copiado
              ? `Se copió ${copiado} del último gasto igual. Cámbialo si esta vez no aplica.`
              : undefined
          }
        >
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
        </Campo>

        {/* El monto protagonista, grande y sin caja, como el hero. */}
        <div className="flex items-baseline gap-1 md:mt-1">
          <span className="text-lg font-semibold md:text-xl" aria-hidden="true">
            $
          </span>
          <input
            id="gasto-monto"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            aria-label="Monto"
            placeholder="0.00"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="w-full border-0 bg-transparent px-0 text-lg font-semibold outline-none placeholder:text-muted-foreground/50 md:text-xl"
          />
        </div>

        <DescripcionHero
          id="gasto-notas"
          etiqueta="Notas"
          placeholder="Detalles, referencia de pago… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades pasoTitulo="¿Cuándo y cómo se pagó?">
        <PastillaFecha etiqueta="Fecha" valor={fecha} onCambio={setFecha} />
        {/* La categoría conserva la auto-sugerencia del concepto: marcarla como
            tocada es lo que evita que un concepto posterior la pise. */}
        <PastillaOpcion
          etiqueta="Categoría"
          opciones={CATEGORIAS_GASTO}
          valor={categoria}
          onCambio={(v) => {
            setCategoria(v);
            setCategoriaTocada(true);
          }}
        />
        <PastillaSugerida
          etiqueta="Pagado a"
          valor={proveedor}
          onCambio={setProveedor}
          sugerencias={sugerencias.proveedores}
          placeholder="Meta, Estafeta, Nancy…"
          opcional
          idMovil="gasto-proveedor"
          siguienteMovil="gasto-metodo"
        />
        <PastillaSugerida
          etiqueta="Método de pago"
          valor={metodoPago}
          onCambio={setMetodoPago}
          sugerencias={sugerencias.metodosPago}
          placeholder="Transferencia, TC Mercado Pago…"
          idMovil="gasto-metodo"
        />
      </Propiedades>

      {/* Lo que la hoja de facturas vigila: qué papel falta por cobrar al
          proveedor. «Aún no» = se pagó, pero no ha llegado. */}
      <Propiedades
        pasoTitulo="Los papeles"
        pasoAyuda="«Aún no» = se pagó, pero el papel no ha llegado."
      >
        <PastillaOpcion
          etiqueta="¿Ya hay factura?"
          opciones={ESTADOS_COMPROBANTE}
          valor={factura}
          onCambio={setFactura}
        />
        <PastillaOpcion
          etiqueta="¿Ya hay recibo?"
          opciones={ESTADOS_COMPROBANTE}
          valor={recibo}
          onCambio={setRecibo}
        />
      </Propiedades>

      {/* Comprobantes: solo con el gasto ya creado (la ruta usa su id). Que la
          factura se LEA sin abrirla era el punto de enseñarla aquí. */}
      <SeccionFormulario
        titulo="Comprobantes"
        pasoTitulo="Facturas y comprobantes"
        pasoAyuda={
          gasto
            ? "Fotos del ticket, el PDF de la factura… suben varios de un jalón."
            : "Se adjuntan con el gasto ya guardado."
        }
        contador={gasto ? comprobantes.length : null}
        abiertaPorDefecto
      >
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
      </SeccionFormulario>
    </DialogoFormulario>
  );
}
