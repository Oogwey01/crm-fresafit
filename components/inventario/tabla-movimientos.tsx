"use client";

import { ArrowRight } from "lucide-react";
import { formatearFechaHora } from "@/lib/fecha";
import type { StockLog } from "@/lib/types";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { descripcionOrigen, esOrigenHumano, etiquetaOrigen } from "@/lib/inventario/origenes";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[150px_minmax(180px,1fr)_170px_140px_130px_80px]";

/* Segunda línea de la celda de movimiento: quién lo provocó. La comparte la
   ficha de un producto, que lista sus últimos movimientos con el mismo criterio.

   Las etiquetas, las descripciones y qué movimiento lleva SIEMPRE una persona
   detrás viven en lib/inventario/origenes.ts, compartidas con la ficha del
   producto y el monitor del piloto: antes cada pantalla traía su propia copia y
   la misma cosa se llamaba distinto en cada una. */
export function firmaMovimiento(m: StockLog): string | null {
  if (m.autor?.nombre) return `por ${m.autor.nombre}`;
  /* «Sin registro» y «automático» no son lo mismo: en un ajuste manual sin firma
     el movimiento es anterior a que se guardara el quién (agosto de 2026), y
     llamarlo automático sería mentira. */
  if (esOrigenHumano(m.origen)) return "sin registro";
  return "automático";
}

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

export function TablaMovimientos({
  movimientos,
  vista = "reales",
  cargando = false,
  tope = false,
}: {
  movimientos: StockLog[];
  /* Qué se está mirando. Cambia la explicación de arriba y el texto de vacío:
     lo que hay que aclarar en cada vista es distinto. */
  vista?: "reales" | "puestas_al_dia";
  cargando?: boolean;
  /* Se alcanzó el tope de la consulta: hay más historia detrás. */
  tope?: boolean;
}) {
  const reales = vista === "reales";

  if (cargando) {
    return <p className="text-sm italic text-muted-foreground">Cargando movimientos…</p>;
  }

  if (movimientos.length === 0) {
    return (
      <p className="text-sm italic text-muted-foreground">
        {reales
          ? "Sin movimientos con estos filtros. Aquí aparece cada cambio real de stock —ventas, cancelaciones, mercancía recibida y ajustes a mano— con su fecha, quién lo hizo y de qué número a cuál."
          : "Sin puestas al día con estos filtros. Aquí aparece cada vez que el CRM copió el número que ya tenía un canal."}
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
            <span className="font-medium">{formatearFechaHora(m.creado_en)}</span>
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
      celda: (m) => {
        const lote = lotes.get(m.id);
        // La firma solo en el renglón que abre el bloque: todo el lote es la
        // misma operación y la misma persona, repetirla 40 veces es ruido.
        const quien = !lote || lote.primero ? firmaMovimiento(m) : null;
        const desc = descripcionOrigen(m.origen);
        return (
          <span className="flex flex-col">
            <span
              className={cn(
                desc && "cursor-help underline decoration-dotted underline-offset-2",
                "self-start",
              )}
              title={desc}
            >
              {etiquetaOrigen(m.origen)}
            </span>
            {quien && <span className="text-[11px] text-muted-foreground">{quien}</span>}
          </span>
        );
      },
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
        {reales ? (
          <>
            Aquí van los cambios en los que de verdad se movieron piezas: ventas, cancelaciones,
            mercancía recibida y ajustes a mano. Lo que no aparece son las{" "}
            <b className="font-semibold text-foreground">puestas al día</b> —el CRM copiando el número
            que ya tenía el canal, que no son ventas—: están en la otra pestaña.
          </>
        ) : (
          <>
            Aquí <b>no</b> se movieron piezas: cada renglón es el CRM poniéndose al día con el número
            que ya tenía el canal. Es así como se entera de lo que se vendió en Tienda Nube, así que
            una bajada aquí suele ser una venta que el canal ya descontó por su cuenta.
          </>
        )}{" "}
        Debajo de cada movimiento va <b className="font-semibold text-foreground">quién lo hizo</b>:
        «automático» es el sistema y «sin registro» son los anteriores a agosto de 2026, cuando aún
        no se guardaba. Los renglones con el <b>mismo color de fondo</b> son una sola operación (por
        eso comparten hora y firma). Pasa el cursor sobre el movimiento para ver qué fue.
      </p>
      {tope && (
        <p className="text-xs text-muted-foreground">
          Mostrando los {movimientos.length} más recientes. Hay más historia detrás: el CRM guarda 90
          días.
        </p>
      )}
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
