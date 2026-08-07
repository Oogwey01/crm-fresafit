"use client";

import { FilterX } from "lucide-react";
import { portadaProducto } from "@/lib/inventario/fotos";
import { formatearMXN } from "@/lib/moneda";
import { Button } from "@/components/ui/button";
import { Resaltado } from "@/components/compartido/resaltado";
import { useAjusteStock } from "@/components/inventario/usar-ajuste-stock";
import {
  ControlStock,
  MarcasProducto,
  Miniatura,
  PastillaTipo,
} from "@/components/inventario/celdas-producto";
import type { ProductConProveedor } from "@/lib/types";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";

/* Dos rejillas literales: Tailwind lee las clases del código fuente, así que un
   `grid-cols-[…]` armado por concatenación no llegaría a la hoja de estilos. */
const COLS = "grid-cols-[minmax(288px,1fr)_130px_120px_100px_215px]";
const COLS_SIN_PRECIO = "grid-cols-[minmax(288px,1fr)_130px_120px_215px]";

export function TablaProductos({
  productos,
  totalCatalogo,
  busqueda,
  filtrosActivos,
  onLimpiarFiltros,
  escrituraCanales,
  verPrecio,
  onAbrir,
}: {
  /* Ya viene recortada por TODOS los filtros del panel —búsqueda incluida—:
     aquí solo se ordena y se pinta. El recorte vive en useFiltrosProductos
     porque el buscador enseña el recuento mientras escribes. */
  productos: ProductConProveedor[];
  /* Productos del catálogo SIN ningún filtro. Es lo que permite distinguir
     «no hay productos» de «los filtros los escondieron»: sin este dato, un
     filtro que no deja pasar nada se leía como un catálogo vacío. */
  totalCatalogo: number;
  /* Lo escrito en el buscador. NO filtra —de eso ya se encargó el panel—: sirve
     para señalar en cada renglón por dónde pegó la coincidencia. */
  busqueda: string;
  /* Nombres legibles de los filtros puestos ("Almacén: Solo Mercado Full"), para
     poder decir POR QUÉ no salió nada. Los junta el panel, que es quien los
     conoce todos. */
  filtrosActivos: string[];
  onLimpiarFiltros: () => void;
  /* false (el default del sistema) = el ajuste es local, no viaja a los canales. */
  escrituraCanales: boolean;
  /* El precio de lista es ingreso: sin permiso la columna no se pinta —y el dato
     tampoco llegó del servidor—. Vacía se leería como un producto sin precio. */
  verPrecio: boolean;
  onAbrir: (p: ProductConProveedor) => void;
}) {
  const { cambiarStock, tituloAjuste } = useAjusteStock(escrituraCanales);

  /* Mismo producto, sus tallas juntas: se agrupan por nombre y, dentro, se
     ordenan por variante (talla) para que no queden dispersas por la lista. */
  const visibles = [...productos].sort((a, b) => {
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
          {/* Grande en escritorio —el catálogo se reconoce por la foto, no por
              el SKU— y pequeña en la tarjeta del teléfono, donde una miniatura
              así se comería media tarjeta sin decir nada que el nombre no diga. */}
          <Miniatura src={portadaProducto(p)} alt={p.nombre} tam="size-12 md:size-36" />
          <button
            type="button"
            onClick={() => onAbrir(p)}
            className="min-w-0 truncate text-left font-medium hover:underline"
            title={`${p.nombre}${p.variante ? ` — ${p.variante}` : ""}`}
          >
            <Resaltado texto={p.nombre} busca={busqueda} />
            {p.variante && (
              <span className="ml-1.5 text-muted-foreground">
                · <Resaltado texto={p.variante} busca={busqueda} />
              </span>
            )}
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
            <Resaltado texto={p.sku} busca={busqueda} />
          </span>
        ) : (
          <span className="text-muted-foreground/40">—</span>
        ),
    },
    { clave: "tipo", label: "Tipo", celda: (p) => <PastillaTipo tipo={p.tipo} /> },
    ...(verPrecio
      ? ([
          { clave: "precio", label: "Precio", celda: (p) => <div>{formatearMXN(p.precio)}</div> },
        ] satisfies Columna<ProductConProveedor>[])
      : []),
    {
      clave: "stock",
      label: "Stock",
      /* Los −/+ más el semáforo no caben en media tarjeta. */
      cardAncho: true,
      celda: (p) => {
        return <ControlStock p={p} onCambiar={cambiarStock} titulo={tituloAjuste} />;
      },
    },
  ];

  /* El «Mostrando N de M» ya no se pinta aquí: ese recuento vive pegado al
     buscador, que es donde se mira mientras escribes. */
  return (
    <div className="flex flex-col gap-2">
      <TablaSimple
        cols={verPrecio ? COLS : COLS_SIN_PRECIO}
        columnas={columnas}
        datos={visibles}
        filaKey={(p) => p.id}
        filaClassName={(p) => (!p.activo ? "opacity-50" : "")}
        minW="min-w-[760px]"
        onRowClick={onAbrir}
      />
    </div>
  );
}
