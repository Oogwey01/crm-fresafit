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
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  importarPersonalizados,
  type FilaPersonalizadoInput,
} from "@/app/(app)/personalizados/actions";
import { MODELOS_PERSONALIZADO, obtenerEstadoPersonalizado } from "@/lib/catalogos";
import { formatearFecha, hoyISO } from "@/lib/fecha";
import { norm, parsearFecha, parsearTSV } from "@/lib/importar/tsv";
import type { ModeloPersonalizadoId } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Las columnas de la hoja «Personalizados FRESA FIT» y con qué nombres las
   busca el importador. Se mapea POR ENCABEZADO y no por posición porque la
   columna DISEÑO son imágenes incrustadas: al copiar de Sheets viaja como celda
   vacía y desalinearía todo lo que va después. */
const COLUMNAS: Record<keyof Mapa, string[]> = {
  no_venta: ["numero de venta", "no de venta", "num de venta", "venta"],
  cliente: ["nombre", "cliente"],
  modelo: ["tipo de cinto", "tipo de cinturon", "tipo"],
  talla: ["talla"],
  compra: ["compra", "fecha de compra"],
  produccion: ["produccion", "fecha de produccion"],
  limite: ["fecha limite", "limite", "fecha de entrega"],
  url: ["link", "enlace", "url"],
  notas: ["notas", "nota", "observaciones"],
};

type Mapa = {
  no_venta: number;
  cliente: number;
  modelo: number;
  talla: number;
  compra: number;
  produccion: number;
  limite: number;
  url: number;
  notas: number;
};

/* Orden de la hoja cuando alguien pega el bloque sin el encabezado. */
const ORDEN: Mapa = {
  no_venta: 0,
  cliente: 1,
  modelo: 3, // el 2 es la imagen del diseño
  talla: 4,
  compra: 5,
  produccion: 6,
  limite: 7,
  url: 8,
  notas: 9,
};

type FilaPreview = {
  input: FilaPersonalizadoInput;
  /* La fecha venía sin año ("19 jul") y hubo que deducirlo. */
  dedujoAnio: boolean;
};

