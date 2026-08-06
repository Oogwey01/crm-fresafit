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
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import {
  matchProductoPorSku,
  parsearCantidad,
  parsearNumero,
  parsearTSV,
  type MatchSku,
} from "@/lib/importar/tsv";
import type { ItemInicialPedido } from "@/components/proveedores/pedido-prov-dialog";
import { formatearMXN } from "@/lib/moneda";
import { cn } from "@/lib/utils";
import type { ProductoProveedor } from "@/lib/proveedores/tipos";

/* Los dos formatos en los que el equipo arma sus pedidos en Excel. Cambian tanto
   entre sí que un solo parser adivinando columnas se equivocaría: el de ropa es
   un renglón por talla y el de cintos es una matriz color × talla. */
const FORMATOS = [
  ["ropa", "Playeras / Tanks"],
  ["cintos", "Cintos por color"],
] as const;

type FormatoId = (typeof FORMATOS)[number][0];

const ENCABEZADOS: Record<FormatoId, string[]> = {
  ropa: ["DISEÑO", "SKU", "TALLA", "CALCULO PEDIDO", "COSTO (SIN IVA)", "COSTO SIN IVA", "COSTO"],
  cintos: ["Codigo", "Código", "Color", "CH", "M", "G", "EG"],
};

/* Tallas del formato de cintos, en el orden de las columnas de la hoja. */
const TALLAS_CINTOS = ["CH", "M", "G", "EG"] as const;

type FilaPreview = {
  /* Lo que se va a mandar al pedido. */
  item: ItemInicialPedido;
  /* Diagnóstico para la vista previa. */
  skuTexto: string;
  etiqueta: string; // diseño/color + talla
  match: MatchSku<ProductoProveedor>;
  cantidadOk: boolean;
};

/* Renglones de un pedido pegados desde la hoja de Excel. No inserta nada: arma
   los renglones y los entrega al diálogo de pedido, donde se elige proveedor y
   se guarda con el flujo de siempre. */
