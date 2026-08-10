/* ============================================================================
   lib/envia/rastreo.ts — Qué pasó de verdad con el paquete
   ----------------------------------------------------------------------------
   Los envíos de Tienda Nube salen con "Envío Nube", que por debajo es envia.com,
   y de ahí cuelgan Estafeta, FedEx y compañía. El CRM ya guardaba la guía pero
   nunca preguntaba por ella: el estado del pedido dependía por completo de que
   el canal avisara, y el canal casi nunca avisaba de la entrega. Resultado: los
   pedidos se quedaban en "enviado" para siempre y acababan contados como
   atrasados. Peor todavía, una devolución era indistinguible de un envío en
   camino — las dos primeras guías que se probaron aquí resultaron ser paquetes
   devueltos que el CRM daba por enviados desde mayo.

   ADVERTENCIA, y es la razón de que este módulo cuente sus fallos en voz alta:
   el endpoint que se usa es el que consume el buscador público de envia.com
   (`?is_landing=true` es lo que le salta la autenticación). NO está documentado.
   Funciona hoy —verificado contra guías reales— pero envia.com puede cerrarlo,
   meterle un límite o cambiarle la forma cualquier día y sin avisar, porque para
   ellos no es una API pública. Por eso `rastrearGuias` distingue "esta guía no
   la conozco" (respuesta legítima y vacía) de "el servicio no contestó", y el
   cron que lo llama se niega a concluir nada cuando falla todo: quedarse callado
   marcando de menos se leería como "no hubo entregas", que es exactamente el
   error que este módulo viene a arreglar.

   La alternativa oficial, si algún día se cierra, es el `fulfillment_order` de
   Tienda Nube (sus `tracking_events` traen `delivered` y `returned_to_sender`
   con el permiso que la app ya tiene).

   Solo servidor. Sin credenciales ni variables de entorno.
   ============================================================================ */

const URL_RASTREO = "https://queries.envia.com/shipments/generaltrack?is_landing=true";

/* Su propia página trocea en grupos de diez; se respeta el mismo tamaño. */
const TAM_LOTE = 10;
const LOTES_EN_PARALELO = 3;
const TIMEOUT_MS = 15_000;

/* Lo que el rastreo permite concluir sobre el pedido.
     entregado / devuelto → el viaje terminó y el estado del pedido cambia.
     incidencia           → algo va mal (extravío, daño, dirección imposible)
                            pero NO se toca el estado: eso lo mira una persona.
     null                 → sigue en camino, o el estado no dice nada útil. */
export type DesenlaceRastreo = "entregado" | "devuelto" | "incidencia" | null;

export type Rastreo = {
  guia: string;
  /* Texto tal cual lo da el proveedor ("Delivered at Origin", "Returned"…). Se
     guarda sin traducir a propósito: si aparece uno que no está en el mapa, el
     dato crudo queda en la base y se puede clasificar después sin volver a
     preguntar. */
  estado: string;
  desenlace: DesenlaceRastreo;
  /* El último movimiento en palabras ("[RTO] Entregado", "Exception: Empresa
     Cerrada - Sin Intento De Entrega"). Es lo que hoy obliga a abrir el
     navegador para enterarse de por qué un paquete no llegó. */
  detalle: string | null;
  entregadoEn: string | null;
  paqueteria: string | null;
};

/* --- El catálogo de estados de envia.com, agrupado por lo que significan ---
   Son 28 en total. Se comparan normalizados (minúsculas, sin espacios de más) y
   COMPLETOS, nunca por trozos: "Delivered at Origin" NO es una entrega, es un
   paquete que volvió al remitente, y buscar "delivered" dentro del texto los
   confundiría —que es justo el error que dejaría una devolución marcada como
   entregada—. */
const ENTREGADO = new Set(["delivered"]);

const DEVUELTO = new Set([
  "returned", // volvió al remitente
  "delivered at origin", // idem: "entregado" en el origen
  "return problem", // viene de regreso y con un problema encima
]);

const INCIDENCIA = new Set([
  "lost",
  "damaged",
  "undeliverable",
  "rejected",
  "address error",
  "canceled",
  "cancelled",
]);

