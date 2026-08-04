"use client";

import { FilterX } from "lucide-react";
import { estadoStock } from "@/lib/inventario/stock";
import { portadaProducto } from "@/lib/inventario/fotos";
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
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";

const COLS = "grid-cols-[minmax(180px,1fr)_130px_120px_100px_215px]";

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
  const { cambiarStock, tituloAjuste } = useAjusteStock(escrituraCanales);

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
          <MarcasProducto p={p} />
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
        return <ControlStock p={p} onCambiar={cambiarStock} titulo={tituloAjuste} />;
      },
    },
  ];

  return (
    <div className="flex flex-col gap-2">
      <p className="text-[12.5px] text-muted-foreground">
        Mostrando {visibles.length} de {totalCatalogo} productos
      </p>
      <TablaSimple
        cols={COLS}
        columnas={columnas}
        datos={visibles}
        filaKey={(p) => p.id}
        filaClassName={(p) => (!p.activo ? "opacity-50" : "")}
        minW="min-w-[650px]"
        onRowClick={onAbrir}
      />
    </div>
  );
}
