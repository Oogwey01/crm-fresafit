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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { importarInsumos, type FilaRecursoInput } from "@/app/(app)/bodega/actions";
import { CATEGORIAS_INSUMO, obtenerCategoriaInsumo } from "@/lib/catalogos";
import { formatearMXN } from "@/lib/moneda";
import { norm, parsearCantidad, parsearNumero, parsearTSV } from "@/lib/importar/tsv";
import type { CategoriaInsumoId } from "@/lib/types";

/* Cada bloque de la hoja «Recursos FRESA FIT» tiene los mismos encabezados,
   salvo SOBRES, que llama a lo mismo TOTAL UNIDADES y MINIMO A TENER. Se mapea
   por nombre para que dé igual cuál se pegue. */
const COLUMNAS: Record<keyof Mapa, string[]> = {
  empresa: ["empresa", "proveedor"],
  titulo: ["titulo", "título", "nombre"],
  dimensiones: ["dimensiones", "medidas"],
  precio: ["precio"],
  unidades: ["unidades p/paquete", "unidades p paquete", "unidades por paquete", "unidades"],
  reserva: ["reserva", "reservado", "apartado"],
  pedido: ["pedido", "pedidos"],
  stock: ["disponible", "total unidades", "existencia"],
  minimo: ["minimo", "mínimo", "minimo a tener", "mínimo a tener"],
  maximo: ["maximo", "máximo"],
  link: ["link", "enlace", "url"],
};

type Mapa = {
  empresa: number;
  titulo: number;
  dimensiones: number;
  precio: number;
  unidades: number;
  reserva: number;
  pedido: number;
  stock: number;
  minimo: number;
  maximo: number;
  link: number;
};

/* Orden de la hoja cuando se pega sin encabezado. La columna PRECIO P/UNIDAD va
   entre `unidades` y `reserva`: aquí se ignora porque se calcula. */
const ORDEN: Mapa = {
  empresa: 0,
  titulo: 1,
  dimensiones: 2,
  precio: 3,
  unidades: 4,
  reserva: 6,
  pedido: 7,
  stock: 8,
  minimo: 9,
  maximo: 10,
  link: 11,
};

/* Alta en lote de una sección de la hoja de recursos. Una fila es una
   presentación; varias filas con el mismo título son el mismo insumo comprado
   en distintas medidas —así está la hoja, con celdas combinadas—. */
