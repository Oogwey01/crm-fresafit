import Link from "next/link";
import { CreditCard, Info, ShoppingCart, Store, Ticket } from "lucide-react";
import { Bloque, Dato } from "@/components/compartido/bloque-dato";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { SinConexion, UltimaSync } from "@/components/canales/estado-canal";
import { formatearMXN } from "@/lib/moneda";
import type { ResumenPagos } from "@/lib/canales/pagos";
import type { CarritosTN } from "@/lib/canales/salud";

/* ============================================================================
   Tienda Nube por dentro.
   ----------------------------------------------------------------------------
   Lo que se vendió está en Métricas. Aquí va lo que la tienda sabe y no llega a
   las ventas: lo que se quedó en el carrito y cómo termina pagando la gente.

   Tienda Nube NO expone por API sus estadísticas de visitas ni de conversión —
   solo las enseña en su panel—, así que ese pedazo no se puede traer y conviene
   decirlo en pantalla en vez de dejar un hueco que parezca un error.
   ============================================================================ */

/* El bloque de carritos se pinta aparte porque su dato viene de una llamada a
   Tienda Nube que tarda: la página se manda completa sin él y este trozo llega
   después (ver el <Suspense> de la page). */
export function BloqueCarritos({
  carritos,
  verDinero = true,
}: {
  carritos: CarritosTN | null;
  /* Lo que hay en los carritos viene de la API de Tienda Nube, no de la base:
     ninguna función de allá lo tapa y se decide aquí. Cuántos son y cuántos
     dejaron correo —lo accionable— lo ve todo el equipo. */
  verDinero?: boolean;
}) {
  if (!carritos) {
    return (
      <Bloque titulo="Lo que se quedó en el carrito" icono={ShoppingCart}>
        <p className="text-[13px] text-muted-foreground">
          Tienda Nube no respondió a tiempo. El resto de la página sale de las ventas ya
          importadas y sigue siendo válido.
        </p>
      </Bloque>
    );
  }
  return (
    <Bloque
      titulo="Lo que se quedó en el carrito"
      icono={ShoppingCart}
      pie={
        (carritos.truncado ? "Se leyeron los primeros 1 000; hay más. " : "") +
        "Compras que llegaron hasta el final y no se pagaron. Las que dejaron correo se pueden recuperar con un mensaje."
      }
    >
      <div className={verDinero ? "grid grid-cols-3 gap-3" : "grid grid-cols-2 gap-3"}>
        <Dato etiqueta="Carritos" valor={`${carritos.cantidad}${carritos.truncado ? "+" : ""}`} />
        {verDinero ? (
          <>
            <Dato
              etiqueta="En juego"
              valor={formatearMXN(carritos.monto)}
              className="text-amber-600"
            />
            <Dato
              etiqueta="Ticket promedio"
              valor={formatearMXN(carritos.cantidad > 0 ? carritos.monto / carritos.cantidad : 0)}
              detalle={
                carritos.conContacto === carritos.cantidad
                  ? "todos dejaron correo"
                  : `${carritos.conContacto} con correo`
              }
            />
          </>
        ) : (
          <Dato
            etiqueta="Con correo"
            valor={String(carritos.conContacto)}
            detalle="se pueden recuperar"
          />
        )}
      </div>
    </Bloque>
  );
}

/* Hueco del mismo tamaño mientras llega el bloque de arriba, para que la página
   no dé un salto cuando aparezca. */
export function CarritosCargando() {
  return (
    <Bloque titulo="Lo que se quedó en el carrito" icono={ShoppingCart}>
      <div className="grid grid-cols-3 gap-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="min-w-0">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-1.5 h-5 w-20 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </Bloque>
  );
}

