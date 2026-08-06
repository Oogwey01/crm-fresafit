"use client";

import { useMemo, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { coincide, terminosBusqueda } from "@/lib/busqueda";
import { matchProductoPorSku, normalizarSku } from "@/lib/importar/tsv";
import { cn } from "@/lib/utils";

/* ============================================================================
   Elegir una ficha del inventario escribiendo.
   ----------------------------------------------------------------------------
   Los SKUs de los componentes se capturaban a ciegas: se tecleaba «PRM001G» y
   hasta guardar no se sabía si esa ficha existía. Cuando no existe, el conjunto
   queda sin ligar y «Armables» no se puede calcular — el dato por el que se
   digitalizó la hoja.

   Aquí se escribe igual que antes (el SKU sigue siendo texto libre: hay piezas
   que todavía no tienen ficha), pero mientras se teclea salen las coincidencias
   del catálogo con su stock, y debajo del campo se dice si lo escrito quedó
   ligado a una ficha o no.
   ============================================================================ */

/* Lo que el selector necesita de un producto. Estructural a propósito: encaja
   con el catálogo ligero que ya cargan bodega e inventario. */
export type ProductoElegible = {
  id: string;
  nombre: string;
  variante: string | null;
  sku: string | null;
  stock: number;
  activo: boolean;
};

const MAX_RESULTADOS = 6;

export function etiquetaProducto(p: ProductoElegible): string {
  return p.variante ? `${p.nombre} · ${p.variante}` : p.nombre;
}

export function SelectorProducto({
  id,
  valor,
  productoId,
  productos,
  onCambio,
  placeholder = "SKU o nombre…",
  autoFocus,
  className,
}: {
  id?: string;
  /* El SKU tecleado. Controlado por quien use el componente. */
  valor: string;
  /* Ficha ya ligada, si la hay: se respeta aunque el SKU no case exacto. */
  productoId: string | null;
  productos: ProductoElegible[];
  /* Al escribir llega (texto, null); al elegir de la lista, (sku, id). */
  onCambio: (sku: string, productoId: string | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1); // -1 = ninguna resaltada

  /* Lo que ya está ligado manda; si no, se intenta casar el SKU tecleado, que
     es lo mismo que hace el servidor al guardar. Así lo que se ve en el campo es
     lo que se va a guardar. */
  const ligado = useMemo(() => {
    if (productoId) return productos.find((p) => p.id === productoId) ?? null;
    return matchProductoPorSku(valor, productos).producto;
  }, [productoId, valor, productos]);

  const opciones = useMemo(() => {
    const terminos = terminosBusqueda(valor);
    if (!terminos.length) return [];
    const objetivo = normalizarSku(valor);
    return productos
      /* Sin SKU no se puede ofrecer: el renglón que se guarda ES el SKU, y una
         ficha sin él dejaría un componente vacío que la BD rechaza. */
      .filter((p) => p.sku && coincide(terminos, p.sku, p.nombre, p.variante))
      /* Primero lo que de verdad se está buscando: la ficha cuyo SKU empieza
         como lo tecleado, y entre iguales, las activas. Sin esto, «PRM» sacaba
         primero cualquier ficha con «prm» perdido en el nombre. */
      .sort((a, b) => {
        const empieza = (p: ProductoElegible) =>
          objetivo && p.sku && normalizarSku(p.sku).startsWith(objetivo) ? 0 : 1;
        return (
          empieza(a) - empieza(b) ||
          Number(b.activo) - Number(a.activo) ||
          (a.sku ?? a.nombre).localeCompare(b.sku ?? b.nombre)
        );
      })
      .slice(0, MAX_RESULTADOS);
  }, [valor, productos]);

  const visible = abierto && opciones.length > 0;

  function elegir(p: ProductoElegible) {
    onCambio(p.sku ?? "", p.id);
    setAbierto(false);
    setActivo(-1);
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!opciones.length) return;
      e.preventDefault();
      if (!abierto) {
        setAbierto(true);
        setActivo(0);
        return;
      }
      const paso = e.key === "ArrowDown" ? 1 : -1;
      setActivo((i) => {
        const n = i + paso;
        if (n < 0) return opciones.length - 1;
        if (n >= opciones.length) return 0;
        return n;
      });
      return;
    }

    if (e.key === "Enter" && visible && activo >= 0) {
      /* Sin esto, Enter enviaría el diálogo con la ficha a medio elegir. */
      e.preventDefault();
      elegir(opciones[activo]);
      return;
    }

    if (e.key === "Escape" && visible) {
      /* La primera Escape cierra la lista, no el diálogo entero. */
      e.preventDefault();
      e.stopPropagation();
      setAbierto(false);
      setActivo(-1);
    }
  }

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <Input
        id={id}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-autocomplete="list"
        placeholder={placeholder}
        className="font-mono"
        value={valor}
        onChange={(e) => {
          /* Teclear desliga: el SKU manda mientras no se elija de la lista. */
          onCambio(e.target.value.toUpperCase(), null);
          setAbierto(true);
          setActivo(-1);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => {
          setAbierto(false);
          setActivo(-1);
        }}
        onKeyDown={alTeclear}
      />

      {/* Qué ficha quedó ligada. Es la diferencia entre que «Armables» salga o
          se quede en «—», así que se dice en el momento y no al guardar. */}
      {valor.trim() &&
        (ligado ? (
          <p className="mt-1 flex items-center gap-1 truncate text-[11.5px] text-muted-foreground">
            <Check className="size-3 shrink-0 text-emerald-600" strokeWidth={2.5} />
            <span className="truncate">{etiquetaProducto(ligado)}</span>
            <span className="shrink-0 tabular-nums">· {ligado.stock} en stock</span>
          </p>
        ) : (
          <p className="mt-1 flex items-center gap-1 text-[11.5px] text-amber-600 dark:text-amber-500">
            <TriangleAlert className="size-3 shrink-0" strokeWidth={2.2} />
            Sin ficha en inventario
          </p>
        ))}

      {visible && (
        <ul
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {opciones.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === activo}
              /* mousedown, no click: el blur del campo llegaría antes. */
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(p);
              }}
              onMouseEnter={() => setActivo(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                i === activo && "bg-accent",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12.5px] font-semibold">
                  {p.sku}
                  {!p.activo && (
                    <span className="ml-1.5 font-sans text-[11px] font-normal text-muted-foreground">
                      inactivo
                    </span>
                  )}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {etiquetaProducto(p)}
                </div>
              </div>
              <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                {p.stock} pz
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
