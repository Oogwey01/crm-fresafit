import { AlertTriangle, Info, Lock, Scissors, Split, Tag, TrendingUp } from "lucide-react";
import { StatCard } from "@/components/compartido/stat-card";
import { Bloque, Dato } from "@/components/compartido/bloque-dato";
import { SinConexion, UltimaSync } from "@/components/canales/estado-canal";
import { formatearMXN } from "@/lib/moneda";
import type { FinanzasTikTok } from "@/lib/tiktok/finanzas";
import type {
  FichaCanal,
  PrecioDispar,
  SaludCatalogoTikTok,
  SkuPartido,
} from "@/lib/tiktok/salud-catalogo";
import { cn } from "@/lib/utils";

/* ============================================================================
   TikTok Shop por dentro.
   ----------------------------------------------------------------------------
   Lo que de verdad querríamos enseñar aquí —cuánto vendió cada video, cada LIVE
   y cada afiliado— vive detrás de la familia /analytics de TikTok, y nuestra
   app NO tiene ese permiso: la API responde "access denied" a todas esas
   llamadas. Se dice en pantalla, con la gestión que haría falta, en vez de
   dejar el hueco sin explicación.

   Con lo que sí tenemos —las ventas ya importadas y el catálogo— se contestan
   dos cosas que no están en ningún otro lado: cuánto pesa el canal, y dónde el
   catálogo partido nos está costando dinero (mismo SKU, dos precios).
   ============================================================================ */

export type PesoCanal = {
  /* Null = quien mira no ve el dinero de este canal. */
  monto: number | null;
  piezas: number;
  renglones: number;
  /* Qué porcentaje del negocio entró por aquí en el periodo. Null también para
     el encargado del canal: es una división entre el total de TODOS, así que
     enseñarla junto al vendido de TikTok deja despejar la venta de los demás. */
  participacion: number | null;
  dias: number;
};

function nombreFicha(f: FichaCanal) {
  return f.variante ? `${f.nombre} · ${f.variante}` : f.nombre;
}

function canalDe(f: FichaCanal): string {
  if (f.tiendanube_product_id) return "Tienda Nube";
  if (f.meli_item_id) return "Mercado Libre";
  return "suelta";
}

function FilaPrecio({ p }: { p: PrecioDispar }) {
  const masBarato = p.diferencia < 0;
  return (
    <li className="flex items-center gap-3 border-b py-2.5 last:border-b-0">
      <span
        className={cn("size-2 shrink-0 rounded-full", masBarato ? "bg-red-500" : "bg-blue-500")}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13.5px] font-medium">{p.nombre}</div>
        <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">{p.sku}</div>
      </div>
      <div className="shrink-0 text-right text-[12.5px] tabular-nums">
        <div className="text-muted-foreground">
          TikTok {formatearMXN(p.enTikTok)} · resto {formatearMXN(p.enOtros)}
        </div>
        <div className={cn("font-semibold", masBarato ? "text-red-600" : "text-blue-600")}>
          {masBarato ? "más barato" : "más caro"} por {formatearMXN(Math.abs(p.diferencia))}
        </div>
      </div>
    </li>
  );
}

function FilaPartida({ s }: { s: SkuPartido }) {
  return (
    <li className="border-b py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-mono text-[13px] font-semibold">{s.sku}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
          {s.enTikTok.length + s.enOtros.length} fichas · {s.stockTikTok + s.stockOtros} piezas
          repartidas
        </span>
      </div>
      <div className="mt-1.5 flex flex-col gap-1">
        {[...s.enTikTok, ...s.enOtros].map((f) => (
          <div key={f.id} className="flex items-baseline justify-between gap-3 text-[12.5px]">
            <span className="min-w-0 truncate text-muted-foreground">{nombreFicha(f)}</span>
            <span className="shrink-0 tabular-nums">
              <span className="text-muted-foreground">
                {f.tiktok_product_id ? "TikTok" : canalDe(f)}
              </span>{" "}
              <strong>{f.stock}</strong>
            </span>
          </div>
        ))}
      </div>
    </li>
  );
}