export function PanelTiendaNube({
  conectada,
  ultimaSync,
  slotCarritos,
  pagos,
  dias,
  opcionesDias = [],
}: {
  conectada: boolean;
  ultimaSync: string | null;
  /* El bloque de carritos ya envuelto en su <Suspense>. */
  slotCarritos: React.ReactNode;
  /* Null = quien mira no ve el dinero de este canal (o la base aún no tiene la
     función). Los dos bloques de abajo son importes de arriba abajo, así que
     simplemente no se pintan. */
  pagos: ResumenPagos | null;
  dias: number;
  /* Ventanas elegibles (?dias=): la pidió Armando para no vivir clavado en 30. */
  opcionesDias?: number[];
}) {
  if (!conectada) return <SinConexion nombre="Tienda Nube" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-wrap items-baseline gap-2">
          <p className="text-[13.5px] text-muted-foreground">Últimos {dias} días</p>
          {/* Selector por enlaces (la página es de servidor): cada ventana
              recalcula carritos, pagos y cupones. */}
          {opcionesDias.length > 1 && (
            <span className="inline-flex items-center gap-1">
              {opcionesDias.map((n) => (
                <Link
                  key={n}
                  href={n === 30 ? "/canales/tiendanube" : `/canales/tiendanube?dias=${n}`}
                  className={cn(
                    "rounded-md px-2 py-0.5 text-[12px] font-semibold transition-colors",
                    n === dias
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {n}d
                </Link>
              ))}
            </span>
          )}
        </div>
        <UltimaSync ultimaSync={ultimaSync} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- Lo que se quedó a medias (llega en streaming) --- */}
        {slotCarritos}

        {/* --- Cómo paga la gente --- */}
        {pagos && pagos.pagos.length > 0 && (
          <Bloque
            titulo="Cómo paga la gente"
            icono={CreditCard}
            pie={`Sobre ${pagos.conDatoDePago.toLocaleString("es-MX")} órdenes del periodo.`}
          >
            <div className="flex flex-col gap-2">
              {pagos.pagos.slice(0, 6).map((p) => (
                <div key={p.metodo}>
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="min-w-0 truncate">{p.metodo}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {p.cantidad} · {formatearMXN(p.monto)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full bg-primary"
                      style={{ width: `${(p.cantidad / pagos.conDatoDePago) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
            {pagos.aMeses > 0 && (
              <p className="mt-3 border-t pt-3 text-[12.5px]">
                <strong className="tabular-nums">{pagos.aMeses}</strong> órdenes se pagaron a
                mensualidades ({((pagos.aMeses / pagos.conDatoDePago) * 100).toFixed(0)}%).
              </p>
            )}
          </Bloque>
        )}

        {/* --- Cupones --- */}
        {pagos && pagos.cupones.length > 0 && (
          <Bloque
            titulo="Cupones usados"
            icono={Ticket}
            pie="Cuánto se dejó de cobrar por cada código. Sirve para saber si el descuento se está pagando solo."
          >
            <div className="flex flex-col gap-2">
              {pagos.cupones.slice(0, 6).map((c) => (
                <div
                  key={c.codigo}
                  className="flex items-baseline justify-between gap-3 border-b pb-2 text-[13px] last:border-b-0 last:pb-0"
                >
                  <span className="min-w-0 truncate font-mono font-medium">{c.codigo}</span>
                  <span className="shrink-0 text-muted-foreground">
                    {c.usos} usos ·{" "}
                    <span className="tabular-nums">{formatearMXN(c.descuento)}</span> de descuento
                  </span>
                </div>
              ))}
            </div>
          </Bloque>
        )}

        {/* --- Punto de venta: acordado, todavía no construido --- */}
        <Bloque
          titulo="Punto de venta"
          icono={Store}
          pie="Las ventas del mostrador entrarán con canal propio, separadas de las de la tienda en línea, para poder comparar una contra otra."
        >
          <div className="flex items-center gap-2.5">
            <Badge variant="secondary" className="text-[10px]">
              Pronto
            </Badge>
            <span className="text-[13px] text-muted-foreground">
              Para la tienda física de Fresafit.
            </span>
          </div>
        </Bloque>
      </div>

      <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.9} />
        <span>
          Las visitas y la conversión de Tienda Nube no se pueden traer: su API no las expone,
          solo se ven en su panel. Lo que sí llega —carritos, formas de pago y cupones— está
          arriba.
        </span>
      </p>
    </div>
  );
}
