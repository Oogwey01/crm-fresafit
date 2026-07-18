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
  venta_tiktok: "Venta TikTok",
};

/* Etiquetas legibles para el `canal` (dónde impactó la escritura). */
const CANAL_LABEL: Record<StockLog["canal"], string> = {
  crm: "CRM (local)",
  tienda_nube: "Tienda Nube",
  mercado_libre: "Mercado Libre",
  tiktok_shop: "TikTok Shop",
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

export function TablaMovimientos({ movimientos }: { movimientos: StockLog[] }) {
  if (movimientos.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        Aún no hay movimientos de inventario registrados. Aquí aparecerá cada cambio de stock
        (ventas, ajustes manuales y sincronizaciones) con su fecha, de qué número a cuál y por qué vía.
      </p>
    );
  }

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
      minW="min-w-[840px]"
      vacio="Sin movimientos."
    />
  );
}