function normalizar(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function desenlaceDe(estado: string): DesenlaceRastreo {
  const e = normalizar(estado);
  if (ENTREGADO.has(e)) return "entregado";
  if (DEVUELTO.has(e)) return "devuelto";
  if (INCIDENCIA.has(e)) return "incidencia";
  return null; // en tránsito, recolectado, intento de entrega, o desconocido
}

/* --- La forma de la respuesta, declarada de mínimos ---
   Solo lo que se usa: cuanto menos se declare, menos hay que arreglar el día que
   añadan campos. */
type EnvioRastreado = {
  trackingNumber?: string | null;
  status?: string | null;
  carrierDescription?: string | null;
  carrier?: string | null;
  deliveredAt?: string | null;
  eventHistory?: { description?: string | null; date?: string | null; location?: string | null }[] | null;
};

/* El movimiento más reciente. Hay que ORDENAR: el historial no viene siempre de
   nuevo a viejo (de dos guías reales, una llegó al revés que la otra), así que
   quedarse con el primer elemento daba a veces el evento más antiguo. */
function ultimoEvento(envio: EnvioRastreado): string | null {
  const eventos = (envio.eventHistory ?? []).filter((e) => e?.description);
  if (eventos.length === 0) return null;
  const ordenados = [...eventos].sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const ultimo = ordenados[ordenados.length - 1];
  const donde = ultimo.location?.trim();
  return `${ultimo.description!.trim()}${donde ? ` — ${donde}` : ""}`;
}

/* Una fecha "2026-06-09 09:50:00" (sin huso) a ISO. El proveedor no declara zona;
   se interpreta como hora de México, que es donde ocurren los envíos. */
function aISO(fecha: string | null | undefined): string | null {
  if (!fecha) return null;
  const t = Date.parse(fecha.replace(" ", "T") + "-06:00");
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function consultarLote(guias: string[]): Promise<EnvioRastreado[]> {
  const res = await fetch(URL_RASTREO, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackingNumbers: guias }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`El rastreo respondió ${res.status}.`);
  const data: unknown = await res.json();
  /* Un array vacío es una respuesta legítima ("ninguna de estas guías la
     conozco"); cualquier otra forma significa que el endpoint cambió y no se
     puede seguir interpretando lo que manda. */
  if (!Array.isArray(data)) throw new Error("El rastreo devolvió algo que no es una lista de envíos.");
  return data as EnvioRastreado[];
}

export type ResultadoRastreo = {
  /* Solo las guías de las que se supo algo. Una guía ausente no es un error:
     puede no existir en envia.com (una guía de otra paquetería, por ejemplo). */
  porGuia: Map<string, Rastreo>;
  /* Cuántos lotes se pidieron y cuántos fallaron. El cron lo usa para no sacar
     conclusiones de una corrida rota. */
  lotes: number;
  lotesFallidos: number;
  /* Las guías de los lotes que fallaron: de éstas NO se sabe nada, a diferencia
     de las que simplemente no vinieron en la respuesta (ésas es que el
     proveedor no las conoce). El cron las reintenta por la API de Tienda Nube.
     La distinción importa: sin ella, un servicio caído y una guía ajena se
     verían igual. */
  guiasSinConsultar: Set<string>;
  errores: string[];
};

export async function rastrearGuias(guias: string[]): Promise<ResultadoRastreo> {
  const unicas = [...new Set(guias.map((g) => g.trim()).filter(Boolean))];
  const porGuia = new Map<string, Rastreo>();
  const guiasSinConsultar = new Set<string>();
  const errores: string[] = [];
  let lotes = 0;
  let lotesFallidos = 0;

  const tandas: string[][] = [];
  for (let i = 0; i < unicas.length; i += TAM_LOTE) tandas.push(unicas.slice(i, i + TAM_LOTE));

  /* En oleadas cortas: es un servicio ajeno y gratuito, no hay que castigarlo. */
  for (let i = 0; i < tandas.length; i += LOTES_EN_PARALELO) {
    const oleada = tandas.slice(i, i + LOTES_EN_PARALELO);
    const respuestas = await Promise.all(
      oleada.map(async (lote) => {
        try {
          return { lote, envios: await consultarLote(lote), error: null as string | null };
        } catch (e) {
          return {
            lote,
            envios: [] as EnvioRastreado[],
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }),
    );
    for (const r of respuestas) {
      lotes++;
      if (r.error) {
        lotesFallidos++;
        for (const g of r.lote) guiasSinConsultar.add(g);
        if (errores.length < 5) errores.push(r.error);
        continue;
      }
      for (const envio of r.envios) {
        const guia = envio.trackingNumber?.trim();
        const estado = envio.status?.trim();
        if (!guia || !estado) continue;
        porGuia.set(guia, {
          guia,
          estado,
          desenlace: desenlaceDe(estado),
          detalle: ultimoEvento(envio),
          entregadoEn: aISO(envio.deliveredAt),
          paqueteria: envio.carrierDescription?.trim() || envio.carrier?.trim() || null,
        });
      }
    }
  }

  return { porGuia, lotes, lotesFallidos, guiasSinConsultar, errores };
}
