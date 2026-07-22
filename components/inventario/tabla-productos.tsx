"use client";

import { useTransition } from "react";
import { Image as ImageIcon, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { obtenerTipoProducto } from "@/lib/catalogos";
import { estadoStock } from "@/lib/inventario/stock";
import { esFull } from "@/lib/inventario/reabastecimiento";
import { portadaProducto } from "@/lib/inventario/fotos";
import { formatearMXN } from "@/lib/moneda";
import { BadgeStock } from "@/components/inventario/badge-stock";
import { ajustarStock } from "@/app/(app)/inventario/actions";
import type { ProductConProveedor } from "@/lib/types";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[minmax(180px,1fr)_120px_140px_100px_100px_215px]";

/* Pastilla suave: fondo del color del tipo al 12% de opacidad + texto sólido
   (en vez de fondo sólido + texto blanco), para verse ligera junto a las
   demás celdas de la tabla. */
function PastillaTipo({ tipo }: { tipo: string }) {
  const t = obtenerTipoProducto(tipo);
  if (!t) return null;
  return (
    <span
      className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold"
      style={{ backgroundColor: `${t.color}1F`, color: t.color }}
    >
      {t.nombre}
    </span>
  );
}

/* Miniatura de la portada (la subida en el CRM, si no la importada del canal).
   Se usa <img> plano en vez de next/image para no tener que allowlistar el
   hostname del CDN de Tienda Nube en next.config; para una miniatura es
   suficiente. Cae a un placeholder cuando el producto no tiene foto. */
function Miniatura({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return (
      <div className="flex size-9 shrink-0 items-center justify-center rounded-md border bg-muted text-muted-foreground/50">
        <ImageIcon className="size-4" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" className="size-9 shrink-0 rounded-md border object-cover" />
  );
}

export function TablaProductos({
  productos,
  busqueda,
  filtroTipo,
  filtroStock,
  escrituraCanales,
  onAbrir,
}: {
  productos: ProductConProveedor[];
  busqueda: string;
  filtroTipo: string;
  filtroStock: string; // "todos" | agotado | por_acabarse | ok
  /* false (el default del sistema) = el ajuste es local, no viaja a los canales. */
  escrituraCanales: boolean;
  onAbrir: (p: ProductConProveedor) => void;
}) {
  const [, startTransition] = useTransition();
  const tituloAjuste = escrituraCanales
    ? undefined
    : "Ajuste local: el stock cambia solo en el CRM, no en Tienda Nube ni Mercado Libre.";

  function cambiarStock(p: ProductConProveedor, delta: number) {
    const nuevo = p.stock + delta;
    if (nuevo < 0) return;
    startTransition(async () => {
      try {
        const r = await ajustarStock(p.id, nuevo);
        if ("error" in r) toast.error(r.error);
      } catch {
        toast.error("No se pudo ajustar el stock. Revisa tu conexión.");
      }
    });
  }

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

  if (visibles.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        {productos.length === 0
          ? "Aún no hay productos. Da de alta el primero con «+ Nuevo producto»."
          : "Ningún producto coincide con la búsqueda."}
      </p>
    );
  }

  const columnas: Columna<ProductConProveedor>[] = [
    {
      clave: "producto",
      label: "Producto",
      esTitulo: true,
      celda: (p) => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Miniatura src={portadaProducto(p)} alt={p.nombre} />
          <button
            type="button"
            onClick={() => onAbrir(p)}
            className="min-w-0 truncate text-left font-medium hover:underline"
            title={`${p.nombre}${p.variante ? ` — ${p.variante}` : ""}`}
          >
            {p.nombre}
            {p.variante && <span className="ml-1.5 text-muted-foreground">· {p.variante}</span>}
            {!p.activo && <span className="ml-1.5 text-xs italic text-muted-foreground">(inactivo)</span>}
          </button>
          {esFull(p) && (
            <span
              className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              title="Mercado Full: este stock está en un centro de Mercado Libre, no en la bodega."
            >
              Full
            </span>
          )}
        </div>
      ),
    },
    { clave: "tipo", label: "Tipo", celda: (p) => <PastillaTipo tipo={p.tipo} /> },
    {
      clave: "proveedor",
      label: "Proveedor",
      celda: (p) => (
        <div className="truncate">
          {p.proveedor?.nombre ?? <span className="text-muted-foreground/50">—</span>}
        </div>
      ),
    },
    { clave: "costo", label: "Costo", celda: (p) => <div>{formatearMXN(p.costo)}</div> },
    { clave: "precio", label: "Precio", celda: (p) => <div>{formatearMXN(p.precio)}</div> },
    {
      clave: "stock",
      label: "Stock",
      celda: (p) => {
        const estado = estadoStock(p);
        return (
          <div className="flex items-center gap-1.5" title={tituloAjuste}>
            <button
              type="button"
              onClick={() => cambiarStock(p, -1)}
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
              onClick={() => cambiarStock(p, 1)}
              className="flex size-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent"
              aria-label={`Sumar 1 al stock de ${p.nombre}`}
            >
              <Plus className="size-3.5" />
            </button>
            <BadgeStock producto={p} />
          </div>
        );
      },
    },
  ];

  return (
    <TablaSimple
      cols={COLS}
      columnas={columnas}
      datos={visibles}
      filaKey={(p) => p.id}
      filaClassName={(p) => (!p.activo ? "opacity-50" : "")}
      minW="min-w-[890px]"
    />
  );
}