export function ImportarInsumos() {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [categoria, setCategoria] = useState<CategoriaInsumoId>("bolsas");
  const { pending, ejecutar } = useAccionServidor();

  const filas = useMemo(() => (abierto ? parsear(texto, categoria) : []), [abierto, texto, categoria]);
  const insumosDistintos = new Set(filas.map((f) => f.nombre.toLowerCase())).size;

  function cerrar() {
    setAbierto(false);
    setTexto("");
  }

  function importar() {
    if (!filas.length) {
      toast.error("No hay renglones con título para importar.");
      return;
    }
    ejecutar(() => importarInsumos(categoria, filas), {
      error: "No se pudo importar. Revisa tu conexión.",
      alExito: (r) => {
        const datos = "datos" in r ? r.datos : { creados: 0, presentaciones: 0, omitidos: 0 };
        toast.success(
          `${datos.creados} ${datos.creados === 1 ? "insumo creado" : "insumos creados"} con ` +
            `${datos.presentaciones} ${datos.presentaciones === 1 ? "presentación" : "presentaciones"}` +
            (datos.omitidos > 0 ? ` · ${datos.omitidos} ya estaban.` : "."),
        );
        cerrar();
      },
    });
  }

  return (
    <>
      <Button variant="outline" onClick={() => setAbierto(true)}>
        <ClipboardPaste className="size-4" strokeWidth={2} />
        Pegar de la hoja
      </Button>

      {abierto && (
        <Dialog open onOpenChange={(v) => !v && cerrar()}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle>Importar de «Recursos FRESA FIT»</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Pega un bloque de la hoja con su renglón de encabezados (
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  EMPRESA · TITULO · DIMENSIONES · PRECIO · UNIDADES P/PAQUETE · … · DISPONIBLE ·
                  MINIMO · MAXIMO · LINK
                </code>
                ). Un bloque a la vez: la sección la eliges aquí porque en la hoja es la barra de
                color, que no viaja al copiar. Lo que ya exista con el mismo nombre se omite.
              </p>

              <div className="flex flex-col gap-1.5">
                <Label>Sección</Label>
                <Select
                  value={categoria}
                  onValueChange={(v) => v && setCategoria(v as CategoriaInsumoId)}
                >
                  <SelectTrigger className="w-full sm:w-[260px]">
                    <SelectValue>
                      {(v: string) => obtenerCategoriaInsumo(v)?.nombre ?? "Sección"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CATEGORIAS_INSUMO.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <Textarea
                rows={7}
                className="font-mono text-[12.5px]"
                placeholder={
                  "EMPRESA\tTITULO\tDIMENSIONES\tPRECIO\tUNIDADES P/PAQUETE\tPRECIO P/UNIDAD\tRESERVA\tPEDIDO\tDISPONIBLE\tMINIMO\tMAXIMO\tLINK\n" +
                  "Castipack\tAccesorios\t20 x 28 cm\t$164.68\t100\t$1.65\t0\t0\t1200\t1000\t2000\t"
                }
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />

              {filas.length > 0 && (
                <>
                  <p className="text-[13px] text-muted-foreground">
                    {filas.length} {filas.length === 1 ? "renglón" : "renglones"} →{" "}
                    {insumosDistintos} {insumosDistintos === 1 ? "insumo" : "insumos"} (los renglones
                    con el mismo título se agrupan como presentaciones del mismo).
                  </p>
                  <div className="overflow-x-auto rounded-lg border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2 font-semibold">Insumo</th>
                          <th className="px-3 py-2 font-semibold">Presentación</th>
                          <th className="px-3 py-2 font-semibold">Precio</th>
                          <th className="px-3 py-2 font-semibold">Por unidad</th>
                          <th className="px-3 py-2 font-semibold">Hay</th>
                          <th className="px-3 py-2 font-semibold">Mín · máx</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filas.map((f, i) => (
                          <tr key={i} className="border-t">
                            <td className="px-3 py-2">
                              <span className="font-medium">{f.nombre}</span>
                              <span className="block text-[11px] text-muted-foreground">
                                {[f.empresa, f.dimensiones].filter(Boolean).join(" · ") || "—"}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted-foreground">
                              {f.unidades > 1 ? `${f.unidades} piezas` : "pieza"}
                            </td>
                            <td className="px-3 py-2 tabular-nums">{formatearMXN(f.precio)}</td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {f.precio != null && f.unidades > 0
                                ? formatearMXN(f.precio / f.unidades)
                                : "—"}
                            </td>
                            <td className="px-3 py-2 tabular-nums">{f.stock ?? "—"}</td>
                            <td className="px-3 py-2 tabular-nums text-muted-foreground">
                              {f.minimo ?? "—"}
                              {f.maximo != null ? ` · ${f.maximo}` : ""}
                            </td>
                          </tr>
                        ))}
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
                  : `Importar ${insumosDistintos || ""} ${insumosDistintos === 1 ? "insumo" : "insumos"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/* --- Interpretación del bloque pegado ------------------------------------- */

function mapearColumnas(primera: string[]): Mapa | null {
  const celdas = primera.map(norm);
  if (!celdas.some((c) => COLUMNAS.titulo.includes(c))) return null;

  const buscar = (nombres: string[]) => celdas.findIndex((c) => nombres.includes(c));
  const mapa = {} as Mapa;
  for (const clave of Object.keys(COLUMNAS) as (keyof Mapa)[]) mapa[clave] = buscar(COLUMNAS[clave]);
  return mapa;
}

/* La unidad se deduce de la sección: la hoja no la trae y "1200 piezas" se lee
   peor que "1200 bolsas" en la pantalla de bodega. */
const UNIDAD_POR_SECCION: Record<string, string> = {
  bolsas: "bolsa",
  etiquetas: "etiqueta",
  sobres: "sobre",
  cintas: "rollo",
  cajas: "caja",
};

function parsear(texto: string, categoria: CategoriaInsumoId): FilaRecursoInput[] {
  const filas = parsearTSV(texto);
  if (!filas.length) return [];

  const conEncabezado = mapearColumnas(filas[0]);
  const mapa = conEncabezado ?? ORDEN;
  const cuerpo = conEncabezado ? filas.slice(1) : filas;

  const celda = (fila: string[], i: number) => (i >= 0 ? (fila[i] ?? "") : "");

  /* En la hoja el TITULO solo aparece en el primer renglón del grupo (celdas
     combinadas): los siguientes lo heredan, que es lo que ve el ojo. */
  let ultimoTitulo = "";

  return cuerpo
    .map((fila): FilaRecursoInput | null => {
      const titulo = celda(fila, mapa.titulo).trim() || ultimoTitulo;
      if (!titulo) return null;
      ultimoTitulo = titulo;

      return {
        nombre: titulo,
        empresa: celda(fila, mapa.empresa).trim(),
        dimensiones: celda(fila, mapa.dimensiones).trim(),
        unidad: UNIDAD_POR_SECCION[categoria] ?? "pieza",
        unidades: parsearCantidad(celda(fila, mapa.unidades)) ?? 1,
        precio: parsearNumero(celda(fila, mapa.precio)),
        reserva: parsearNumero(celda(fila, mapa.reserva)) ?? 0,
        pedido: parsearNumero(celda(fila, mapa.pedido)) ?? 0,
        stock: parsearNumero(celda(fila, mapa.stock)),
        minimo: parsearNumero(celda(fila, mapa.minimo)),
        maximo: parsearNumero(celda(fila, mapa.maximo)),
        link: celda(fila, mapa.link).trim(),
      };
    })
    .filter((f): f is FilaRecursoInput => f !== null);
}
