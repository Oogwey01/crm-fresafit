"use client";

import { useMemo, useState } from "react";
import { Music2, Truck, Warehouse } from "lucide-react";
import { TIPOS_PRODUCTO, obtenerTipoProducto } from "@/lib/catalogos";
import { formatearFecha, hoyISO } from "@/lib/fecha";
import {
  calcularReabastecimiento,
  obtenerUrgencia,
  type EnCamino,
  type GrupoReorden,
  type ParamsReorden,
  type ProductoReorden,
  type VentaReorden,
} from "@/lib/inventario/reabastecimiento";
import type { CanalId } from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[minmax(200px,1fr)_150px_120px_130px_90px_120px]";

/* Ventanas de venta que se pueden mirar. Más corta = reacciona antes a un
   cambio de demanda; más larga = menos ruido de una semana rara. */
const VENTANAS: [number, string][] = [
  [30, "30 días"],
  [60, "60 días"],
  [90, "90 días"],
];

const PLATAFORMAS: [CanalId | "todas", string][] = [
  ["todas", "Todas las plataformas"],
  ["mercado_libre", "Mercado Libre"],
  ["tienda_nube", "Tienda Nube"],
];

function PastillaUrgencia({ id }: { id: string }) {
  const u = obtenerUrgencia(id);
  if (!u) return null;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-bold"
      style={{ backgroundColor: `${u.color}1F`, color: u.color }}
    >
      <span className="size-1.5 rounded-full" style={{ backgroundColor: u.color }} />
      {u.nombre}
    </span>
  );
}

/* "12 días" / "2 meses" — la cobertura exacta no aporta, el orden de magnitud sí. */
function textoCobertura(dias: number | null): string {
  if (dias === null) return "—";
  if (dias >= 365) return "+1 año";
  if (dias >= 60) return `${Math.round(dias / 30)} meses`;
  return `${Math.round(dias)} días`;
}

/* Qué hay que comprar y cuándo. Vivía en Inventario, pero la pregunta que
   contesta —«¿qué le pido al proveedor?»— es la que abre este módulo, y aquí el
   pedido se arma sin salir de la pantalla.

   Se trajo la búsqueda y el filtro de tipo DENTRO: en Inventario bajaban de la
   barra de herramientas del panel, que aquí no existe. La tabla ya era dueña de
   sus otros tres controles (ventana, plataforma, «solo lo que urge»), así que
   ahora se basta sola. */