export function ImportarPersonalizados() {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const { pending, ejecutar } = useAccionServidor();

  const filas = useMemo(() => (abierto ? parsear(texto) : []), [abierto, texto]);
  const deducidas = filas.filter((f) => f.dedujoAnio).length;

  function cerrar() {
    setAbierto(false);
    setTexto("");
  }

  function importar() {
    if (!filas.length) {
      toast.error("No hay renglones con nombre de cliente para importar.");
      return;
    }
    ejecutar(() => importarPersonalizados(filas.map((f) => f.input)), {
      error: "No se pudo importar. Revisa tu conexión.",
      alExito: (r) => {
        const datos = "datos" in r ? r.datos : { creados: 0, omitidos: 0 };
        toast.success(
          `${datos.creados} ${datos.creados === 1 ? "personalizado importado" : "personalizados importados"}` +
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
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Importar de «Personalizados FRESA FIT»</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Copia el bloque de la hoja <b>incluyendo el renglón de encabezados</b> (
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  NUMERO DE VENTA · NOMBRE · DISEÑO · TIPO DE CINTO · TALLA · COMPRA · PRODUCCIÓN ·
                  FECHA LIMITE · LINK · NOTAS
                </code>
                ). Las imágenes del diseño no viajan al copiar: se suben después, ficha por ficha.
              </p>

              <Textarea
                rows={7}
                autoFocus
                className="font-mono text-[12.5px]"
                placeholder={
                  "NUMERO DE VENTA\tNOMBRE\tDISEÑO\tTIPO DE CINTO\tTALLA\tCOMPRA\tPRODUCCIÓN\tFECHA LIMITE\tLINK\tNOTAS\n" +
                  "#4327\tRené Gabriel Ruiz Contreras\t\tPowerlift\tCHM\t\t19 jul\t19 ago\thttps://…\t"
                }
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />

              {deducidas > 0 && (
                <p className="text-[13px] text-amber-600">
                  {deducidas} {deducidas === 1 ? "fecha venía" : "fechas venían"} sin año en la hoja
                  («19 jul»). Abajo está el año que se dedujo; revísalo antes de importar.
                </p>
              )}

              {filas.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Venta</th>
                        <th className="px-3 py-2 font-semibold">Cliente</th>
                        <th className="px-3 py-2 font-semibold">Cinto</th>
                        <th className="px-3 py-2 font-semibold">Producción</th>
                        <th className="px-3 py-2 font-semibold">Fecha límite</th>
                        <th className="px-3 py-2 font-semibold">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 font-mono text-[12px]">
                            {f.input.no_venta || "—"}
                          </td>
                          <td className="px-3 py-2 font-medium">{f.input.cliente}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {[
                              MODELOS_PERSONALIZADO.find((m) => m.id === f.input.modelo)?.nombre,
                              f.input.talla,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </td>
                          <td className={cn("px-3 py-2", f.dedujoAnio && "text-amber-600")}>
                            {f.input.fecha_produccion
                              ? formatearFecha(f.input.fecha_produccion)
                              : "—"}
                          </td>
                          <td className={cn("px-3 py-2", f.dedujoAnio && "text-amber-600")}>
                            {f.input.fecha_limite ? formatearFecha(f.input.fecha_limite) : "—"}
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {obtenerEstadoPersonalizado(f.input.estado)?.nombre ?? f.input.estado}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={cerrar} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={importar} disabled={pending || !filas.length}>
                {pending
                  ? "Importando…"
                  : `Importar ${filas.length || ""} ${filas.length === 1 ? "pedido" : "pedidos"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/* --- Interpretación del bloque pegado ------------------------------------- */

function modeloDe(celda: string): ModeloPersonalizadoId | null {
  const t = norm(celda);
  if (!t) return null;
  const encontrado = MODELOS_PERSONALIZADO.find((m) => t.includes(norm(m.nombre)));
  return encontrado ? encontrado.id : "otro";
}

/* ¿El primer renglón es el encabezado de la hoja? Si lo es, sirve para mapear
   las columnas por nombre; si no, se cae al orden fijo de la hoja. */
function mapearColumnas(primera: string[]): Mapa | null {
  const celdas = primera.map(norm);
  if (!celdas.some((c) => COLUMNAS.cliente.includes(c))) return null;

  const buscar = (nombres: string[]) => celdas.findIndex((c) => nombres.includes(c));
  const mapa = {} as Mapa;
  for (const clave of Object.keys(COLUMNAS) as (keyof Mapa)[]) {
    mapa[clave] = buscar(COLUMNAS[clave]);
  }
  return mapa;
}

function parsear(texto: string): FilaPreview[] {
  const filas = parsearTSV(texto);
  if (!filas.length) return [];

  const conEncabezado = mapearColumnas(filas[0]);
  const mapa = conEncabezado ?? ORDEN;
  const cuerpo = conEncabezado ? filas.slice(1) : filas;
  const hoy = hoyISO();

  /* Una celda que no existe en el mapa (índice −1) es una columna que la hoja
     de esta persona no trae: se lee como vacía en vez de romper. */
  const celda = (fila: string[], i: number) => (i >= 0 ? (fila[i] ?? "") : "");
  const sinAnio = (s: string) => /^\s*\d{1,2}\s*[/\s.-]+[a-zA-Z]+\.?\s*$/.test(s);

  return cuerpo
    .map((fila): FilaPreview | null => {
      const cliente = celda(fila, mapa.cliente).trim();
      if (!cliente) return null;

      const crudoProd = celda(fila, mapa.produccion);
      const crudoLim = celda(fila, mapa.limite);
      const produccion = parsearFecha(crudoProd, hoy);

      return {
        input: {
          no_venta: celda(fila, mapa.no_venta).trim(),
          cliente,
          modelo: modeloDe(celda(fila, mapa.modelo)),
          talla: celda(fila, mapa.talla).trim(),
          fecha_compra: parsearFecha(celda(fila, mapa.compra), hoy),
          fecha_produccion: produccion,
          fecha_limite: parsearFecha(crudoLim, hoy),
          url: celda(fila, mapa.url).trim(),
          /* El estado real vive en el COLOR de la celda y el color no se copia:
             se deduce lo único que la hoja sí dice en texto —si ya se mandó a
             producción— y desde ahí lo mueve quien lo trabaje. */
          estado: produccion ? "produccion" : "recibido",
          notas: celda(fila, mapa.notas).trim(),
        },
        dedujoAnio: sinAnio(crudoProd) || sinAnio(crudoLim),
      };
    })
    .filter((f): f is FilaPreview => f !== null);
}
