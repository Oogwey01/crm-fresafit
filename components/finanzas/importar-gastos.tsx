"use client";

import { useMemo, useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pastilla } from "@/components/compartido/pastilla";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { importarGastos, type FilaGastoInput } from "@/app/(app)/finanzas/actions";
import { obtenerCategoriaGasto, obtenerEstadoComprobante } from "@/lib/catalogos";
import { formatearFecha, hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import { norm, parsearFecha, parsearNumero, parsearTSV } from "@/lib/importar/tsv";
import type { CategoriaGastoId, EstadoComprobanteId } from "@/lib/types";

const ENCABEZADOS = ["Nombre", "Monto", "Met de pago", "Fecha", "Factura", "Recibo", "Estado"];

/* Palabras del concepto que delatan a qué categoría del CRM pertenece el gasto.
   Es una propuesta, no un veredicto: la vista previa la enseña y cualquiera la
   corrige después desde la ficha. */
const PISTAS: [CategoriaGastoId, string[]][] = [
  ["nomina", ["nomina", "nóminas", "imss", "honorarios", "sueldo", "finiquito", "aguinaldo"]],
  ["logistica", ["etiqueta", "envio", "envío", "paqueteria", "paquetería", "flete", "guia", "guía"]],
  ["marketing", ["publicidad", "meta", "facebook", "instagram", "ads", "influencer", "campana"]],
  ["producto", ["tela", "cinturon", "cinturón", "material", "proveedor", "produccion", "producción"]],
];

function categoriaDe(concepto: string): CategoriaGastoId {
  const t = norm(concepto);
  for (const [categoria, palabras] of PISTAS) {
    if (palabras.some((p) => t.includes(norm(p)))) return categoria;
  }
  /* Suscripciones, renta, servicios: el grueso de la hoja es operación. */
  return "operacion";
}

/* «Si» / «Aun no» / «No» de la hoja. Vacío se toma como pendiente: en la hoja
   una celda en blanco quiere decir que nadie la ha revisado. */
function comprobanteDe(celda: string): EstadoComprobanteId {
  const t = norm(celda);
  if (!t) return "pendiente";
  if (t.startsWith("si") || t.startsWith("sí")) return "si";
  if (t.startsWith("no ") || t === "no") return "no";
  return "pendiente";
}

export function ImportarGastos() {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const { pending, ejecutar } = useAccionServidor();

  const filas = useMemo(() => (abierto ? parsear(texto) : []), [abierto, texto]);
  const total = filas.reduce((a, f) => a + f.monto, 0);

  function cerrar() {
    setAbierto(false);
    setTexto("");
  }

  function importar() {
    if (!filas.length) {
      toast.error("No hay renglones con concepto, monto y fecha para importar.");
      return;
    }
    ejecutar(() => importarGastos(filas), {
      error: "No se pudo importar. Revisa tu conexión.",
      alExito: (r) => {
        const datos = "datos" in r ? r.datos : { creados: 0, omitidos: 0 };
        toast.success(
          `${datos.creados} ${datos.creados === 1 ? "gasto importado" : "gastos importados"}` +
            (datos.omitidos > 0 ? ` · ${datos.omitidos} ya estaban.` : "."),
        );
        cerrar();
      },
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setAbierto(true)}
        className="h-auto w-full gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:w-auto"
      >
        <ClipboardPaste className="size-4" strokeWidth={2} />
        Importar de la hoja
      </Button>

      {abierto && (
        <Dialog open onOpenChange={(v) => !v && cerrar()}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Importar de «Facturas FRESA FIT»</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Copia el bloque de la hoja tal cual, con sus columnas:{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  Nombre · Monto · Met de pago · Fecha · Factura · Recibo
                </code>
                . La categoría se propone leyendo el concepto —revísala en la lista de abajo—. Lo que
                ya esté capturado con el mismo concepto, fecha y monto se omite.
              </p>

              <Textarea
                rows={7}
                autoFocus
                className="font-mono text-[12.5px]"
                placeholder={
                  "Etiquetas termicas\t$ 454.93\tTC Mercado Pago\t6 / jul / 26\tSi\tAun no\n" +
                  "Nominas 1ra Julio 2026\t$ 35,750.00\tTransferencia\t15 / jul / 26\tSi\tSi"
                }
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />

              {filas.length > 0 && (
                <>
                  <p className="text-[13px] text-muted-foreground">
                    {filas.length} {filas.length === 1 ? "gasto" : "gastos"} ·{" "}
                    <b className="text-foreground">{formatearMXN(total)}</b> en total.
                  </p>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Fecha</th>
                          <th className="px-3 py-2 font-semibold">Concepto</th>
                          <th className="px-3 py-2 font-semibold">Monto</th>
                          <th className="px-3 py-2 font-semibold">Categoría</th>
                          <th className="px-3 py-2 font-semibold">Factura</th>
                          <th className="px-3 py-2 font-semibold">Recibo</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filas.map((f, i) => {
                          const cat = obtenerCategoriaGasto(f.categoria);
                          const fac = obtenerEstadoComprobante(f.factura);
                          const rec = obtenerEstadoComprobante(f.recibo);
                          return (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-2 text-muted-foreground">
                                {formatearFecha(f.fecha)}
                              </td>
                              <td className="px-3 py-2 font-medium">
                                {f.concepto}
                                {f.metodo_pago && (
                                  <span className="block text-[11px] text-muted-foreground">
                                    {f.metodo_pago}
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-2 tabular-nums">{formatearMXN(f.monto)}</td>
                              <td className="px-3 py-2">
                                {cat && <Pastilla nombre={cat.nombre} color={cat.color} />}
                              </td>
                              <td className="px-3 py-2">
                                {fac && <Pastilla nombre={fac.nombre} color={fac.color} />}
                              </td>
                              <td className="px-3 py-2">
                                {rec && <Pastilla nombre={rec.nombre} color={rec.color} />}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={cerrar} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={importar} disabled={pending || !filas.length}>
                {pending
                  ? "Importando…"
                  : `Importar ${filas.length || ""} ${filas.length === 1 ? "gasto" : "gastos"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

function parsear(texto: string): FilaGastoInput[] {
  const hoy = hoyISO();
  return parsearTSV(texto, ENCABEZADOS)
    .map((celdas): FilaGastoInput | null => {
      const [concepto = "", monto = "", metodo = "", fechaCruda = "", factura = "", recibo = ""] =
        celdas;
      if (!concepto.trim()) return null;

      const importe = parsearNumero(monto);
      const fecha = parsearFecha(fechaCruda, hoy);
      /* Sin monto o sin fecha no es un gasto: son los renglones de separación
         que la hoja usa entre bloques. */
      if (importe == null || importe < 0 || !fecha) return null;

      return {
        fecha,
        concepto: concepto.trim(),
        monto: importe,
        categoria: categoriaDe(concepto),
        metodo_pago: metodo.trim(),
        factura: comprobanteDe(factura),
        recibo: comprobanteDe(recibo),
      };
    })
    .filter((f): f is FilaGastoInput => f !== null);
}