export function ImportarRenglonesPedido({
  productos,
  onListo,
}: {
  productos: ProductoProveedor[];
  /* Recibe los renglones ya emparejados para abrir el pedido nuevo. */
  onListo: (items: ItemInicialPedido[]) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [formato, setFormato] = useState<FormatoId>("ropa");
  const [texto, setTexto] = useState("");

  const filas = useMemo(
    () => (abierto ? parsear(texto, formato, productos) : []),
    [abierto, texto, formato, productos],
  );
  const ambiguas = filas.filter((f) => f.match.tipo === "ambiguo");
  const sinMatch = filas.filter((f) => f.match.tipo === "ninguno");

  function cerrar() {
    setAbierto(false);
    setTexto("");
  }

  function continuar() {
    if (!filas.length) {
      toast.error("No hay renglones que importar.");
      return;
    }
    onListo(filas.map((f) => f.item));
    cerrar();
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setAbierto(true)}
        className="h-auto w-full gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:w-auto"
      >
        <ClipboardPaste className="size-4" strokeWidth={2} />
        Pegar desde Excel
      </Button>

      {abierto && (
        <Dialog open onOpenChange={(v) => !v && cerrar()}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Pegar renglones desde Excel</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <ControlSegmentado opciones={FORMATOS} valor={formato} onCambio={setFormato} />

              <p className="text-sm text-muted-foreground">
                {formato === "ropa" ? (
                  <>
                    Copia las columnas de la hoja tal cual:{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      DISEÑO · SKU · TALLA · CALCULO PEDIDO · COSTO (SIN IVA)
                    </code>
                    . Un renglón por talla.
                  </>
                ) : (
                  <>
                    Copia las columnas de la hoja tal cual:{" "}
                    <code className="rounded bg-muted px-1 py-0.5 text-xs">
                      Codigo · Color · CH · M · G · EG
                    </code>
                    . Cada renglón se abre en un pedido por talla con cantidad.
                  </>
                )}
              </p>

              <Textarea
                rows={7}
                autoFocus
                className="font-mono text-[12.5px]"
                placeholder={
                  formato === "ropa"
                    ? "Olimpo V2\tPLY001\tG\t20\t185.50\nBerserk V2\tPLY002\tEG\t15\t185.50"
                    : "PRM001\tRojo salsa\t20\t20\t20\t10\nPRM002\tMedia noche\t20\t20\t20\t10"
                }
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />

              {(ambiguas.length > 0 || sinMatch.length > 0) && (
                <p className="text-[13px] text-amber-600">
                  {sinMatch.length > 0 && (
                    <>
                      {sinMatch.length}{" "}
                      {sinMatch.length === 1 ? "renglón no coincide" : "renglones no coinciden"} con
                      ningún SKU del catálogo: entran como texto libre.{" "}
                    </>
                  )}
                  {ambiguas.length > 0 && (
                    <>
                      {ambiguas.length} {ambiguas.length === 1 ? "tiene" : "tienen"} SKU repetido en
                      el catálogo: quedan como texto libre para que elijas el producto en el pedido.
                    </>
                  )}
                </p>
              )}

              {filas.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">SKU</th>
                        <th className="px-3 py-2 font-semibold">Producto</th>
                        <th className="px-3 py-2 font-semibold">Cantidad</th>
                        <th className="px-3 py-2 font-semibold">Costo c/u</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 font-mono text-[12.5px]">{f.skuTexto || "—"}</td>
                          <td
                            className={cn(
                              "px-3 py-2",
                              f.match.tipo !== "exacto" && "text-amber-600",
                            )}
                          >
                            {f.match.producto
                              ? `${f.match.producto.nombre}${f.match.producto.variante ? ` · ${f.match.producto.variante}` : ""}`
                              : f.item.descripcion}
                            {f.match.tipo === "parcial" && (
                              <span className="block text-[11px]">coincidencia aproximada</span>
                            )}
                            {f.match.tipo === "ambiguo" && (
                              <span className="block text-[11px]">
                                {f.match.candidatos.length} productos con ese SKU → elígelo en el pedido
                              </span>
                            )}
                            {f.match.tipo === "ninguno" && (
                              <span className="block text-[11px]">sin ficha → renglón libre</span>
                            )}
                          </td>
                          <td className={cn("px-3 py-2 tabular-nums", !f.cantidadOk && "text-amber-600")}>
                            {f.item.cantidad}
                          </td>
                          <td className="px-3 py-2 tabular-nums">
                            {f.item.costo_unitario != null
                              ? formatearMXN(f.item.costo_unitario)
                              : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={cerrar}>
                Cancelar
              </Button>
              <Button onClick={continuar} disabled={!filas.length}>
                Continuar con {filas.length || ""}{" "}
                {filas.length === 1 ? "renglón" : "renglones"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/* ---------------------------------------------------------------------------
   Parseo por formato. Nunca se descarta una fila con cantidad: lo que no
   empareja entra como renglón de texto libre, que el pedido ya soporta.
   --------------------------------------------------------------------------- */
function parsear(texto: string, formato: FormatoId, productos: ProductoProveedor[]): FilaPreview[] {
  const filas = parsearTSV(texto, ENCABEZADOS[formato]);
  return formato === "ropa" ? parsearRopa(filas, productos) : parsearCintos(filas, productos);
}

function parsearRopa(filas: string[][], productos: ProductoProveedor[]): FilaPreview[] {
  const salida: FilaPreview[] = [];
  for (const celdas of filas) {
    const [diseno = "", sku = "", talla = "", cantTxt = "", costoTxt = ""] = celdas;
    const cantidad = parsearCantidad(cantTxt);
    /* Sin SKU ni diseño no hay nada que pedir; sin cantidad tampoco (en la hoja
       hay renglones de talla que quedaron en blanco). */
    if (!sku && !diseno) continue;
    if (!cantidad) continue;

    const match = matchProductoPorSku(sku, productos);
    const etiqueta = [diseno, talla].filter(Boolean).join(" ");
    salida.push({
      item: {
        producto_id: match.producto?.id ?? null,
        descripcion: match.producto ? undefined : etiqueta || sku,
        cantidad,
        costo_unitario: parsearNumero(costoTxt),
      },
      skuTexto: sku,
      etiqueta,
      match,
      cantidadOk: parsearCantidad(cantTxt) !== null,
    });
  }
  return salida;
}

/* La hoja de cintos es una matriz: un renglón por color y una columna por talla.
   Cada celda con cantidad se convierte en su propio renglón del pedido. */
function parsearCintos(filas: string[][], productos: ProductoProveedor[]): FilaPreview[] {
  const salida: FilaPreview[] = [];
  for (const celdas of filas) {
    const [codigo = "", color = "", ...cantidades] = celdas;
    if (!codigo && !color) continue;

    TALLAS_CINTOS.forEach((talla, i) => {
      const cantidad = parsearCantidad(cantidades[i] ?? "");
      if (!cantidad) return;

      /* El SKU de la hoja identifica el modelo; la talla vive en la variante del
         catálogo, así que se busca primero el SKU con talla y luego el base. */
      const conTalla = matchProductoPorSku(`${codigo}${talla}`, productos);
      /* Solo se confía en la coincidencia exacta CON talla: el mismo código en
         las cuatro columnas emparejaría siempre con la misma ficha y el pedido
         acabaría pidiendo cuatro veces la misma talla. */
      const exacto = conTalla.tipo === "exacto";
      const match: MatchSku<ProductoProveedor> = exacto
        ? conTalla
        : { producto: null, tipo: conTalla.tipo === "ambiguo" ? "ambiguo" : "ninguno", candidatos: conTalla.candidatos };
      const etiqueta = [color, talla].filter(Boolean).join(" ");
      salida.push({
        item: {
          producto_id: exacto ? (conTalla.producto?.id ?? null) : null,
          descripcion: exacto ? undefined : `${codigo} ${etiqueta}`.trim(),
          cantidad,
          costo_unitario: null,
        },
        skuTexto: `${codigo} ${talla}`,
        etiqueta,
        match,
        cantidadOk: true,
      });
    });
  }
  return salida;
}
