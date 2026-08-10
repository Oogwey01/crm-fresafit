/* ============================================================================
   lib/pedidos/conciliar-envios.ts — Cerrar los pedidos que ya llegaron
   ----------------------------------------------------------------------------
   Un pedido despachado se quedaba en "enviado" indefinidamente: el canal casi
   nunca avisa de la entrega, así que la bandeja de Pedidos acumulaba paquetes
   que llevaban semanas en casa del cliente —y algunos que ni siquiera llegaron,
   porque una devolución se veía exactamente igual—.

   Esto lo resuelve en dos pasos, en este orden:

     1. PREGUNTAR. Se rastrea la guía de cada pedido enviado (lib/envia/rastreo).
        Lo que el rastreo diga manda: entregado, devuelto, o una incidencia que
        se anota sin tocar el estado para que la mire una persona.

        Con DOS fuentes y una jerarquía deliberada. La principal es el buscador
        de envia.com: un viaje por cada diez guías, y en la comparación sobre 76
        órdenes reales resolvió todo lo que resolvía la otra y dos más. El plan B
        es la API oficial de Tienda Nube (`ultimoEventoEnvioTN`), que solo entra
        cuando la primera FALLA —no cuando simplemente no conoce una guía—,
        porque es una petición por orden y ya sabemos que no aporta cobertura
        extra. Existe por seguro de vida: envia.com puede cerrar su endpoint
        cualquier día y ahí el CRM no puede quedarse ciego. El contador
        `respaldoTN` del resumen es el chivato: si deja de ser cero día tras día,
        toca invertir las dos fuentes.

     2. CERRAR LO QUE NADIE CONTESTA. Guías viejas, paqueterías mudas, envíos que
        el rastreo no reconoce. A los 21 días se dan por entregados: cualquier
        envío nacional ya llegó o ya se regresó, y dejarlos ahí para siempre es
        lo que ensuciaba la bandeja. Con dos excepciones, abajo.

   NO SE CIERRAN SOLOS LOS PERSONALIZADOS. Se fabrican cuando alguien los compra
   y han llegado a tardar dos meses; darlos por entregados a las tres semanas
   sería inventar. `sales` no tiene ninguna columna que diga "esto es
   personalizado", así que se reconoce por el producto y con criterio amplio: o
   está marcado `bajo_pedido`, o tiene ficha de maquila, o no se sabe qué
   producto es. Cualquiera de las tres lo deja fuera del cierre automático. Es a
   propósito conservador: excluir de más solo deja un pedido a la vista; excluir
   de menos cierra a ciegas algo que sigue en producción.

   Y si el rastreo no contesta, aquí no se concluye NADA —ni siquiera el cierre
   por antigüedad—: sin saber qué pasó, marcar entregado a ciegas podría estar
   dando por bueno un paquete devuelto.

   Solo servidor (service role).
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/canales/paginacion";
import { traerPorLotes } from "@/lib/supabase/lotes";
import { diasDesdeHoy } from "@/lib/fecha";
import { rastrearGuias, type DesenlaceRastreo, type Rastreo } from "@/lib/envia/rastreo";
import { conexionTiendanube, ultimoEventoEnvioTN } from "@/lib/tiendanube/api";

/* Hasta dónde mirar hacia atrás. Más allá, un pedido "enviado" ya no es un
   pendiente sino un resto del histórico, y su guía tampoco vive en el rastreo. */
const DIAS_VENTANA = 60;

/* Cuándo se da por entregado un envío del que nadie dice nada. Holgado a
   propósito: a las tres semanas, un envío nacional llegó o se regresó. */
export const DIAS_CIERRE_AUTOMATICO = 21;

