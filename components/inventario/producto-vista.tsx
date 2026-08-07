"use client";

import { useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ExternalLink,
  Image as ImageIcon,
  Minus,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BadgeStock } from "@/components/inventario/badge-stock";
import { Seccion } from "@/components/compartido/seccion";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { obtenerTipoProducto } from "@/lib/catalogos";
import { estadoStock } from "@/lib/inventario/stock";
import { avisarStockAjustado } from "@/lib/inventario/aviso-stock";
import {
  tieneFull,
  stockFullDe,
  esTikTok,
  esTikTokDelegado,
  tiktokStockDe,
  obtenerUrgencia,
  type GrupoReorden,
} from "@/lib/inventario/reabastecimiento";
import { galeriaProducto } from "@/lib/inventario/fotos";
import { tallaDeVariante } from "@/lib/talla";
import { formatearFechaHora, formatearFechaLarga, hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import {
  urlPublicacionML,
  urlPublicacionMLVendedor,
  urlPublicacionTikTok,
  urlPublicacionTN,
} from "@/lib/canales/publicaciones";
import type { VistaDinero } from "@/lib/permisos-dinero";
import {
  ajustarStock,
  borrarFotoProducto,
  movimientosProducto,
  galeriaDeProducto,
  subirFotoProducto,
} from "@/app/(app)/inventario/actions";
import type { ProductConProveedor, StockLog } from "@/lib/types";
import { firmaMovimiento } from "@/components/inventario/tabla-movimientos";
import { cortoOrigen } from "@/lib/inventario/origenes";
import { cn } from "@/lib/utils";

/* Las etiquetas salen de lib/inventario/origenes.ts, las mismas que el historial
   completo: aquí se usa la versión corta porque cada movimiento es una línea. */

/* Fecha límite para pedir. El cálculo nunca la deja en el pasado (la trunca a
   hoy), así que "hoy" significa "ya se pasó el punto de reorden". */
function limitePedido(iso: string): string {
  if (iso <= hoyISO()) return "hoy mismo";
  return `antes del ${formatearFechaLarga(iso)}`;
}

function Cifra({
  label,
  valor,
  detalle,
  className,
}: {
  label: string;
  valor: React.ReactNode;
  detalle?: string;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-base font-bold tabular-nums", className)}>{valor}</span>
      {detalle && <span className="text-[11px] text-muted-foreground">{detalle}</span>}
    </div>
  );
}

/* Cada bloque de la ficha va en su propia tarjeta. La `Seccion` compartida
   trae un separador superior —pensado para cuando todo esto era una sola
   columna con líneas entre bloque y bloque—; dentro de una tarjeta ese filo
   sobra, así que se anula. */
function SeccionTarjeta({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-card p-4 shadow-sm">
      <Seccion titulo={titulo} className="border-t-0 pt-0">
        {children}
      </Seccion>
    </div>
  );
}

/* Botón «Ver en <canal>». Con un solo destino es un enlace directo; con dos
   (la vista pública del comprador y la del panel del vendedor) se vuelve menú:
   los dos llevan a la MISMA publicación y no merecen dos botones. */
function BotonVerEnCanal({
  etiqueta,
  destinos,
  size = "default",
  className,
}: {
  /* Texto del botón: el largo de escritorio («Ver en Tienda Nube») o el corto
     de la barra del teléfono («Tienda Nube»). */
  etiqueta: string;
  destinos: { etiqueta: string; href: string }[];
  size?: "default" | "lg";
  className?: string;
}) {
  if (destinos.length === 1) {
    return (
      <a
        href={destinos[0].href}
        target="_blank"
        rel="noopener noreferrer"
        className={cn(buttonVariants({ variant: "outline", size }), className)}
      >
        <ExternalLink />
        {etiqueta}
      </a>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(buttonVariants({ variant: "outline", size }), className)}
      >
        <ExternalLink />
        {etiqueta}
        <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {destinos.map((d) => (
          <DropdownMenuItem
            key={d.href}
            render={<a href={d.href} target="_blank" rel="noopener noreferrer" />}
          >
            {d.etiqueta}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Chip({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11.5px] font-medium"
      title={title}
    >
      {children}
    </span>
  );
}

/* Ficha de un producto: toda su información de un vistazo, más las acciones
   del día a día (reponer stock, abrir la publicación en su canal). Es de solo
   lectura salvo el stock y las fotos; el formulario completo vive en
   ProductoDialog, al que se llega con «Editar».

   Vive en su PROPIA PÁGINA (/inventario/producto/[id]) y no en un pop-up, como
   pidió Armando: son fotos, tallas, ventas, canales, movimientos y proveedor —
   más de lo que cabe en un diálogo del teléfono, donde encima se perdía el
   scroll de la página de abajo. De paso cada producto gana una URL que se puede
   compartir y a la que se puede volver con el botón atrás. */
export function ProductoVista({
  producto,
  hermanas = [],
  grupo,
  ventanaDias,
  dinero,
  escrituraCanales,
  onVerHermana,
  onEditar,
  onVolver,
  dominioTiendaNube = null,
}: {
  producto: ProductConProveedor;
  /* Todas las variantes del mismo producto (incluida ésta), ordenadas por talla.
     `products` es plano y no las relaciona; se reconstruyen por nombre en
     lib/inventario/familia.ts. */
  hermanas?: ProductConProveedor[];
  onVerHermana?: (id: string) => void;
  /* Reorden del grupo al que pertenece (null = inactivo o de bajo pedido, que
     quedan fuera del cálculo). Agrupa por SKU: un producto puede compartirlo
     con sus publicaciones gemelas. */
  grupo: GrupoReorden | null;
  ventanaDias: number;
  /* Qué puede ver de dinero quien mira: precio (ingreso) y costo (egreso). */
  dinero: VistaDinero;
  /* false (el default del sistema) = el ajuste es local, no viaja a los canales. */
  escrituraCanales: boolean;
  onEditar: () => void;
  /* Volver al catálogo (la flecha de la barra superior). */
  onVolver: () => void;
  /* Subdominio del admin de Tienda Nube (integraciones.datos.dominio_admin, lo
     deja la sync). Sin él no se puede armar el enlace a la publicación de TN. */
  dominioTiendaNube?: string | null;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [subiendo, setSubiendo] = useState(false);
  const [seleccionada, setSeleccionada] = useState(0);
  const archivoRef = useRef<HTMLInputElement>(null);

  const tipo = obtenerTipoProducto(producto.tipo);
  /* La galería importada de los canales se pide al abrir la ficha: ya no viaja
     en el listado del inventario. Las fotos propias sí llegan con el producto,
     así que la vista pinta esas de inmediato y las del canal al llegar. */
  const { datos: importadas } = useDetalleRemoto<string[]>(
    () => galeriaDeProducto(producto.id).then((r) => ("error" in r ? [] : r.imagenes)),
    producto.id,
  );
  const galeria = galeriaProducto(producto, importadas ?? []);
  const principal = galeria[Math.min(seleccionada, galeria.length - 1)] ?? null;
  const estado = estadoStock(producto);
  /* Stock sumado de todas las tallas: el dato que hay que ver para decidir si el
     producto está agotado de verdad o solo lo está una talla. */
  const totalHermanas = hermanas.reduce((a, h) => a + h.stock, 0);
  const urgencia = grupo ? obtenerUrgencia(grupo.urgencia) : null;
  const enlaceMeli = producto.meli_item_id
    ? urlPublicacionML(producto.meli_item_id, producto.meli_permalink)
    : null;
  /* «Ver en …»: la misma publicación pero en su plataforma, un botón por canal
     donde la ficha está amarrada. Sustituyó a «Generar pedido», que vive en el
     módulo de proveedores (y en el listado del inventario para dirección).
     Cada canal ofrece hasta dos vistas: la del COMPRADOR (la página pública) y
     la del VENDEDOR (su panel). Las públicas viajan guardadas por la sync
     (tiendanube_permalink / meli_permalink): mientras no haya vuelto a correr,
     el canal ofrece las vistas que sí se pueden armar. TikTok no tiene página
     pública enlazable, solo el Seller Center. */
  const enlaces: { canal: string; destinos: { etiqueta: string; href: string }[] }[] = [];
  if (producto.tiendanube_product_id != null) {
    const publica = producto.tiendanube_permalink?.trim();
    const admin = urlPublicacionTN(dominioTiendaNube, producto.tiendanube_product_id);
    const destinos = [
      ...(publica ? [{ etiqueta: "Como comprador", href: publica }] : []),
      ...(admin ? [{ etiqueta: "Como vendedor", href: admin }] : []),
    ];
    if (destinos.length > 0) enlaces.push({ canal: "Tienda Nube", destinos });
  }
  if (producto.meli_item_id) {
    enlaces.push({
      canal: "Mercado Libre",
      destinos: [
        ...(enlaceMeli ? [{ etiqueta: "Como comprador", href: enlaceMeli }] : []),
        { etiqueta: "Como vendedor", href: urlPublicacionMLVendedor(producto.meli_item_id) },
      ],
    });
  }
  if (producto.tiktok_product_id) {
    enlaces.push({
      canal: "TikTok",
      destinos: [
        { etiqueta: "Seller Center", href: urlPublicacionTikTok(producto.tiktok_product_id) },
      ],
    });
  }
  const tituloAjuste = escrituraCanales
    ? undefined
    : "Ajuste local: el stock cambia solo en el CRM, no en Tienda Nube ni Mercado Libre.";

  /* El historial se pide por producto: el que carga la página son los 300
     movimientos más recientes de TODO el catálogo. La clave incluye el stock a
     propósito (caché-buster): un ajuste deja un renglón nuevo y obliga a
     recargar; mientras la clave no coincida se muestra «Cargando». */
  const { datos: movimientos } = useDetalleRemoto<StockLog[]>(
    () =>
      movimientosProducto(producto.id)
        .then((r) => ("error" in r ? [] : r.movimientos))
        .catch(() => []),
    `${producto.id}:${producto.stock}`,
  );

  function cambiarStock(delta: number) {
    const nuevo = producto.stock + delta;
    if (nuevo < 0) return;
    /* Sin `ok`: el aviso del stock lo arma `avisarStockAjustado`, que deduplica
       por producto y añade a dónde se escribió. */
    ejecutar(() => ajustarStock(producto.id, nuevo), {
      error: "No se pudo ajustar el stock. Revisa tu conexión.",
      alExito: () =>
        avisarStockAjustado({
          productoId: producto.id,
          nombre: producto.nombre,
          anterior: producto.stock,
          nuevo,
          escrituraCanales,
        }),
    });
  }

  function subir(file: File) {
    setSubiendo(true);
    const datos = new FormData();
    datos.set("file", file);
    ejecutar(() => subirFotoProducto(producto.id, datos), {
      ok: "Foto subida.",
      error: "No se pudo subir la foto. Revisa tu conexión.",
      siempre: () => setSubiendo(false),
    });
  }

  function quitar(id: string, storagePath: string) {
    ejecutar(() => borrarFotoProducto(id, storagePath), {
      ok: "Foto quitada.",
      error: "No se pudo quitar la foto. Revisa tu conexión.",
      alExito: () => setSeleccionada(0),
    });
  }

  return (
    /* Ancho de trabajo, no de lectura: la ficha vivía en una columna de 672 px
       con media pantalla vacía a los lados, y eso obligaba a apilar la foto, el
       stock, las ventas y los canales en una tira larguísima. */
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      {/* Barra de vuelta al catálogo. Va pegada arriba en el teléfono, debajo
          del header de navegación (sticky, z-40, 3.5rem de alto): de ahí el
          top-14 y el z-30. El -mx-4 cancela el padding del <main>. */}
      <div className="sticky top-14 z-30 -mx-4 -mb-2 flex h-14 items-center gap-1 border-b bg-lienzo/95 px-1.5 backdrop-blur md:static md:mx-0 md:mb-0 md:h-auto md:border-0 md:bg-transparent md:px-0 md:backdrop-blur-none">
        <button
          type="button"
          onClick={onVolver}
          className="flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted md:size-9"
          aria-label="Volver al inventario"
        >
          <ArrowLeft className="size-5" strokeWidth={2} aria-hidden="true" />
        </button>
        {/* Dice a dónde vuelves, no dónde estás: el nombre del producto está a
            dos centímetros, en el título, y repetirlo aquí solo quitaba sitio. */}
        <span className="truncate text-[15px] font-bold tracking-tight md:hidden">Inventario</span>
      </div>

      <div className="flex flex-col gap-4">
        {/* Cabecera ancha: qué es, y a la derecha los saltos a la publicación
            en cada canal más «Editar» —donde caben sin empujar nada—. En el
            teléfono viven en la barra fija de abajo, al alcance del pulgar. */}
        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between md:gap-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h1 className="text-[19px] font-bold leading-snug tracking-tight md:text-[22px]">
            {producto.nombre}
            {producto.variante && <span className="text-muted-foreground"> · {producto.variante}</span>}
          </h1>
          <div className="flex flex-wrap items-center gap-2">
            {tipo && (
              <span
                className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold"
                style={{ backgroundColor: `${tipo.color}1F`, color: tipo.color }}
              >
                {tipo.nombre}
              </span>
            )}
            {producto.sku && (
              <span className="text-xs text-muted-foreground tabular-nums">{producto.sku}</span>
            )}
            {!producto.activo && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-bold text-muted-foreground">
                Inactivo
              </span>
            )}
            {producto.bajo_pedido && (
              <span
                className="rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-bold text-muted-foreground"
                title="Se fabrica cuando alguien lo compra: no lleva inventario."
              >
                Bajo pedido
              </span>
            )}
          </div>
        </div>
          <div className="hidden shrink-0 flex-wrap justify-end gap-2 md:flex">
            {enlaces.map((e) => (
              <BotonVerEnCanal key={e.canal} etiqueta={`Ver en ${e.canal}`} destinos={e.destinos} />
            ))}
            <Button variant="outline" onClick={onEditar} disabled={pending}>
              <Pencil />
              Editar
            </Button>
          </div>
        </div>

        {/* Dos columnas: a la izquierda lo que se MIRA (la foto, las tallas, el
            historial); a la derecha lo que se CONSULTA y se toca —existencias,
            reposición, canales—, fijo al hacer scroll para no perderlo de vista.
            En el teléfono todo se apila, en el orden de siempre. */}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4">
        {/* Fotos: las propias (subidas aquí) van primero; las del canal se
            importan y no se borran desde el CRM. */}
        <div className="flex flex-col gap-2 rounded-2xl border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Fotos del artículo
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={subiendo}
              onClick={() => archivoRef.current?.click()}
            >
              <Plus />
              {subiendo ? "Subiendo…" : "Subir"}
            </Button>
            <input
              ref={archivoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void subir(file);
              }}
            />
          </div>

          {/* La foto manda: con el ancho nuevo cabe grande de verdad, y las
              miniaturas pasan a una fila debajo. En columna lateral vivían en
              una tira con scroll propio donde la cuarta foto ya no se veía.
              `object-contain`: son fotos de catálogo con fondo blanco y
              `cover` recortaba la mochila por los bordes. */}
          <div className="flex flex-col gap-2">
            <div className="flex aspect-[4/3] items-center justify-center overflow-hidden rounded-xl border bg-muted/30">
              {principal ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={principal.src} alt={producto.nombre} className="size-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-muted-foreground/50">
                  <ImageIcon className="size-8" />
                  <span className="text-xs">Foto principal</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              {galeria.map(({ src, foto }, i) => (
                <div key={src} className="group relative shrink-0">
                  <button
                    type="button"
                    onClick={() => setSeleccionada(i)}
                    className={cn(
                      "block size-14 overflow-hidden rounded-lg border transition",
                      i === Math.min(seleccionada, galeria.length - 1)
                        ? "ring-2 ring-primary"
                        : "hover:opacity-80",
                    )}
                    title={foto ? "Foto del CRM" : "Foto importada del canal"}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt="" loading="lazy" className="size-full object-cover" />
                  </button>
                  {foto && (
                    <button
                      type="button"
                      onClick={() => quitar(foto.id, foto.storage_path)}
                      disabled={pending}
                      /* Siempre visible (no solo en hover): en pantalla táctil
                         no hay hover y la foto quedaría imposible de quitar. */
                      className="absolute -top-1.5 -right-1.5 flex size-5 items-center justify-center rounded-full border bg-background text-muted-foreground opacity-70 shadow-sm transition hover:text-destructive hover:opacity-100 disabled:opacity-40"
                      aria-label="Quitar foto"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  )}
                </div>
              ))}
              <button
                type="button"
                onClick={() => archivoRef.current?.click()}
                disabled={subiendo}
                className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground transition hover:bg-accent disabled:opacity-40"
                aria-label="Subir foto"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Las demás tallas del mismo producto. Sin esto había que volver al
            listado y buscarlas una por una para saber de qué talla queda stock,
            que es justo lo que pidió resolver Armando. */}
        {hermanas.length > 1 && (
          <SeccionTarjeta titulo={`Tallas de este producto · ${totalHermanas} en total`}>
            <div className="flex flex-col gap-1">
              {hermanas.map((h) => {
                const talla = tallaDeVariante(h.variante) ?? h.variante ?? "Única";
                const esta = h.id === producto.id;
                const est = estadoStock(h);
                return (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => !esta && onVerHermana?.(h.id)}
                    disabled={esta}
                    className={cn(
                      "flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-[13.5px] transition-colors",
                      esta ? "border-primary bg-primary/5" : "hover:bg-accent",
                    )}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="font-semibold">{talla}</span>
                      {h.sku && (
                        <span className="truncate font-mono text-[12px] text-muted-foreground">
                          {h.sku}
                        </span>
                      )}
                      {esta && <span className="text-[11px] text-primary">· estás aquí</span>}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-semibold tabular-nums",
                        est === "agotado" && "text-red-600",
                        est === "por_acabarse" && "text-amber-600",
                      )}
                    >
                      {h.stock}
                    </span>
                  </button>
                );
              })}
            </div>
          </SeccionTarjeta>
        )}

        {producto.notas?.trim() && (
          <SeccionTarjeta titulo="Notas">
            <p className="text-[12.5px] whitespace-pre-line">{producto.notas}</p>
          </SeccionTarjeta>
        )}

        <SeccionTarjeta titulo="Últimos movimientos">
          {movimientos === null ? (
            <p className="text-[12.5px] text-muted-foreground">Cargando…</p>
          ) : movimientos.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">Sin movimientos registrados.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {movimientos.map((m) => {
                const delta = m.stock_anterior == null ? null : m.stock_nuevo - m.stock_anterior;
                const quien = firmaMovimiento(m);
                return (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="min-w-0 truncate">
                      <span className="text-muted-foreground">{formatearFechaHora(m.creado_en)}</span>{" "}
                      {cortoOrigen(m.origen)}
                      {quien && <span className="text-muted-foreground"> · {quien}</span>}
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                      {m.stock_anterior != null && (
                        <>
                          <span className="text-muted-foreground">{m.stock_anterior}</span>
                          <ArrowRight className="size-3 text-muted-foreground/60" strokeWidth={2} />
                        </>
                      )}
                      <span className="font-semibold">{m.stock_nuevo}</span>
                      {delta !== null && delta !== 0 && (
                        <span
                          className={cn("font-semibold", delta > 0 ? "text-green-600" : "text-red-600")}
                        >
                          {delta > 0 ? `+${delta}` : delta}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </SeccionTarjeta>

        {/* ---------------- Columna derecha: lo operativo ---------------- */}
        </div>
        <aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
        {/* Existencias: el mismo ajuste que los +/− de la tabla (server action
            ajustarStock), que deja rastro en el ledger. Es el dato que se viene
            a ver y lo único que se toca a diario, así que abre la ficha. */}
        <div
          className="flex items-center justify-between gap-3 rounded-2xl border bg-card px-4 py-3.5 shadow-sm"
          title={tituloAjuste}
        >
          <div className="flex flex-col items-start gap-1.5">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
              Existencias
            </span>
            <BadgeStock producto={producto} />
            {!producto.bajo_pedido && (
              <span className="text-[11px] text-muted-foreground">
                Avisar si baja a {producto.stock_minimo} o menos
              </span>
            )}
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => cambiarStock(-1)}
              disabled={producto.stock === 0 || pending}
              className="flex size-9 items-center justify-center rounded-lg border bg-background text-muted-foreground hover:bg-accent disabled:opacity-40"
              aria-label={`Restar 1 al stock de ${producto.nombre}`}
            >
              <Minus className="size-4" />
            </button>
            <span
              className={cn(
                "min-w-10 text-center text-2xl font-bold tabular-nums",
                estado === "agotado" && "text-red-600",
                estado === "por_acabarse" && "text-amber-600",
              )}
            >
              {producto.stock}
            </span>
            <button
              type="button"
              onClick={() => cambiarStock(1)}
              disabled={pending}
              className="flex size-9 items-center justify-center rounded-lg border bg-background text-muted-foreground hover:bg-accent disabled:opacity-40"
              aria-label={`Sumar 1 al stock de ${producto.nombre}`}
            >
              <Plus className="size-4" />
            </button>
          </div>
        </div>

        {/* Ventas y reposición: el mismo cálculo de «Qué pedir». Agrupa por SKU,
            así que las cifras son del grupo, no solo de esta ficha. */}
        {grupo ? (
          <SeccionTarjeta titulo={`Ventas y reposición · ${ventanaDias} días`}>
            <div className="grid grid-cols-3 gap-3 rounded-lg border px-3 py-2.5">
              <Cifra
                label="Vendidas"
                valor={grupo.unidades}
                detalle={
                  grupo.demandaDiaria > 0 ? `${grupo.demandaDiaria.toFixed(1)} al día` : "sin salida"
                }
              />
              <Cifra
                label="Dura"
                valor={grupo.diasCobertura === null ? "—" : `${Math.round(grupo.diasCobertura)} d`}
                detalle={grupo.enCamino > 0 ? `${grupo.enCamino} en camino` : undefined}
              />
              <Cifra
                label="Pedir"
                valor={grupo.sugerido > 0 ? grupo.sugerido : "—"}
                detalle={
                  grupo.pedirAntesDe && grupo.sugerido > 0
                    ? limitePedido(grupo.pedirAntesDe)
                    : undefined
                }
                className={grupo.urgencia === "pedir_ya" ? "text-red-600" : undefined}
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
              {urgencia && (
                <span
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 font-bold"
                  style={{ backgroundColor: `${urgencia.color}1F`, color: urgencia.color }}
                >
                  {urgencia.nombre}
                </span>
              )}
              {grupo.stockFull > 0 && (
                <span className="text-muted-foreground">
                  {grupo.stockBodega} en bodega · {grupo.stockFull} en Mercado Full
                </span>
              )}
              {grupo.enTikTok && (
                <span className="text-muted-foreground">
                  {grupo.stockTikTok} en TikTok (inventario delegado, aparte de la bodega)
                </span>
              )}
              {grupo.productoIds.length > 1 && (
                <span className="text-muted-foreground">
                  Comparte SKU con {grupo.productoIds.length - 1} ficha
                  {grupo.productoIds.length === 2 ? "" : "s"} más
                </span>
              )}
            </div>
          </SeccionTarjeta>
        ) : (
          <SeccionTarjeta titulo="Ventas y reposición">
            <p className="text-[12.5px] text-muted-foreground">
              {producto.bajo_pedido
                ? "Se fabrica contra pedido: queda fuera del cálculo de reposición."
                : "Producto inactivo: queda fuera del cálculo de reposición."}
            </p>
          </SeccionTarjeta>
        )}

        {/* Canales: dónde está publicado. Los ids son los que amarran la ficha
            con cada plataforma. */}
        <SeccionTarjeta titulo="Canales">
          <div className="flex flex-wrap items-center gap-2">
            {producto.tiendanube_variant_id != null && (
              <Chip title={`Producto ${producto.tiendanube_product_id} · variante ${producto.tiendanube_variant_id}`}>
                Tienda Nube
              </Chip>
            )}
            {producto.meli_item_id && (
              <Chip title={producto.meli_item_id}>
                Mercado Libre
                {enlaceMeli && (
                  <a
                    href={enlaceMeli}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-muted-foreground hover:text-foreground"
                    title="Abrir la publicación"
                  >
                    <ExternalLink className="size-3" />
                  </a>
                )}
              </Chip>
            )}
            {tieneFull(producto) && (
              <span
                className="rounded-md bg-amber-100 px-2 py-0.5 text-[11.5px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                title="Mercado Full: estas piezas están en un centro de Mercado Libre, aparte de la bodega."
              >
                Mercado Full
                {stockFullDe(producto) > 0 ? ` · ${stockFullDe(producto)} pzas` : ""}
              </span>
            )}
            {esTikTok(producto) && (
              <span
                className="rounded-md bg-neutral-800 px-2 py-0.5 text-[11.5px] font-bold text-white dark:bg-neutral-200 dark:text-neutral-900"
                title={
                  esTikTokDelegado(producto)
                    ? "TikTok Shop: inventario delegado, aparte de la bodega. No se suma al stock unificado."
                    : "TikTok Shop: esta publicación tiene su propio inventario, aparte del de bodega."
                }
              >
                TikTok Shop
                {/* Delegado: el stock de la ficha YA es este número (se ve en el
                    resto de la vista). Multicanal: el stock de la ficha es el
                    de bodega, así que el número de TikTok solo se ve aquí. */}
                {!esTikTokDelegado(producto) ? ` · ${tiktokStockDe(producto)} pzas` : ""}
              </span>
            )}
            {producto.tiendanube_variant_id == null && !producto.meli_item_id && !esTikTok(producto) && (
              <span className="text-[12.5px] text-muted-foreground">
                Solo en el CRM: no está publicado en ningún canal.
              </span>
            )}
          </div>
        </SeccionTarjeta>

        {/* Proveedor y costo: a mano pero en segundo plano, no compiten con lo
            que se consulta a diario. */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl border bg-card px-4 py-3 text-[12.5px] text-muted-foreground shadow-sm">
          {dinero.ingresos && (
            <span>
              Precio{" "}
              <span className="font-semibold text-foreground">{formatearMXN(producto.precio)}</span>
            </span>
          )}
          {dinero.egresos && <span>Costo {formatearMXN(producto.costo)}</span>}
          <span>Proveedor {producto.proveedor?.nombre ?? "—"}</span>
        </div>
        </aside>
        </div>

        {/* Las acciones, al alcance del pulgar. Solo en el teléfono: en
            escritorio viven arriba, en la cabecera, donde no hay que bajar
            hasta el final para llegar a ellas.
            Los enlaces van con el nombre corto del canal (sin «Ver en»), y el
            min-w hace que a partir del tercer botón la fila envuelva en vez de
            aplastarlos. */}
        <div className="sticky bottom-0 -mx-4 flex flex-wrap gap-2.5 border-t bg-lienzo/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
          {enlaces.map((e) => (
            <BotonVerEnCanal
              key={e.canal}
              etiqueta={e.canal}
              destinos={e.destinos}
              size="lg"
              className="h-12 min-w-[45%] flex-1 text-[15px]"
            />
          ))}
          <Button
            size="lg"
            variant="outline"
            className="h-12 min-w-[45%] flex-1 text-[15px]"
            onClick={onEditar}
            disabled={pending}
          >
            <Pencil />
            Editar
          </Button>
        </div>
      </div>
    </div>
  );
}