export function TablaReabastecer({
  productos,
  ventas,
  enCamino,
  params,
  onPedir,
}: {
  productos: ProductoReorden[];
  ventas: VentaReorden[];
  enCamino: EnCamino;
  params: ParamsReorden;
  /* Solo dirección puede armar el pedido: para el resto la columna se queda
     con la sugerencia y sin botón. */
  onPedir?: (grupo: GrupoReorden) => void;
}) {
  const [ventanaDias, setVentanaDias] = useState(30);
  const [canal, setCanal] = useState<CanalId | "todas">("todas");
  const [soloUrgentes, setSoloUrgentes] = useState(true);
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");

  const grupos = useMemo(
    () => calcularReabastecimiento({ productos, ventas, enCamino, ventanaDias, canal, params }),
    [productos, ventas, enCamino, ventanaDias, canal, params],
  );

  const q = busqueda.trim().toLowerCase();
  const visibles = grupos.filter(
    (g) =>
      (filtroTipo === "todos" || g.tipo === filtroTipo) &&
      (!soloUrgentes || g.urgencia === "pedir_ya" || g.urgencia === "pedir_pronto" || g.enviarAFull) &&
      (!q ||
        g.nombre.toLowerCase().includes(q) ||
        (g.sku ?? "").toLowerCase().includes(q) ||
        (g.variante ?? "").toLowerCase().includes(q) ||
        (g.proveedor?.nombre ?? "").toLowerCase().includes(q)),
  );

  const hoy = hoyISO();

  const columnas: Columna<GrupoReorden>[] = [
    {
      clave: "producto",
      label: "Producto",
      esTitulo: true,
      celda: (g) => {
        const t = obtenerTipoProducto(g.tipo);
        return (
          <div className="flex min-w-0 flex-col gap-1">
            <span className="truncate font-medium" title={g.nombre}>
              {g.nombre}
              {g.variante && <span className="ml-1.5 text-muted-foreground">· {g.variante}</span>}
            </span>
            <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
              {g.sku && <span className="font-mono">{g.sku}</span>}
              {t && (
                <span
                  className="rounded px-1.5 py-0.5 font-semibold"
                  style={{ backgroundColor: `${t.color}1F`, color: t.color }}
                >
                  {t.nombre}
                </span>
              )}
              {g.enFull && (
                <span
                  className="rounded bg-amber-100 px-1.5 py-0.5 font-bold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                  title="Publicación en Mercado Full: parte del stock está en un centro de Mercado Libre."
                >
                  Full
                </span>
              )}
            </span>
          </div>
        );
      },
    },
    {
      clave: "stock",
      label: "Stock",
      celda: (g) => (
        <div className="flex flex-col gap-0.5 text-[13px]">
          <span className="inline-flex items-center gap-1.5 font-semibold tabular-nums">
            <Warehouse className="size-3.5 text-muted-foreground" strokeWidth={1.9} aria-hidden="true" />
            {g.stockBodega} <span className="font-normal text-muted-foreground">bodega</span>
          </span>
          {g.enFull && (
            <span className="inline-flex items-center gap-1.5 tabular-nums text-amber-700 dark:text-amber-400">
              <Truck className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
              {g.stockFull} <span className="text-muted-foreground">en Full</span>
            </span>
          )}
          {g.enTikTok && (
            <span
              className="inline-flex items-center gap-1.5 tabular-nums text-muted-foreground"
              title="Inventario delegado a TikTok Shop: es un almacén aparte, no se suma a la bodega."
            >
              <Music2 className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
              {g.stockTikTok} <span>en TikTok (aparte)</span>
            </span>
          )}
          {g.enCamino > 0 && (
            <span className="tabular-nums text-muted-foreground">+{g.enCamino} en camino</span>
          )}
        </div>
      ),
    },
    {
      clave: "ventas",
      label: "Salida",
      celda: (g) => (
        <div className="flex flex-col gap-0.5 text-[13px]">
          <span className="font-semibold tabular-nums">
            {g.demandaDiaria >= 1 ? g.demandaDiaria.toFixed(1) : g.demandaDiaria.toFixed(2)}
            <span className="ml-1 font-normal text-muted-foreground">u/día</span>
          </span>
          <span className="text-[12px] text-muted-foreground">
            {g.unidades} en {ventanaDias} días
          </span>
        </div>
      ),
    },
    {
      clave: "cobertura",
      label: "Alcanza para",
      celda: (g) => (
        <div className="flex flex-col items-start gap-1">
          <span
            className={cn(
              "font-semibold tabular-nums",
              g.urgencia === "pedir_ya" && "text-red-600",
              g.urgencia === "pedir_pronto" && "text-amber-600",
            )}
          >
            {textoCobertura(g.diasCobertura)}
          </span>
          <PastillaUrgencia id={g.urgencia} />
        </div>
      ),
    },
    {
      clave: "pedir",
      label: "Pedir",
      celda: (g) => (
        <div
          className="font-bold tabular-nums"
          title={`Cubre el tiempo de entrega (${g.diasEntrega} días) más ${params.diasCoberturaObjetivo} días de venta`}
        >
          {g.sugerido > 0 ? g.sugerido : <span className="font-normal text-muted-foreground/50">—</span>}
        </div>
      ),
    },
    {
      clave: "cuando",
      label: "Pedir antes de",
      cardAncho: true,
      celda: (g) => (
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "text-[13px]",
              g.pedirAntesDe && g.pedirAntesDe <= hoy ? "font-bold text-red-600" : "text-muted-foreground",
            )}
          >
            {g.pedirAntesDe === null
              ? "—"
              : g.pedirAntesDe <= hoy
                ? "Ya"
                : formatearFecha(g.pedirAntesDe)}
          </span>
          {g.sugerido > 0 && onPedir && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPedir(g)}
              className="h-auto rounded-[9px] px-2.5 py-1 text-[12px] font-semibold"
            >
              Pedir
            </Button>
          )}
        </div>
      ),
    },
  ];

  const aFull = visibles.filter((g) => g.enviarAFull);

  return (
    <div className="flex flex-col gap-4">
      {/* El buscador va en su propio renglón y a todo el ancho, como en el
          catálogo: con más de mil fichas es la acción principal. El recuento no
          se pinta porque aquí la lista son grupos de reorden —un producto
          publicado en tres plataformas es UNA fila—, no productos sueltos. */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar producto, SKU o proveedor…"
        />
        <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v ?? "todos")}>
          <SelectTrigger className="w-full bg-card md:w-[190px]">
            <SelectValue>
              {(v: string) =>
                v === "todos" ? "Todos los tipos" : (obtenerTipoProducto(v)?.nombre ?? "Tipo")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            {TIPOS_PRODUCTO.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3.5 md:flex-row md:items-center md:justify-between">
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          Cuánto se vende de cada producto, cuánto queda y cuándo hay que pedirlo para que no se
          agote mientras llega. Un mismo producto publicado en varias plataformas cuenta como uno
          solo (se agrupa por SKU). Tiempo aproximado de maquila y entrega: el del proveedor, o{" "}
          <b className="font-semibold text-foreground">{params.diasEntregaDefault} días</b> si no
          está capturado.
        </p>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Select value={String(ventanaDias)} onValueChange={(v) => v && setVentanaDias(Number(v))}>
            <SelectTrigger className="w-[130px] bg-card">
              <SelectValue>
                {(v: string) => VENTANAS.find(([d]) => String(d) === v)?.[1] ?? "Ventana"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {VENTANAS.map(([dias, label]) => (
                <SelectItem key={dias} value={String(dias)}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={canal} onValueChange={(v) => setCanal((v ?? "todas") as CanalId | "todas")}>
            <SelectTrigger className="w-[185px] bg-card">
              <SelectValue>
                {(v: string) => PLATAFORMAS.find(([id]) => id === v)?.[1] ?? "Plataforma"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PLATAFORMAS.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant={soloUrgentes ? "default" : "outline"}
            onClick={() => setSoloUrgentes((v) => !v)}
            className="h-auto rounded-[10px] px-3.5 py-2 text-[13px] font-semibold"
          >
            Solo lo que urge
          </Button>
        </div>
      </div>

      {aFull.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[13.5px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
          <Truck className="size-[18px] shrink-0" strokeWidth={1.9} aria-hidden="true" />
          <span>
            <b className="font-bold">
              {aFull.length === 1
                ? "1 producto se está acabando en Mercado Full."
                : `${aFull.length} productos se están acabando en Mercado Full.`}
            </b>{" "}
            Hay que enviarlos desde la bodega ({params.diasEnvioFull} días en llegar al centro de ML):{" "}
            {aFull
              .slice(0, 3)
              .map((g) => `${g.nombre}${g.sugeridoAFull > 0 ? ` (${g.sugeridoAFull} pzas)` : ""}`)
              .join(", ")}
            {aFull.length > 3 ? "…" : ""}
          </span>
        </div>
      )}

      <TablaSimple
        cols={COLS}
        columnas={columnas}
        datos={visibles}
        filaKey={(g) => g.clave}
        minW="min-w-[900px]"
        filaClassName={(g) => (g.urgencia === "pedir_ya" ? "bg-red-50/50 dark:bg-red-950/20" : "")}
        vacio={
          soloUrgentes
            ? "Nada urge por ahora: con las ventas de la ventana, todo alcanza para más del tiempo de entrega. 🎉"
            : "Ningún producto coincide con la búsqueda."
        }
      />
    </div>
  );
}
