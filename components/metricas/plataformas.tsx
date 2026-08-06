"use client";

import { AlertTriangle, CreditCard, Eye, ShoppingCart, Ticket, TrendingUp } from "lucide-react";
import { Bloque, Dato } from "@/components/compartido/bloque-dato";
import { Pastilla } from "@/components/compartido/pastilla";
import { formatearMXN } from "@/lib/moneda";
import { cn } from "@/lib/utils";
import type { CarritosTN, SaludML, VisitasML } from "@/lib/canales/salud";
import type { ResumenMetricas } from "@/lib/types";

/* ============================================================================
   Lo que las plataformas saben y el CRM no mostraba.
   ----------------------------------------------------------------------------
   El resto de Métricas contesta "cuánto se vendió". Esto contesta por qué: a
   cuánta gente se le enseñó el producto, qué porcentaje compró, cómo pagó, y si
   Mercado Libre nos está mostrando o escondiendo.

   Cada bloque aparece solo si su canal respondió: la sección no se queda a
   medias ni miente con ceros cuando en realidad es que la API no contestó.
   ============================================================================ */

/* El semáforo de reputación de Mercado Libre. Su `level_id` es un código
   ("5_green"); lo que importa al verlo es el color y si estás arriba o abajo. */
const NIVELES_ML: Record<string, { nombre: string; color: string }> = {
  "5_green": { nombre: "Verde", color: "#00b894" },
  "4_light_green": { nombre: "Verde claro", color: "#55efc4" },
  "3_yellow": { nombre: "Amarillo", color: "#fdcb6e" },
  "2_orange": { nombre: "Naranja", color: "#e17055" },
  "1_red": { nombre: "Rojo", color: "#d63031" },
};

const CATEGORIAS_ML: Record<string, string> = {
  platinum: "Platinum",
  gold: "MercadoLíder Gold",
  silver: "MercadoLíder",
};

const casos = (n: number) => `${n} ${n === 1 ? "caso" : "casos"}`;

