"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ArrowRight,
  ExternalLink,
  Image as ImageIcon,
  Minus,
  Pencil,
  Plus,
  Trash2,
  Truck,
} from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { BadgeStock } from "@/components/inventario/badge-stock";
import { obtenerTipoProducto } from "@/lib/catalogos";
import { estadoStock } from "@/lib/inventario/stock";
import { avisarStockAjustado } from "@/lib/inventario/aviso-stock";
import { esFull, obtenerUrgencia, type GrupoReorden } from "@/lib/inventario/reabastecimiento";
import { galeriaProducto } from "@/lib/inventario/fotos";
import { hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import {
  ajustarStock,
  borrarFotoProducto,
  movimientosProducto,
  subirFotoProducto,
} from "@/app/(app)/inventario/actions";
import type { ProductConProveedor, StockLog } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Mismas etiquetas que el historial completo (tabla-movimientos.tsx). */
const ORIGEN_LABEL: Record<string, string> = {
  manual: "Ajuste manual",
  tiendanube_sync: "Sync Tienda Nube",
  mercadolibre_sync: "Sync Mercado Libre",
  tiktok_sync: "Sync TikTok",
  proveedor: "Recepción proveedor",
  venta_ml: "Venta Mercado Libre",
  venta_tn: "Venta Tienda Nube",
  venta_tiktok: "Venta TikTok",
  reparacion: "Reparación automática",
  cancelacion_tn: "Cancelación Tienda Nube",
  cancelacion_ml: "Cancelación Mercado Libre",
};

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

/* Fecha límite para pedir. El cálculo nunca la deja en el pasado (la trunca a
   hoy), así que "hoy" significa "ya se pasó el punto de reorden". */
function limitePedido(iso: string): string {
  if (iso <= hoyISO()) return "hoy mismo";
  const fecha = new Date(`${iso}T12:00:00`).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "long",
    timeZone: "America/Mexico_City",
  });
  return `antes del ${fecha}`;
}

/* Enlace a la publicación de Mercado Libre. Solo se arma para los ids mexicanos
   (MLM…), que es lo único que publica la tienda; para otros se omite el enlace
   en vez de mandar a una URL que no resuelve. */
function urlMeli(itemId: string): string | null {
  if (!/^MLM\d+$/.test(itemId)) return null;
  return `https://articulo.mercadolibre.com.mx/${itemId.replace(/^MLM/, "MLM-")}`;
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t pt-3">
      <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
        {titulo}
      </span>
      {children}
    </div>
  );
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

/* Vista rápida de un producto: toda su información de un vistazo, más las dos
   acciones del día a día (reponer stock, pedir al proveedor). Es de solo
   lectura salvo el stock y las fotos; el formulario completo vive en
   ProductoDialog, al que se llega con «Editar». */
