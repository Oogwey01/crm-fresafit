"use client";

import { ArrowRight } from "lucide-react";
import type { StockLog } from "@/lib/types";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[150px_minmax(180px,1fr)_170px_140px_130px_80px]";

/* Etiquetas legibles para el `origen` del movimiento (qué lo disparó). */
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
   Un solo cambio de stock produce VARIOS renglones: el del CRM y uno por cada
   canal al que se empujó, separados por unos segundos. Leídos en fila parecen
   tres movimientos distintos —justo la confusión que hay que evitar en una
   pantalla que existe para auditar quién movió qué—, así que los renglones de un
   mismo lote comparten color de fondo y se muestran sin la línea que los separa,
   como un solo bloque.

   Un lote = mismo producto, mismo origen y dentro de un minuto del primero. La
   ventana acota el grupo: dos ajustes seguidos al mismo producto con un minuto
   de diferencia son dos lotes, no uno.
---------------------------------------------------------------------------- */
const VENTANA_LOTE_MS = 60_000;

/* Dos tintes alternos. Los lotes son contiguos, así que con dos basta para que
   ninguno se confunda con su vecino, y la tabla no se llena de colores. */
const TINTES = [
  "bg-sky-500/[0.09] dark:bg-sky-400/[0.13]",
  "bg-violet-500/[0.09] dark:bg-violet-400/[0.13]",
];

type Lote = { tinte: string; ultimo: boolean };

function mismoLote(a: StockLog, b: StockLog): boolean {
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
      for (let k = i; k <= fin; k++) {
        lotes.set(movs[k].id, { tinte: TINTES[color % TINTES.length], ultimo: k === fin });
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
      celda: (m) => <span className="whitespace-nowrap font-medium">{fechaHora(m.creado_en)}</span>,
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
      celda: (m) => <span>{ORIGEN_LABEL[m.origen] ?? m.origen}</span>,
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
  );
}