export function Plataformas({
  bloquesCanales,
  pagos,
}: {
  /* Los tres bloques que se leen EN VIVO de Mercado Libre y Tienda Nube. Llegan
     ya renderizados desde el servidor, dentro de un <Suspense>: pedirlos tarda
     segundos y antes retrasaba la pantalla entera (ver la page de Métricas). */
  bloquesCanales: React.ReactNode;
  /* Desglose de pagos del periodo, ya resumido por la base (antes se recibían
     las órdenes crudas y se sumaban aquí). */
  pagos: ResumenMetricas["pagos"];
}) {
  /* Cómo pagó la gente. Solo Tienda Nube manda el dato; el resto llega nulo y
     simplemente no entra en el conteo. */
  const { pagos: pagosOrdenados, cupones, aMeses, conDatoDePago } = pagos;
  const cuponesOrdenados = cupones.slice(0, 5);

  return (
    <div className="mt-6">
      <h2 className="mb-1 text-[17px] font-bold tracking-[-0.3px]">Las plataformas por dentro</h2>
      <p className="mb-3.5 text-[13.5px] text-muted-foreground">
        Datos que viven en Mercado Libre y Tienda Nube y que no llegan a las ventas.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        {bloquesCanales}

        {/* --- Cómo paga la gente --- */}
        {pagosOrdenados.length > 0 && (
          <Bloque
            titulo="Cómo paga la gente"
            icono={CreditCard}
            pie={`Sobre ${conDatoDePago.toLocaleString("es-MX")} órdenes del periodo que traen medio de pago (hoy solo Tienda Nube lo reporta).`}
          >
            <div className="flex flex-col gap-2">
              {pagosOrdenados.slice(0, 5).map((p) => {
                const pct = (p.cantidad / conDatoDePago) * 100;
                return (
                  <div key={p.metodo}>
                    <div className="flex items-baseline justify-between gap-3 text-[13px]">
                      <span className="min-w-0 truncate">{p.metodo}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">
                        {p.cantidad} · {formatearMXN(p.monto)}
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                      <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            {aMeses > 0 && (
              <p className="mt-3 border-t pt-3 text-[12.5px]">
                <strong className="tabular-nums">{aMeses}</strong> órdenes se pagaron a
                mensualidades ({((aMeses / conDatoDePago) * 100).toFixed(0)}% de las que traen
                dato).
              </p>
            )}
          </Bloque>
        )}

        {/* --- Cupones --- */}
        {cuponesOrdenados.length > 0 && (
          <Bloque
            titulo="Cupones usados"
            icono={Ticket}
            pie="Cuánto se dejó de cobrar por cada código en el periodo. Sirve para saber si el descuento se está pagando solo."
          >
            <div className="flex flex-col gap-2">
              {cuponesOrdenados.map((c) => (
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
      </div>
    </div>
  );
}

/* Los tres bloques que se leen EN VIVO de las plataformas. Van aparte porque la
   página los envuelve en su propio <Suspense>: pedirlos a Mercado Libre y Tienda
   Nube tarda segundos, y mientras tanto el resto de Métricas —que sale de la
   base— ya se puede ver. Cada uno aparece solo si su canal respondió: la sección
   no se queda a medias ni miente con ceros cuando en realidad es que la API no
   contestó. */
export function BloquesCanales({
  visitas,
  salud,
  carritos,
  ventasML,
  verDineroTN,
}: {
  visitas: VisitasML | null;
  salud: SaludML | null;
  carritos: CarritosTN | null;
  /* Unidades vendidas en Mercado Libre en la misma ventana que las visitas. */
  ventasML: number;
  /* Lo que hay en los carritos sale de la API de Tienda Nube, no de la base, así
     que ninguna función de allá lo tapa: se decide aquí. Cuántos carritos hay
     —y cuántos dejaron correo, que es lo accionable— lo ve todo el equipo. */
  verDineroTN: boolean;
}) {
  /* Conversión: de cada 100 que vieron una publicación, cuántos compraron. Es el
     número que ninguna plataforma da masticado y el que dice si el problema es
     de tráfico o de la publicación. */
  const conversion = visitas && visitas.total > 0 ? (ventasML / visitas.total) * 100 : null;

  const nivel = salud?.nivel ? NIVELES_ML[salud.nivel] : null;
  /* Un reclamo o una demora reales importan aunque ML los excluya de su métrica
     pública: son clientes molestos de todas formas. */
  const hayPendientes = !!salud && (salud.demoras.real > 0 || salud.reclamos.real > 0);

  return (
    <>
      {visitas && (
        <Bloque
          titulo="Mercado Libre · quién nos vio"
          icono={Eye}
          pie={`Visitas a todas las publicaciones entre el ${visitas.desde} y el ${visitas.hasta}. La conversión compara esas visitas con las unidades vendidas en el mismo tramo.`}
        >
          <div className="grid grid-cols-2 gap-4">
            <Dato
              etiqueta="Visitas"
              valor={visitas.total.toLocaleString("es-MX")}
              detalle="últimos 30 días"
            />
            <Dato
              etiqueta="Conversión"
              valor={conversion !== null ? `${conversion.toFixed(2)}%` : "—"}
              detalle={`${ventasML.toLocaleString("es-MX")} unidades vendidas`}
              className={
                conversion !== null
                  ? conversion >= 2
                    ? "text-green-600"
                    : conversion < 1
                      ? "text-amber-600"
                      : undefined
                  : undefined
              }
            />
          </div>
        </Bloque>
      )}

      {/* --- Salud de la cuenta de Mercado Libre --- */}
      {salud && (
        <Bloque
          titulo="Mercado Libre · cómo nos ve la plataforma"
          icono={TrendingUp}
          pie="Porcentajes de los últimos 60 días contando TODOS los casos, incluidos los que Mercado Libre excluye de su cifra pública. El detalle —cuánto margen queda antes de bajar de nivel y qué pedidos están por vencerse— está en Canales."
        >
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {nivel && <Pastilla nombre={`Nivel ${nivel.nombre}`} color={nivel.color} />}
            {salud.categoria && (
              <Pastilla
                nombre={CATEGORIAS_ML[salud.categoria] ?? salud.categoria}
                color="#0984e3"
              />
            )}
            {hayPendientes && (
              <span className="inline-flex items-center gap-1 text-[12px] font-medium text-amber-600">
                <AlertTriangle className="size-3.5" strokeWidth={2} />
                hay casos abiertos
              </span>
            )}
          </div>
          {/* Las tasas REALES, no las que ML publica: cuando la cuenta está
              protegida su cifra es 0% y esconde los casos que sí ocurrieron.
              Es el mismo número que enseña Canales, para que las dos
              pantallas no se contradigan. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Dato
              etiqueta="Reclamos"
              valor={`${(salud.reclamos.realRate * 100).toFixed(1)}%`}
              detalle={casos(salud.reclamos.real)}
            />
            <Dato
              etiqueta="Envíos con demora"
              valor={`${(salud.demoras.realRate * 100).toFixed(1)}%`}
              detalle={casos(salud.demoras.real)}
              className={salud.demoras.real > 10 ? "text-amber-600" : undefined}
            />
            <Dato
              etiqueta="Cancelaciones"
              valor={`${(salud.cancelaciones.realRate * 100).toFixed(1)}%`}
              detalle={casos(salud.cancelaciones.real)}
            />
          </div>
          <div className="mt-3 border-t pt-3">
            <div className="text-[11.5px] text-muted-foreground">
              Calificaciones históricas ({salud.ventasCompletadas.toLocaleString("es-MX")} ventas
              completadas)
            </div>
            <div className="mt-1.5 flex h-2 overflow-hidden rounded-full bg-muted">
              <span
                className="bg-green-500"
                style={{ width: `${salud.calificaciones.positivas * 100}%` }}
              />
              <span
                className="bg-yellow-400"
                style={{ width: `${salud.calificaciones.neutras * 100}%` }}
              />
              <span
                className="bg-red-500"
                style={{ width: `${salud.calificaciones.negativas * 100}%` }}
              />
            </div>
            <div className="mt-1.5 flex flex-wrap gap-x-3 text-[12px] text-muted-foreground">
              <span>{(salud.calificaciones.positivas * 100).toFixed(0)}% positivas</span>
              <span>{(salud.calificaciones.neutras * 100).toFixed(0)}% neutras</span>
              <span
                className={cn(
                  salud.calificaciones.negativas > 0.1 && "font-semibold text-red-600",
                )}
              >
                {(salud.calificaciones.negativas * 100).toFixed(0)}% negativas
              </span>
            </div>
          </div>
        </Bloque>
      )}

      {/* --- Carritos abandonados en Tienda Nube --- */}
      {carritos && carritos.cantidad > 0 && (
        <Bloque
          titulo="Tienda Nube · lo que se quedó en el carrito"
          icono={ShoppingCart}
          pie={
            (carritos.truncado ? "Se leyeron los primeros 1 000; hay más. " : "") +
            "Compras que llegaron hasta el final y no se pagaron, de los últimos 30 días. Las que dejaron correo se pueden recuperar con un mensaje."
          }
        >
          {/* Dos columnas en el teléfono: son importes, y en tres el «en
              juego» se montaba encima del ticket promedio. */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Dato
              etiqueta="Carritos"
              valor={`${carritos.cantidad}${carritos.truncado ? "+" : ""}`}
            />
            {verDineroTN ? (
              <>
                <Dato
                  etiqueta="En juego"
                  valor={formatearMXN(carritos.monto)}
                  className="text-amber-600"
                />
                <Dato
                  etiqueta="Ticket promedio"
                  valor={formatearMXN(
                    carritos.cantidad > 0 ? carritos.monto / carritos.cantidad : 0,
                  )}
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
      )}
    </>
  );
}

/* Hueco mientras las plataformas contestan. Imita el alto de los dos bloques de
   Mercado Libre para que la página no pegue un salto al aterrizar. */
export function BloquesCanalesCargando() {
  return (
    <>
      {[0, 1].map((i) => (
        <div key={i} className="h-[188px] animate-pulse rounded-2xl border bg-card shadow-sm" />
      ))}
    </>
  );
}
