"use client";

import { ArrowRight } from "lucide-react";
import type { StockLog } from "@/lib/types";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[150px_minmax(180px,1fr)_170px_140px_130px_80px]";

/* Etiquetas legibles para el `origen` del movimiento (qué lo disparó). */
const ORIGEN_LABEL: Record<string, string> = {
  manual: "Ajuste manual",
  tiendanube_sync: "Igualado con Tienda Nube",
  mercadolibre_sync: "Igualado con Mercado Libre",
  tiktok_sync: "Igualado con TikTok",
  proveedor: "Llegó pedido a proveedor",
  venta_ml: "Venta en Mercado Libre",
  venta_tn: "Venta en Tienda Nube",
  venta_tiktok: "Venta en TikTok",
  reparacion: "Corrección automática",
  cancelacion_tn: "Venta cancelada (Tienda Nube)",
  cancelacion_ml: "Venta cancelada (Mercado Libre)",
};

/* Explicación al pasar el cursor: qué significa cada tipo de movimiento. Las
   sincronizaciones son las más frecuentes y las que más confunden. */
const ORIGEN_DESC: Record<string, string> = {
  manual: "Alguien cambió el stock a mano con los botones +/− del CRM.",
  tiendanube_sync:
    "La sincronización automática igualó el stock del CRM al que tenía Tienda Nube en ese momento. No es una venta: solo se pusieron de acuerdo los números.",
  mercadolibre_sync:
    "La sincronización automática igualó el stock del CRM al que tenía Mercado Libre en ese momento. No es una venta.",
  tiktok_sync:
    "La sincronización automática igualó el stock del CRM al que tenía TikTok en ese momento. No es una venta.",
  proveedor: "Se recibió un pedido a proveedor y sus piezas se sumaron al stock.",
  venta_ml: "Se vendió en Mercado Libre y se descontó del stock.",
  venta_tn: "Se vendió en Tienda Nube y se descontó del stock.",
  venta_tiktok: "Se vendió en TikTok y se descontó del stock.",
  reparacion: "El sistema detectó un desfase y corrigió el stock hacia la fuente de verdad.",
  cancelacion_tn: "Se canceló una venta de Tienda Nube y sus piezas volvieron al stock.",
  cancelacion_ml: "Se canceló una venta de Mercado Libre y sus piezas volvieron al stock.",
};

/* Etiquetas legibles para el `canal` (dónde impactó la escritura). */
const CANAL_LABEL: Record<StockLog["canal"], string> = {
  crm: "CRM (local)",
  tienda_nube: "Tienda Nube",
  mercado_libre: "Mercado Libre",
  tiktok_shop: "TikTok Shop",
};

/* ----------------------------------------------------------------------------
   Agrupado por lote
   ----------------------------------------------------------------------------
   Una sola operación produce VARIOS renglones a la vez: una sincronización que
   iguala 40 productos deja 40 movimientos, y todos con el MISMO `creado_en`
   —`now()` es constante dentro de la transacción que los inserta—. Leídos en
   fila parecen 40 cambios distintos hechos a la misma hora, justo la confusión
   que hay que evitar en una pantalla que existe para auditar quién movió qué.

   Por eso los renglones de un mismo lote comparten color de fondo, se muestran
   sin la línea que los separa (como un solo bloque) y la hora aparece una sola
   vez: los demás renglones dicen «misma operación» en vez de repetirla.

   El lote sale de la columna `stock_log.lote`, que sella con un mismo id todo lo
   que una operación escribió junto. Los movimientos viejos (previos a esa
   columna) no lo tienen; para ellos caemos a la heurística de antes: mismo
   producto, mismo origen y dentro de un minuto. */
const VENTANA_LOTE_MS = 60_000;

/* Dos tintes alternos. Los lotes son contiguos, así que con dos basta para que
   ninguno se confunda con su vecino, y la tabla no se llena de colores. */
const TINTES = [
  "bg-sky-500/[0.09] dark:bg-sky-400/[0.13]",
  "bg-violet-500/[0.09] dark:bg-violet-400/[0.13]",
];

type Lote = { tinte: string; primero: boolean; ultimo: boolean; total: number };

function mismoLote(a: StockLog, b: StockLog): boolean {
  // Si hay id de lote, manda: agrupa todo lo de la misma operación aunque sean
  // productos distintos. Si solo uno lo tiene, son operaciones distintas.
  if (a.lote || b.lote) return a.lote === b.lote;
  // Sin lote (datos viejos): la heurística temporal de siempre.
  return (
    a.producto_id != null &&
    a.producto_id === b.producto_id &&
    a.origen === b.origen &&
    Math.abs(Date.parse(a.creado_en) - Date.parse(b.creado_en)) <= VENTANA_LOTE_MS
  );
}

/* Solo los lotes de más de un renglón entran al mapa: un movimiento suelto no
   necesita señal de agrupación, y así tampoco gasta un tinte. */