export function ProductoVista({
  producto,
  grupo,
  ventanaDias,
  escrituraCanales,
  onEditar,
  onGenerarPedido,
  onClose,
}: {
  producto: ProductConProveedor;
  /* Reorden del grupo al que pertenece (null = inactivo o de bajo pedido, que
     quedan fuera del cálculo). Agrupa por SKU: un producto puede compartirlo
     con sus publicaciones gemelas. */
  grupo: GrupoReorden | null;
  ventanaDias: number;
  /* false (el default del sistema) = el ajuste es local, no viaja a los canales. */
  escrituraCanales: boolean;
  onEditar: () => void;
  onGenerarPedido: () => void;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [subiendo, setSubiendo] = useState(false);
  const [seleccionada, setSeleccionada] = useState(0);
  const [cargados, setCargados] = useState<{ clave: string; movimientos: StockLog[] } | null>(null);
  const archivoRef = useRef<HTMLInputElement>(null);

  const tipo = obtenerTipoProducto(producto.tipo);
  const galeria = galeriaProducto(producto);
  const principal = galeria[Math.min(seleccionada, galeria.length - 1)] ?? null;
  const estado = estadoStock(producto);
  const urgencia = grupo ? obtenerUrgencia(grupo.urgencia) : null;
  const enlaceMeli = producto.meli_item_id ? urlMeli(producto.meli_item_id) : null;
  const tituloAjuste = escrituraCanales
    ? undefined
    : "Ajuste local: el stock cambia solo en el CRM, no en Tienda Nube ni Mercado Libre.";

  /* El historial se pide por producto: el que carga la página son los 300
     movimientos más recientes de TODO el catálogo. La clave incluye el stock
     para recargarlo tras un ajuste, que deja un renglón nuevo; mientras no
     coincida, lo cargado es de otra ficha y se muestra «Cargando». */
  const claveMovimientos = `${producto.id}:${producto.stock}`;
  const movimientos = cargados?.clave === claveMovimientos ? cargados.movimientos : null;
  useEffect(() => {
    let vigente = true;
    movimientosProducto(producto.id)
      .then((r) => {
        if (vigente) setCargados({ clave: claveMovimientos, movimientos: "error" in r ? [] : r.movimientos });
      })
      .catch(() => vigente && setCargados({ clave: claveMovimientos, movimientos: [] }));
    return () => {
      vigente = false;
    };
  }, [producto.id, claveMovimientos]);

  function cambiarStock(delta: number) {
    const nuevo = producto.stock + delta;
    if (nuevo < 0) return;
    startTransition(async () => {
      try {
        const r = await ajustarStock(producto.id, nuevo);
        if ("error" in r) toast.error(r.error);
        else
          avisarStockAjustado({
            productoId: producto.id,
            nombre: producto.nombre,
            anterior: producto.stock,
            nuevo,
            escrituraCanales,
          });
      } catch {
        toast.error("No se pudo ajustar el stock. Revisa tu conexión.");
      }
    });
  }

  async function subir(file: File) {
    setSubiendo(true);
    try {
      const datos = new FormData();
      datos.set("file", file);
      const r = await subirFotoProducto(producto.id, datos);
      if ("error" in r) toast.error(r.error);
      else toast.success("Foto subida.");
    } catch {
      toast.error("No se pudo subir la foto. Revisa tu conexión.");
    } finally {
      setSubiendo(false);
    }
  }

  function quitar(id: string, storagePath: string) {
    startTransition(async () => {
      try {
        const r = await borrarFotoProducto(id, storagePath);
        if ("error" in r) toast.error(r.error);
        else setSeleccionada(0);
      } catch {
        toast.error("No se pudo quitar la foto. Revisa tu conexión.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pr-8">
          <DialogTitle className="text-lg leading-snug">
            {producto.nombre}
            {producto.variante && <span className="text-muted-foreground"> · {producto.variante}</span>}
          </DialogTitle>
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
        </DialogHeader>

        {/* Fotos: las propias (subidas aquí) van primero; las del canal se
            importan y no se borran desde el CRM. */}
        <div className="flex flex-col gap-2 border-t pt-3">
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

          <div className="grid grid-cols-[1fr_auto] gap-2">
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg border bg-muted/40">
              {principal ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={principal.src} alt={producto.nombre} className="size-full object-cover" />
              ) : (
                <div className="flex flex-col items-center gap-1.5 text-muted-foreground/50">
                  <ImageIcon className="size-8" />
                  <span className="text-xs">Foto principal</span>
                </div>
              )}
            </div>

            <div className="flex max-h-[248px] flex-col gap-2 overflow-y-auto pr-0.5">
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

        {/* Existencias: el mismo ajuste que los +/− de la tabla (server action
            ajustarStock), que deja rastro en el ledger. */}
        <div
          className="flex items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2.5"
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
          <Seccion titulo={`Ventas y reposición · ${ventanaDias} días`}>
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
              {grupo.productoIds.length > 1 && (
                <span className="text-muted-foreground">
                  Comparte SKU con {grupo.productoIds.length - 1} ficha
                  {grupo.productoIds.length === 2 ? "" : "s"} más
                </span>
              )}
            </div>
          </Seccion>
        ) : (
          <Seccion titulo="Ventas y reposición">
            <p className="text-[12.5px] text-muted-foreground">
              {producto.bajo_pedido
                ? "Se fabrica contra pedido: queda fuera del cálculo de reposición."
                : "Producto inactivo: queda fuera del cálculo de reposición."}
            </p>
          </Seccion>
        )}

        {/* Canales: dónde está publicado. Los ids son los que amarran la ficha
            con cada plataforma. */}
        <Seccion titulo="Canales">
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
            {esFull(producto) && (
              <span
                className="rounded-md bg-amber-100 px-2 py-0.5 text-[11.5px] font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                title="Mercado Full: este stock está en un centro de Mercado Libre, no en la bodega."
              >
                Mercado Full
              </span>
            )}
            {producto.tiendanube_variant_id == null && !producto.meli_item_id && (
              <span className="text-[12.5px] text-muted-foreground">
                Solo en el CRM: no está publicado en ningún canal.
              </span>
            )}
          </div>
        </Seccion>

        {producto.notas?.trim() && (
          <Seccion titulo="Notas">
            <p className="text-[12.5px] whitespace-pre-line">{producto.notas}</p>
          </Seccion>
        )}

        <Seccion titulo="Últimos movimientos">
          {movimientos === null ? (
            <p className="text-[12.5px] text-muted-foreground">Cargando…</p>
          ) : movimientos.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">Sin movimientos registrados.</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {movimientos.map((m) => {
                const delta = m.stock_anterior == null ? null : m.stock_nuevo - m.stock_anterior;
                return (
                  <li key={m.id} className="flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="min-w-0 truncate">
                      <span className="text-muted-foreground">{fechaHora(m.creado_en)}</span>{" "}
                      {ORIGEN_LABEL[m.origen] ?? m.origen}
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
        </Seccion>

        {/* Proveedor y costo: a mano pero en segundo plano, no compiten con lo
            que se consulta a diario. */}
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t pt-3 text-[12.5px] text-muted-foreground">
          <span>
            Precio <span className="font-semibold text-foreground">{formatearMXN(producto.precio)}</span>
          </span>
          <span>Costo {formatearMXN(producto.costo)}</span>
          <span>Proveedor {producto.proveedor?.nombre ?? "—"}</span>
        </div>

        <DialogFooter>
          <Button size="lg" className="flex-1" onClick={onGenerarPedido} disabled={pending}>
            <Truck />
            Generar pedido
          </Button>
          <Button size="lg" variant="outline" onClick={onEditar} disabled={pending}>
            <Pencil />
            Editar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
