"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FilterX } from "lucide-react";
import { agruparEnFamilias } from "@/lib/inventario/familia";
import { estadoStock } from "@/lib/inventario/stock";
import { portadaProducto } from "@/lib/inventario/fotos";
import { tallaDeVariante } from "@/lib/talla";
import { formatearMXN } from "@/lib/moneda";
import { Button } from "@/components/ui/button";
import { useAjusteStock } from "@/components/inventario/usar-ajuste-stock";
import {
  ControlStock,
  MarcasProducto,
  Miniatura,
  PastillaTipo,
} from "@/components/inventario/celdas-producto";
import type { ProductConProveedor } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Vista AGRUPADA del catálogo: una fila por producto real, con sus tallas
   plegadas dentro.

   Es lo que pidió Armando: "los cinturones tienen hasta cuatro tallas… que si
   busco un producto y le pico, se desglosen todas las tallas y el inventario
   actual". La vista desglosada de siempre sigue estando; ésta es la otra mitad
   del control «Desglosado / Agrupado». */

export function TablaProductosAgrupada({
  productos,
  totalCatalogo,
  busqueda,
  filtroTipo,
  filtroStock,
  filtrosActivos,
  onLimpiarFiltros,
  escrituraCanales,
  verPrecio,
  onAbrir,
}: {
  productos: ProductConProveedor[];
  totalCatalogo: number;
  busqueda: string;
  filtroTipo: string;
  filtroStock: string;
  filtrosActivos: string[];
  onLimpiarFiltros: () => void;
  escrituraCanales: boolean;
  /* El precio de lista es ingreso: sin permiso la columna se va entera, igual
     que en la vista desglosada. */
  verPrecio: boolean;
  onAbrir: (p: ProductConProveedor) => void;
}) {
  const { cambiarStock, tituloAjuste } = useAjusteStock(escrituraCanales);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());

  const q = busqueda.trim().toLowerCase();
  const visibles = productos.filter(
    (p) =>
      (filtroTipo === "todos" || p.tipo === filtroTipo) &&
      (filtroStock === "todos" || estadoStock(p) === filtroStock) &&
      (!q ||
        p.nombre.toLowerCase().includes(q) ||
        (p.sku ?? "").toLowerCase().includes(q) ||
        (p.variante ?? "").toLowerCase().includes(q) ||
        (p.proveedor?.nombre ?? "").toLowerCase().includes(q)),
  );

  const familias = agruparEnFamilias(visibles);

  if (familias.length === 0) {
    if (totalCatalogo === 0) {
      return (
        <p className="text-sm italic text-muted-foreground">
          Aún no hay productos. Da de alta el primero con «+ Nuevo producto».
        </p>
      );
    }
    return (
      <div className="flex flex-col items-start gap-2.5 rounded-xl border bg-muted/30 px-4 py-3.5">
        <p className="text-sm text-muted-foreground">
          Ningún producto coincide con lo que tienes filtrado.
          {filtrosActivos.length > 0 && (
            <>
              {" "}
              Activo ahora: <b className="font-semibold text-foreground">{filtrosActivos.join(" · ")}</b>.
            </>
          )}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={onLimpiarFiltros}
          className="gap-1.5 rounded-[10px] text-[13px] font-semibold"
        >
          <FilterX className="size-[15px]" strokeWidth={1.9} aria-hidden="true" />
          Limpiar filtros
        </Button>
      </div>
    );
  }

  function alternar(clave: string) {
    setAbiertas((prev) => {
      const s = new Set(prev);
      if (s.has(clave)) s.delete(clave);
      else s.add(clave);
      return s;
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] text-muted-foreground">
        Mostrando {visibles.length} de {totalCatalogo} productos
        {familias.length !== visibles.length ? ` (${familias.length} agrupados)` : ""}
      </p>
      <div className="overflow-hidden rounded-xl border">
        {/* Cabecera (solo escritorio: en móvil cada fila ya se explica sola) */}
        <div
          className={cn(
            "hidden gap-3 border-b bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid",
            verPrecio ? "grid-cols-[1fr_130px_110px_150px]" : "grid-cols-[1fr_130px_150px]",
          )}
        >
          <div>Producto</div>
          <div>Tipo</div>
          {verPrecio && <div>Precio</div>}
          <div>Stock total</div>
        </div>

        {familias.map((f) => {
          const abierta = abiertas.has(f.clave);
          const unaSola = f.variantes.length === 1;
          const principal = f.variantes[0];
          /* Con una sola variante no hay nada que desplegar: la fila se comporta
             igual que en la vista desglosada y abre la ficha directamente. */
          const precio =
            f.precioMin == null
              ? "—"
              : f.precioMin === f.precioMax
                ? formatearMXN(f.precioMin)
                : `${formatearMXN(f.precioMin)} – ${formatearMXN(f.precioMax)}`;

          return (
            <div key={f.clave} className="border-b last:border-b-0">
              {/* Fila del producto */}
              <div
                className={cn(
                  "grid grid-cols-1 items-center gap-2 px-3 py-2.5 md:gap-3",
                  verPrecio
                    ? "md:grid-cols-[1fr_130px_110px_150px]"
                    : "md:grid-cols-[1fr_130px_150px]",
                  abierta && "bg-muted/30",
                )}
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  {unaSola ? (
                    <span className="size-5 shrink-0" aria-hidden="true" />
                  ) : (
                    <button
                      type="button"
                      onClick={() => alternar(f.clave)}
                      aria-expanded={abierta}
                      aria-label={`${abierta ? "Ocultar" : "Ver"} las tallas de ${f.nombre}`}
                      className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {abierta ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                    </button>
                  )}
                  <Miniatura src={portadaProducto(principal)} alt={f.nombre} tam="size-14 md:size-24" />
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => (unaSola ? onAbrir(principal) : alternar(f.clave))}
                      className="block max-w-full truncate text-left text-[14px] font-medium hover:underline"
                      title={f.nombre}
                    >
                      {f.nombre}
                    </button>
                    <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
                      {unaSola ? (
                        <span className="truncate">{principal.variante ?? principal.sku ?? "—"}</span>
                      ) : (
                        <span>
                          {f.variantes.length}{" "}
                          {f.tallas.length > 0
                            ? `tallas · ${f.tallas.join(", ")}`
                            : "variantes"}
                        </span>
                      )}
                    </div>
                  </div>
                  {unaSola && <MarcasProducto p={principal} />}
                </div>

                <div className="hidden md:block">
                  <PastillaTipo tipo={principal.tipo} />
                </div>
                {verPrecio && (
                  <div className="hidden text-[13.5px] tabular-nums md:block">{precio}</div>
                )}

                {/* Con una sola variante se puede ajustar aquí mismo; con varias,
                    el total es de solo lectura (no se sabe a qué talla sumarle). */}
                {unaSola ? (
                  <ControlStock p={principal} onCambiar={cambiarStock} titulo={tituloAjuste} />
                ) : (
                  <div className="flex items-center gap-2 text-[13.5px]">
                    <span
                      className={cn(
                        "font-semibold tabular-nums",
                        f.stock === 0 && "text-red-600",
                      )}
                    >
                      {f.stock}
                    </span>
                    <span className="text-muted-foreground">
                      en {f.variantes.length} {f.variantes.length === 1 ? "talla" : "tallas"}
                    </span>
                  </div>
                )}
              </div>

              {/* Tallas desplegadas */}
              {abierta && !unaSola && (
                <div className="border-t bg-muted/20">
                  {f.variantes.map((p) => {
                    const talla = tallaDeVariante(p.variante);
                    return (
                      <div
                        key={p.id}
                        className={cn(
                          "grid grid-cols-1 items-center gap-2 border-b border-border/50 px-3 py-2 pl-10 last:border-b-0 md:gap-3",
                          verPrecio
                            ? "md:grid-cols-[1fr_130px_110px_150px]"
                            : "md:grid-cols-[1fr_130px_150px]",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onAbrir(p)}
                            className="min-w-0 truncate text-left text-[13.5px] hover:underline"
                            title={`${p.nombre}${p.variante ? ` — ${p.variante}` : ""}`}
                          >
                            <span className="font-medium">{talla ?? p.variante ?? "Única"}</span>
                            {p.sku && (
                              <span className="ml-2 font-mono text-[12px] text-muted-foreground">
                                {p.sku}
                              </span>
                            )}
                            {!p.activo && (
                              <span className="ml-1.5 text-xs italic text-muted-foreground">(inactivo)</span>
                            )}
                          </button>
                          <MarcasProducto p={p} />
                        </div>
                        <div className="hidden md:block" />
                        {verPrecio && (
                          <div className="hidden text-[13px] tabular-nums text-muted-foreground md:block">
                            {formatearMXN(p.precio)}
                          </div>
                        )}
                        <ControlStock p={p} onCambiar={cambiarStock} titulo={tituloAjuste} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
