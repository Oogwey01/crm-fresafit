"use client";

import { Minus, Plus } from "lucide-react";
import { obtenerTipoProducto } from "@/lib/catalogos";
import { estadoStock } from "@/lib/inventario/stock";
import { tieneFull, stockFullDe, esTikTok, esTikTokDelegado, tiktokStockDe } from "@/lib/inventario/reabastecimiento";
import { BadgeStock } from "@/components/inventario/badge-stock";
import { Pastilla } from "@/components/compartido/pastilla";
import type { Product, ProductConProveedor } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Celdas del catálogo compartidas por las dos vistas de productos (la
   desglosada, con una fila por variante, y la agrupada por producto). Vivían
   dentro de tabla-productos.tsx; se sacaron aquí al añadir la vista agrupada
   para no tener dos copias que se separen con el tiempo. */

/* Pastilla suave: fondo del color del tipo al 12% de opacidad + texto sólido
   (en vez de fondo sólido + texto blanco), para verse ligera junto a las demás
   celdas de la tabla. */
export function PastillaTipo({ tipo }: { tipo: string }) {
  const t = obtenerTipoProducto(tipo);
  if (!t) return null;
  return <Pastilla nombre={t.nombre} color={t.color} />;
}

/* La miniatura de la portada se mudó a components/compartido/miniatura.tsx al
   necesitarla también el tablero de maquila. Se reexporta desde aquí para no
   tocar los dos import de las tablas de productos. */
export { Miniatura } from "@/components/compartido/miniatura";

/* Marcas de la ficha: dónde vive su inventario y si sigue reponiéndose.
   Se pide `Omit<…,"imagenes">` porque las listas del catálogo no cargan la
   galería (pesa ~950 KB) y estas marcas tampoco la necesitan. */
export function MarcasProducto({ p }: { p: Omit<Product, "imagenes"> }) {
  return (
    <>
      {tieneFull(p) && (
        <span
          className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
          title={
            stockFullDe(p) > 0
              ? `Mercado Full: ${stockFullDe(p)} piezas en un centro de Mercado Libre, aparte de la bodega.`
              : "Publicación en Mercado Full sin existencias en el centro de Mercado Libre."
          }
        >
          {/* Sin número mientras el depósito esté vacío: un «Full 0» se lee como
              un dato faltante y no como lo que es. */}
          Full{stockFullDe(p) > 0 ? ` ${stockFullDe(p)}` : ""}
        </span>
      )}
      {esTikTok(p) && (
        <span
          className="shrink-0 rounded-md bg-neutral-800 px-1.5 py-0.5 text-[10.5px] font-bold text-white dark:bg-neutral-200 dark:text-neutral-900"
          title={
            esTikTokDelegado(p)
              ? "TikTok Shop: inventario delegado (aparte de la bodega). No se suma al stock unificado."
              : `TikTok Shop: ${tiktokStockDe(p)} piezas reportadas en esa publicación, aparte del stock de bodega.`
          }
        >
          {/* Delegado: su propio `stock` YA es este número, se ve en su columna.
              Multicanal: el `stock` de la fila es el de bodega, así que el
              número de TikTok solo se ve aquí. */}
          TikTok{!esTikTokDelegado(p) ? ` ${tiktokStockDe(p)}` : ""}
        </span>
      )}
      {/* La marca de descontinuado tiene que verse en la fila: si solo existe
          como ausencia en un filtro, no hay manera de confirmar que quedó
          puesta. Sigue vendible —conserva stock y publicaciones—, así que el
          tono es neutro y no de alerta. */}
      {p.descontinuado && (
        <span
          className="shrink-0 rounded-md bg-slate-200 px-1.5 py-0.5 text-[10.5px] font-bold text-slate-600 dark:bg-slate-700 dark:text-slate-200"
          title="Descontinuado: ya no se repone. Fuera de «Qué pedir» y de los avisos de stock bajo. Sigue vendiéndose mientras quede stock."
        >
          Descontinuado
        </span>
      )}
    </>
  );
}

/* Contador de stock con los botones −/+ y el semáforo. */
export function ControlStock({
  p,
  onCambiar,
  titulo,
}: {
  p: ProductConProveedor;
  onCambiar: (p: ProductConProveedor, delta: number) => void;
  titulo?: string;
}) {
  const estado = estadoStock(p);
  return (
    <div className="flex items-center gap-1.5" title={titulo}>
      <button
        type="button"
        onClick={() => onCambiar(p, -1)}
        disabled={p.stock === 0}
        className="flex size-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent disabled:opacity-40"
        aria-label={`Restar 1 al stock de ${p.nombre}`}
      >
        <Minus className="size-3.5" />
      </button>
      <span
        className={cn(
          "min-w-8 text-center font-semibold tabular-nums",
          estado === "agotado" && "text-red-600",
          estado === "por_acabarse" && "text-amber-600",
        )}
      >
        {p.stock}
      </span>
      <button
        type="button"
        onClick={() => onCambiar(p, 1)}
        className="flex size-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
        aria-label={`Sumar 1 al stock de ${p.nombre}`}
      >
        <Plus className="size-3.5" />
      </button>
      <BadgeStock producto={p} />
    </div>
  );
}
