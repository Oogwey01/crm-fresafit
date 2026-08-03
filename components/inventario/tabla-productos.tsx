"use client";

import { useTransition } from "react";
import { FilterX, Image as ImageIcon, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { obtenerTipoProducto } from "@/lib/catalogos";
import { estadoStock } from "@/lib/inventario/stock";
import { avisarStockAjustado } from "@/lib/inventario/aviso-stock";
import { tieneFull, stockFullDe, esTikTokDelegado } from "@/lib/inventario/reabastecimiento";
import { portadaProducto } from "@/lib/inventario/fotos";
import { formatearMXN } from "@/lib/moneda";
import { BadgeStock } from "@/components/inventario/badge-stock";
import { Pastilla } from "@/components/compartido/pastilla";
import { Button } from "@/components/ui/button";
import { ajustarStock } from "@/app/(app)/inventario/actions";
import type { ProductConProveedor } from "@/lib/types";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[minmax(180px,1fr)_130px_120px_100px_215px]";

/* Pastilla suave: fondo del color del tipo al 12% de opacidad + texto sólido
   (en vez de fondo sólido + texto blanco), para verse ligera junto a las
   demás celdas de la tabla. */
function PastillaTipo({ tipo }: { tipo: string }) {
  const t = obtenerTipoProducto(tipo);
  if (!t) return null;
  return <Pastilla nombre={t.nombre} color={t.color} />;
}

/* Miniatura de la portada (la subida en el CRM, si no la importada del canal).
   Se usa <img> plano en vez de next/image para no tener que allowlistar el
   hostname del CDN de Tienda Nube en next.config; para una miniatura es
   suficiente. Cae a un placeholder cuando el producto no tiene foto. */
function Miniatura({ src, alt }: { src: string | null; alt: string }) {
  if (!src) {
    return (
      <div className="flex size-20 shrink-0 items-center justify-center rounded-lg border bg-muted text-muted-foreground/50">
        <ImageIcon className="size-6" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading="lazy" className="size-20 shrink-0 rounded-lg border object-cover" />
  );
}

export function TablaProductos({
  productos,
  totalCatalogo,
  busqueda,
  filtroTipo,
  filtroStock,
  filtrosActivos,
  onLimpiarFiltros,
  escrituraCanales,
  onAbrir,
}: {
  /* Ya viene recortada por los filtros del panel (almacén, vigencia). */
  productos: ProductConProveedor[];
  /* Productos del catálogo SIN ningún filtro. Es lo que permite distinguir
     «no hay productos» de «los filtros los escondieron»: sin este dato, un
     filtro que no deja pasar nada se leía como un catálogo vacío. */
  totalCatalogo: number;
  busqueda: string;
  filtroTipo: string;
  filtroStock: string; // "todos" | agotado | por_acabarse | ok
  /* Nombres legibles de los filtros puestos ("Almacén: Solo Mercado Full"), para
     poder decir POR QUÉ no salió nada. Los junta el panel, que es quien los
     conoce todos. */
  filtrosActivos: string[];
  onLimpiarFiltros: () => void;
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
        else
          avisarStockAjustado({
            productoId: p.id,
            nombre: p.nombre,
            anterior: p.stock,
            nuevo,
            escrituraCanales,
          });
      } catch {
        toast.error("No se pudo ajustar el stock. Revisa tu conexión.");
      }
    });
  }

  const q = busqueda.trim().toLowerCase();
  const visibles = productos
    .filter(
      (p) =>
        (filtroTipo === "todos" || p.tipo === filtroTipo) &&
        (filtroStock === "todos" || estadoStock(p) === filtroStock) &&
        (!q ||
          p.nombre.toLowerCase().includes(q) ||
          (p.sku ?? "").toLowerCase().includes(q) ||
          (p.variante ?? "").toLowerCase().includes(q) ||
          (p.proveedor?.nombre ?? "").toLowerCase().includes(q)),
    )
    /* Mismo producto, sus tallas juntas: se agrupan por nombre y, dentro, se
       ordenan por variante (talla) para que no queden dispersas por la lista. */
    .sort((a, b) => {
      const n = a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" });
      if (n !== 0) return n;
      return (a.variante ?? "").localeCompare(b.variante ?? "", "es", { numeric: true });
    });

  if (visibles.length === 0) {
    /* El catálogo vacío de verdad es el único caso en que corresponde invitar a
       dar de alta un producto. Si hay catálogo pero no pasó nada, la culpa es de
       los filtros y hay que decir cuáles: una lista vacía sin explicación se lee
       como «esto no existe». */
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
          {tieneFull(p) && (
            <span
              className="shrink-0 rounded-md bg-amber-100 px-1.5 py-0.5 text-[10.5px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
              title={
                stockFullDe(p) > 0
                  ? `Mercado Full: ${stockFullDe(p)} piezas en un centro de Mercado Libre, aparte de la bodega.`
                  : "Publicación en Mercado Full sin existencias en el centro de Mercado Libre."
              }
            >
              {/* Sin número mientras el depósito esté vacío: un «Full 0» se lee
                  como un dato faltante y no como lo que es. */}
              Full{stockFullDe(p) > 0 ? ` ${stockFullDe(p)}` : ""}
            </span>
          )}
          {esTikTokDelegado(p) && (
            <span
              className="shrink-0 rounded-md bg-neutral-800 px-1.5 py-0.5 text-[10.5px] font-bold text-white dark:bg-neutral-200 dark:text-neutral-900"
              title="TikTok Shop: inventario delegado (aparte de la bodega). No se suma al stock unificado."
            >
              TikTok
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
        </div>
      ),
    },
    {
      clave: "sku",
      label: "SKU",
      celda: (p) =>
        p.sku ? (
          <span className="font-mono text-[12.5px] text-muted-foreground" title={p.sku}>
            {p.sku}
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        ),
    },
    { clave: "tipo", label: "Tipo", celda: (p) => <PastillaTipo tipo={p.tipo} /> },
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
      minW="min-w-[650px]"
      onRowClick={onAbrir}
    />
  );
}