/* Mercado Libre queda fuera: su logística es suya y sus guías no están en
   envia.com, así que preguntar por ellas es gastar peticiones para nada. Su
   estado —incluida la devolución— llega por el `substatus` del envío en la sync
   (ver lib/mercadolibre/ventas.ts).

   TikTok Shop SÍ se pregunta, aunque hoy no sirva de nada: en la primera corrida
   contra datos reales, ninguna de sus 92 guías la reconoció envia.com (usa otra
   paquetería). Se deja dentro porque preguntar cuesta diez peticiones al día y el
   día que una guía suya aparezca, se aprovecha sola; mientras tanto, sus pedidos
   los cierra la sync o la regla de los 21 días. */
const CANALES_SIN_RASTREO = ["mercado_libre"];

type PedidoEnviado = {
  id: string;
  fecha: string;
  canal: string;
  num_guia: string | null;
  referencia_externa: string | null;
  producto_id: string | null;
  producto: { bajo_pedido: boolean | null } | null;
};

/* --- El plan B: los tracking_events de Tienda Nube ---
   Sus estados son propios (`delivered`, `returned_to_sender`…), no los textos en
   inglés de envia.com, así que se traducen aparte. Un intento de entrega fallido
   NO es un final: el paquete sigue vivo y puede llegar mañana. */
const DESENLACE_TN: Record<string, DesenlaceRastreo> = {
  delivered: "entregado",
  returned_to_sender: "devuelto",
  lost: "incidencia",
  failure: "incidencia",
};

/* Pregunta a Tienda Nube por las órdenes que envia.com no pudo contestar. Es una
   petición por orden (contra un solo viaje por cada diez guías del otro lado),
   de ahí que sea el respaldo y no la vía principal. Los errores se tragan por
   orden: que una falle no puede tumbar el repaso entero. */
async function rastreoDeRespaldoTN(
  pedidos: PedidoEnviado[],
): Promise<{ porGuia: Map<string, Rastreo>; consultadas: number }> {
  const porGuia = new Map<string, Rastreo>();
  const deTN = pedidos.filter((p) => p.canal === "tienda_nube" && p.referencia_externa && p.num_guia);
  if (deTN.length === 0) return { porGuia, consultadas: 0 };

  const cx = await conexionTiendanube();
  if (!cx) return { porGuia, consultadas: 0 };

  /* Una orden puede traer varios renglones y todos comparten envío: se pregunta
     una sola vez por orden. */
  const porOrden = new Map<number, string>();
  for (const p of deTN) {
    const num = Number(p.referencia_externa!.split(":")[0]);
    if (Number.isFinite(num)) porOrden.set(num, p.num_guia!);
  }

  const ordenes = [...porOrden.entries()];
  const EN_PARALELO = 5;
  for (let i = 0; i < ordenes.length; i += EN_PARALELO) {
    await Promise.all(
      ordenes.slice(i, i + EN_PARALELO).map(async ([orden, guia]) => {
        try {
          const ev = await ultimoEventoEnvioTN(cx, orden);
          if (!ev) return;
          porGuia.set(guia, {
            guia,
            estado: ev.status,
            desenlace: DESENLACE_TN[ev.status] ?? null,
            detalle: ev.descripcion ?? ev.status.replace(/_/g, " "),
            entregadoEn: DESENLACE_TN[ev.status] === "entregado" ? ev.cuando : null,
            paqueteria: null,
          });
        } catch (e) {
          console.error(`[conciliar-envios] respaldo TN de la orden ${orden}:`, e);
        }
      }),
    );
  }
  return { porGuia, consultadas: ordenes.length };
}

export type ResumenConciliacion = {
  revisados: number;
  consultados: number;
  respondieron: number;
  /* Cuántas resolvió el plan B (la API de Tienda Nube). Normalmente 0: solo
     entra cuando envia.com falla. Si deja de ser 0 día tras día, es la señal de
     que el endpoint público se cerró y toca invertir las dos fuentes. */
  respaldoTN: number;
  entregados: number;
  devueltos: number;
  incidencias: number;
  cerradosPorAntiguedad: number;
  /* Excluidos del cierre automático por ser (o poder ser) personalizados. */
  protegidos: number;
  /* La corrida no concluyó nada porque el rastreo no respondió. */
  rastreoCaido: boolean;
  errores: string[];
};