function agruparPorLote(movs: StockLog[]): Map<number, Lote> {
  const lotes = new Map<number, Lote>();
  let color = 0;
  for (let i = 0; i < movs.length; ) {
    let fin = i;
    // Se compara siempre contra el PRIMERO, no contra el anterior: si no, una
    // ristra larga podría encadenarse minuto a minuto sin límite.
    while (fin + 1 < movs.length && mismoLote(movs[i], movs[fin + 1])) fin++;
    if (fin > i) {
      const total = fin - i + 1;
      for (let k = i; k <= fin; k++) {
        lotes.set(movs[k].id, {
          tinte: TINTES[color % TINTES.length],
          primero: k === i,
          ultimo: k === fin,
          total,
        });
      }
      color++;
    }
    i = fin + 1;
  }
  return lotes;
}

function fechaHora(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  });
}

export function TablaMovimientos({ movimientos }: { movimientos: StockLog[] }) {
  if (movimientos.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Aún no hay movimientos de inventario registrados. Aquí aparecerá cada cambio de stock
        (ventas, ajustes manuales y sincronizaciones) con su fecha, de qué número a cuál y por qué vía.
      </p>
    );
  }

  const lotes = agruparPorLote(movimientos);

  const columnas: Columna<StockLog>[] = [
    {
      clave: "fecha",
      label: "Fecha",
      esTitulo: true,
      celda: (m) => {
        const lote = lotes.get(m.id);
        // Renglones que NO abren el bloque: no repiten la hora (es idéntica a la
        // del primero), solo señalan que son parte de la misma operación.
        if (lote && !lote.primero) {
          return (
            <span className="whitespace-nowrap pl-2 text-xs text-muted-foreground/70">
              ↳ misma operación
            </span>
          );
        }
        return (
          <span className="flex flex-col whitespace-nowrap">
            <span className="font-medium">{fechaHora(m.creado_en)}</span>
            {lote && (
              <span className="text-[11px] font-normal text-muted-foreground">
                {lote.total} cambios juntos
              </span>
            )}
          </span>
        );
      },
    },
    {
      clave: "producto",
      label: "Producto",
      celda: (m) => (
        <div className="truncate" title={m.producto?.nombre ?? undefined}>
          {m.producto ? (
            <>
              {m.producto.nombre}
              {m.producto.variante && (
                <span className="text-muted-foreground"> · {m.producto.variante}</span>
              )}
            </>
          ) : (
            <span className="text-muted-foreground/50">(producto eliminado)</span>
          )}
        </div>
      ),
    },
    {
      clave: "origen",
      label: "Movimiento",
      celda: (m) => (
        <span
          className={cn(ORIGEN_DESC[m.origen] && "cursor-help underline decoration-dotted underline-offset-2")}
          title={ORIGEN_DESC[m.origen]}
        >
          {ORIGEN_LABEL[m.origen] ?? m.origen}
        </span>
      ),
    },
    {
      clave: "canal",
      label: "Canal",
      celda: (m) => <span className="text-muted-foreground">{CANAL_LABEL[m.canal]}</span>,
    },
    {
      clave: "cambio",
      label: "Cambio",
      celda: (m) => (
        <div className="flex items-center gap-1.5 tabular-nums">
          {m.stock_anterior != null ? (
            <>
              <span className="text-muted-foreground">{m.stock_anterior}</span>
              <ArrowRight className="size-3.5 text-muted-foreground/60" strokeWidth={2} />
              <span className="font-semibold">{m.stock_nuevo}</span>
            </>
          ) : (
            <>
              <ArrowRight className="size-3.5 text-muted-foreground/60" strokeWidth={2} />
              <span className="font-semibold">{m.stock_nuevo}</span>
            </>
          )}
        </div>
      ),
    },
    {
      clave: "delta",
      label: "Δ",
      cardValorClassName: "tabular-nums",
      celda: (m) => {
        if (m.stock_anterior == null) return <span className="text-muted-foreground/50">—</span>;
        const d = m.stock_nuevo - m.stock_anterior;
        if (d === 0) return <span className="text-muted-foreground/50">0</span>;
        return (
          <span className={cn("font-semibold tabular-nums", d > 0 ? "text-green-600" : "text-red-600")}>
            {d > 0 ? `+${d}` : d}
          </span>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <p className="rounded-xl border bg-muted/40 px-4 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
        Cada renglón es un cambio de stock. <b className="font-semibold text-foreground">«Igualado con
        Tienda Nube/Mercado Libre»</b> son las sincronizaciones automáticas: el stock del CRM se puso al
        día con lo que tenía el canal, <b>no</b> son ventas. Los renglones con el <b>mismo color de
        fondo</b> son una sola operación (por eso comparten hora): una sincronización ajusta muchos
        productos a la vez. Pasa el cursor sobre el movimiento para ver qué fue.
      </p>
      <TablaSimple
        cols={COLS}
        columnas={columnas}
        datos={movimientos}
        filaKey={(m) => String(m.id)}
        /* `md:` porque en móvil cada movimiento es una tarjeta con borde completo:
           quitarle el de abajo la dejaría descuadrada. Ahí agrupa el tinte solo. */
        filaClassName={(m) => {
          const lote = lotes.get(m.id);
          return lote ? cn(lote.tinte, !lote.ultimo && "md:border-b-0") : "";
        }}
        minW="min-w-[840px]"
        vacio="Sin movimientos."
      />
    </div>
  );
}