export function PanelTikTok({
  conectada,
  ultimaSync,
  salud,
  peso,
  finanzas,
}: {
  conectada: boolean;
  ultimaSync: string | null;
  salud: SaludCatalogoTikTok;
  peso: PesoCanal;
  /* Null = TikTok no contestó o no hay cortes en el periodo. */
  finanzas: FinanzasTikTok | null;
}) {
  if (!conectada) return <SinConexion nombre="TikTok Shop" />;

  /* El importe del canal es la señal: llega en null exactamente cuando quien
     mira no puede ver el dinero de TikTok, y ese mismo permiso gobierna los
     precios y las liquidaciones. Una prop aparte diría lo mismo dos veces. */
  const verDinero = peso.monto !== null;
  const ticket = verDinero && peso.renglones > 0 ? peso.monto! / peso.renglones : null;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[13.5px] text-muted-foreground">Últimos {peso.dias} días</p>
        <UltimaSync ultimaSync={ultimaSync} />
      </div>

      {/* --- Cuánto pesa el canal. Sin importes quedan dos tarjetas, así que la
              rejilla baja a dos columnas en vez de dejar la fila a medias. --- */}
      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2",
          peso.monto !== null ? "lg:grid-cols-4" : "lg:grid-cols-2",
        )}
      >
        <StatCard
          etiqueta="Vendido en TikTok"
          valor={
            peso.monto !== null
              ? formatearMXN(peso.monto)
              : `${peso.piezas.toLocaleString("es-MX")} pzas`
          }
          icono={TrendingUp}
          nota={
            peso.monto !== null
              ? `${peso.piezas.toLocaleString("es-MX")} piezas`
              : `${peso.renglones.toLocaleString("es-MX")} ventas`
          }
        />
        {peso.participacion !== null && (
          <StatCard
            etiqueta="Del negocio"
            valor={`${peso.participacion.toFixed(0)}%`}
            icono={TrendingUp}
            nota="de la venta total del periodo"
          />
        )}
        {ticket !== null && (
          <StatCard
            etiqueta="Ticket promedio"
            valor={formatearMXN(ticket)}
            icono={Tag}
            nota="por renglón vendido"
          />
        )}
        {/* La comparativa de precios se apoya en `products.precio`, que tampoco
            viaja sin permiso: sin él la cuenta daría cero y la nota diría «todos
            coinciden», que es afirmar algo que no se sabe. */}
        {verDinero && (
          <StatCard
            etiqueta="Precios que no cuadran"
            valor={String(salud.preciosDispares.length)}
            icono={AlertTriangle}
            valorClassName={salud.masBaratosEnTikTok > 0 ? "text-red-600" : undefined}
            nota={
              salud.masBaratosEnTikTok > 0
                ? `${salud.masBaratosEnTikTok} más baratos en TikTok`
                : "todos coinciden"
            }
          />
        )}
      </div>

      {/* --- Lo que la plataforma se queda --- */}
      {finanzas && (
        <Bloque
          titulo="Lo que TikTok se queda"
          icono={Scissors}
          pie={`De ${finanzas.cortes} cortes de liquidación ya pagados. Las ventas que importa el CRM traen el precio que pagó el comprador; esto es lo que sobrevive a la comisión y llega a la cuenta.`}
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Dato etiqueta="Vendido en los cortes" valor={formatearMXN(finanzas.venta)} />
            <Dato
              etiqueta="Comisión de TikTok"
              valor={formatearMXN(finanzas.comision)}
              detalle={`${finanzas.tasa.toFixed(1)}% de la venta`}
              className="text-red-600"
            />
            {/* Puede venir negativo: cuando TikTok subsidia el envío, el corte
                trae un crédito y no un cargo. Se dice cuál de los dos es en vez
                de enseñar un "cargo" en negativo. */}
            <Dato
              etiqueta="Envíos"
              valor={formatearMXN(Math.abs(finanzas.envio))}
              detalle={finanzas.envio < 0 ? "a favor nuestro" : "a nuestro cargo"}
            />
            <Dato
              etiqueta="Depositado"
              valor={formatearMXN(finanzas.depositado)}
              detalle="lo que llegó al banco"
              className="text-green-600"
            />
          </div>
          {/* Barra de una sola línea: qué proporción se va y cuál queda. */}
          <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-muted">
            <span
              className="bg-green-500"
              style={{
                width: `${finanzas.venta > 0 ? (finanzas.depositado / finanzas.venta) * 100 : 0}%`,
              }}
            />
            <span
              className="bg-red-500"
              style={{ width: `${Math.min(100, finanzas.tasa)}%` }}
            />
          </div>
        </Bloque>
      )}

      {/* --- El permiso que falta --- */}
      <p className="flex items-start gap-2 rounded-xl bg-amber-500/10 p-3.5 text-[13px] leading-relaxed text-amber-700 dark:text-amber-500">
        <Lock className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
        <span>
          Lo que vendió cada video, cada LIVE y cada afiliado sigue sin poder traerse: el token
          vigente lista sus permisos y entre ellos no está{" "}
          <code>data.shop_analytics.public.read</code>, así que TikTok responde “acceso denegado”.
          Activarlo en la app no basta —renovar el token no lo recoge—: hay que{" "}
          <strong>volver a autorizar la tienda</strong> desde Inventario para que el permiso nuevo
          entre. En cuanto esté, esta página puede mostrar el GMV por contenido.
        </span>
      </p>

      {/* --- Precios dispares: lo que cuesta dinero hoy --- */}
      {verDinero && (
      <section>
        <h2 className="mb-1 text-[17px] font-bold tracking-[-0.3px]">
          El mismo producto a dos precios
        </h2>
        <p className="mb-3 text-[13.5px] text-muted-foreground">
          SKUs cuya ficha de TikTok tiene un precio de lista distinto al del resto del CRM. Como
          los catálogos están separados, cambiar el precio de un lado no toca el otro y la brecha
          se queda ahí sin que nadie la vea.
        </p>
        {salud.preciosDispares.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-[13.5px] text-muted-foreground">
            Los precios coinciden en todos los SKUs comparables.
          </p>
        ) : (
          <>
            <div className="rounded-2xl border bg-card px-5 py-1 shadow-sm">
              <ul>
                {salud.preciosDispares.slice(0, 25).map((p) => (
                  <FilaPrecio key={p.sku} p={p} />
                ))}
              </ul>
            </div>
            {salud.preciosDispares.length > 25 && (
              <p className="mt-2 text-[12px] text-muted-foreground">
                Se muestran los 25 con más brecha, de {salud.preciosDispares.length}.
              </p>
            )}
          </>
        )}
      </section>
      )}

      {/* --- La causa de fondo --- */}
      <section>
        <h2 className="mb-1 text-[17px] font-bold tracking-[-0.3px]">Fichas partidas por SKU</h2>
        <p className="mb-3 text-[13.5px] text-muted-foreground">
          La raíz del problema de arriba: {salud.vinculadas} publicaciones de TikTok entraron al
          CRM con fichas propias y ninguna quedó enganchada a Tienda Nube o Mercado Libre. Por eso
          sus ventas descuentan de una ficha aparte y no de la bodega que ve el resto del sistema.
        </p>
        {salud.partidos.length === 0 ? (
          <p className="rounded-xl border border-dashed p-6 text-center text-[13.5px] text-muted-foreground">
            No hay SKUs repartidos entre TikTok y los demás canales.
          </p>
        ) : (
          <>
            <div className="rounded-2xl border bg-card px-5 py-1 shadow-sm">
              <ul>
                {salud.partidos.slice(0, 15).map((s) => (
                  <FilaPartida key={s.sku} s={s} />
                ))}
              </ul>
            </div>
            <p className="mt-2 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <Split className="size-3.5" strokeWidth={1.9} />
              {salud.partidos.length} SKUs partidos en total; se muestran los 15 con más piezas en
              juego.
            </p>
          </>
        )}
      </section>

      <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.9} />
        <span>
          El CRM no escribe el stock de TikTok: los ajustes se siguen haciendo en su panel. Y
          TikTok tampoco nos reporta sus existencias (<code>tiktok_stock</code> viene vacío en las{" "}
          {salud.vinculadas} fichas), así que por ahora no hay forma de comparar inventarios.
        </span>
      </p>
    </div>
  );
}