/* Los productos que NO se cierran solos: los marcados "bajo pedido" y los que
   tienen ficha de maquila. Se consultan juntos porque la pregunta es una sola
   ("¿esto se fabrica a la medida?") aunque el CRM la conteste por dos caminos
   que nadie reconcilió nunca. */
async function productosProtegidos(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const admin = createAdminClient();

  const fichas = await traerPorLotes<string, { producto_id: string }>(ids, (lote) =>
    admin.from("maquila_productos").select("producto_id").in("producto_id", lote),
  );
  return new Set(fichas.map((f) => f.producto_id));
}

export async function conciliarEnvios(): Promise<ResumenConciliacion> {
  const admin = createAdminClient();
  const resumen: ResumenConciliacion = {
    revisados: 0,
    consultados: 0,
    respondieron: 0,
    respaldoTN: 0,
    entregados: 0,
    devueltos: 0,
    incidencias: 0,
    cerradosPorAntiguedad: 0,
    protegidos: 0,
    rastreoCaido: false,
    errores: [],
  };

  /* Paginado: PostgREST corta en 1000 filas sin avisar, y en temporada alta los
     enviados de dos meses pasan de eso. */
  const pedidos = await traerTodo<PedidoEnviado>((desde, hasta) =>
    admin
      .from("sales")
      .select(
        "id, fecha, canal, num_guia, referencia_externa, producto_id," +
          " producto:products!producto_id(bajo_pedido)",
      )
      .eq("estado", "enviado")
      .gte("fecha", diasDesdeHoy(-DIAS_VENTANA))
      .not("canal", "in", `(${CANALES_SIN_RASTREO.join(",")})`)
      .order("fecha", { ascending: false })
      .range(desde, hasta),
  );
  resumen.revisados = pedidos.length;
  if (pedidos.length === 0) return resumen;

  /* --- 1. Preguntar por las guías --- */
  const conGuia = pedidos.filter((p) => p.num_guia?.trim());
  resumen.consultados = conGuia.length;

  const porGuia = new Map<string, Rastreo>();
  if (conGuia.length > 0) {
    const r = await rastrearGuias(conGuia.map((p) => p.num_guia!));
    for (const [g, v] of r.porGuia) porGuia.set(g, v);
    resumen.errores = r.errores;

    /* Lo que envia.com no pudo contestar se le pregunta a Tienda Nube. Solo lo
       que quedó SIN CONSULTAR por un fallo: una guía que sí se consultó y no
       vino en la respuesta es que el proveedor no la conoce, y preguntarle a
       Tienda Nube por ella no añadiría nada (comprobado: sobre 76 órdenes, la
       API oficial no resolvió ni una que envia.com no resolviera). */
    if (r.guiasSinConsultar.size > 0) {
      console.warn(
        `[conciliar-envios] ${r.lotesFallidos}/${r.lotes} lotes fallaron; se prueba con la API de Tienda Nube.`,
      );
      const pendientes = conGuia.filter((p) => r.guiasSinConsultar.has(p.num_guia!.trim()));
      const respaldo = await rastreoDeRespaldoTN(pendientes);
      for (const [g, v] of respaldo.porGuia) porGuia.set(g, v);
      resumen.respaldoTN = respaldo.porGuia.size;
      if (respaldo.consultadas > 0) {
        console.info(
          `[conciliar-envios] el respaldo de Tienda Nube resolvió ${respaldo.porGuia.size}/${respaldo.consultadas} órdenes.`,
        );
      }
    }

    /* Ninguna de las dos fuentes contestó: el rastreo está caído. No se toca
       nada —ni el cierre por antigüedad— y se deja constancia, porque una
       corrida muda se leería como "hoy no llegó ningún paquete". */
    if (r.lotes > 0 && r.lotesFallidos === r.lotes && porGuia.size === 0) {
      resumen.rastreoCaido = true;
      console.error(
        `[conciliar-envios] ni envia.com (${r.lotes} lotes) ni Tienda Nube respondieron; no se concluye nada.`,
        r.errores,
      );
      return resumen;
    }
  }
  resumen.respondieron = porGuia.size;

  /* --- 2. Aplicar lo que dijo el rastreo ---
     Cada pedido lleva su propio detalle, así que no hay un UPDATE masivo que
     valga; las escrituras van en oleadas paralelas para no pagar un viaje de ida
     y vuelta por pedido. */
  type CambioRastreo = {
    rastreo_estado: string;
    rastreo_detalle: string | null;
    rastreo_en: string;
    estado?: string;
  };
  const resueltos = new Set<string>();
  const ahora = new Date().toISOString();
  const cambios: { id: string; datos: CambioRastreo }[] = [];

  for (const p of pedidos) {
    const guia = p.num_guia?.trim();
    const r = guia ? porGuia.get(guia) : undefined;
    if (!r) continue;

    const datos: CambioRastreo = {
      rastreo_estado: r.estado,
      rastreo_detalle: r.detalle,
      rastreo_en: ahora,
    };
    if (r.desenlace === "entregado") {
      datos.estado = "entregado";
      resumen.entregados++;
      resueltos.add(p.id);
    } else if (r.desenlace === "devuelto") {
      datos.estado = "devuelto";
      resumen.devueltos++;
      resueltos.add(p.id);
    } else if (r.desenlace === "incidencia") {
      /* El estado NO se toca: "extraviado" o "dirección imposible" es una
         decisión de negocio (reponer, reembolsar), no un final automático. */
      resumen.incidencias++;
      resueltos.add(p.id);
    }
    cambios.push({ id: p.id, datos });
  }

  const ESCRITURAS_EN_PARALELO = 10;
  for (let i = 0; i < cambios.length; i += ESCRITURAS_EN_PARALELO) {
    const oleada = cambios.slice(i, i + ESCRITURAS_EN_PARALELO);
    const errs = await Promise.all(
      oleada.map(async (c) => {
        const { error } = await admin.from("sales").update(c.datos).eq("id", c.id);
        return error ? `${c.id}: ${error.message}` : null;
      }),
    );
    for (const e of errs) {
      if (!e) continue;
      console.error("[conciliar-envios] al guardar el rastreo:", e);
      if (resumen.errores.length < 10) resumen.errores.push(e);
    }
  }

  /* --- 3. Cerrar lo que nadie contestó, salvo personalizados --- */
  const corte = diasDesdeHoy(-DIAS_CIERRE_AUTOMATICO);
  const viejos = pedidos.filter((p) => !resueltos.has(p.id) && p.fecha < corte);
  if (viejos.length === 0) return resumen;

  const conFicha = await productosProtegidos(
    [...new Set(viejos.map((p) => p.producto_id).filter((id): id is string => !!id))],
  );

  const aCerrar: string[] = [];
  for (const p of viejos) {
    /* Sin producto identificado tampoco se cierra: podría ser justo un
       personalizado que no casó con el catálogo. */
    const protegido = !p.producto_id || p.producto?.bajo_pedido === true || conFicha.has(p.producto_id);
    if (protegido) resumen.protegidos++;
    else aCerrar.push(p.id);
  }

  if (aCerrar.length > 0) {
    const { error } = await admin
      .from("sales")
      .update({ estado: "entregado" })
      .in("id", aCerrar)
      /* Cinturón: que otra corrida no lo haya movido entre la lectura y esto. */
      .eq("estado", "enviado");
    if (error) {
      console.error("[conciliar-envios] cierre por antigüedad:", error.message);
      resumen.errores.push(error.message);
    } else {
      resumen.cerradosPorAntiguedad = aCerrar.length;
      console.info(
        `[conciliar-envios] ${aCerrar.length} pedidos de más de ${DIAS_CIERRE_AUTOMATICO} días se dieron por entregados (${resumen.protegidos} protegidos por ser bajo pedido).`,
      );
    }
  }

  return resumen;
}
