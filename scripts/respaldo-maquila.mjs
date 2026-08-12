/* ============================================================================
   scripts/respaldo-maquila.mjs — El histórico de maquila que nunca se registró
   ----------------------------------------------------------------------------
   La ingesta de Tienda Nube solo mira hacia adelante: crea el pedido de maquila
   cuando la orden pasa por el importador. Todo lo que Eduardo fabricó ANTES de
   que existieran las fichas de `maquila_productos` —los cinturones de gamuza y
   los personalizados de abril a agosto— vive únicamente en `sales`.

   Este script lo trae, leyendo las ventas de los productos ya fichados y
   escribiendo el pedido de maquila equivalente. Tres razones para que sea un
   script y no una migración SQL:

     · Reusa las reglas de verdad (clasificarPago, tallaDeVariante) en vez de
       reescribirlas en PL/pgSQL y arriesgar que se separen.
     · El corte histórico se calcula con la MISMA aritmética que previsualiza la
       pantalla (lib/maquila/corte.ts).
     · Corre en seco por defecto: primero se ve qué va a pasar.

   Es idempotente por (canal, referencia_externa), la misma clave de la ingesta:
   correrlo dos veces no duplica nada.

   POR QUÉ NO DISPARA NADA: los tres triggers peligrosos de maquila_pedidos son
   AFTER UPDATE, no AFTER INSERT — consumir_insumos_maquila (20260927000100),
   solicitar_guia_maquila (20260926000100) y validar_cambio_maquila
   (20260924000000). Insertar histórico no gasta material de consignación, no
   abre solicitudes de guía y no pelea con la máquina de estados. Si algún día
   alguno pasa a AFTER INSERT, este script deja de ser seguro.

   Uso:

     # ver qué haría, sin escribir
     node --env-file=.env.local scripts/respaldo-maquila.mjs

     # escribir de verdad, cerrando los cortes hasta el 31/07
     node --env-file=.env.local scripts/respaldo-maquila.mjs \
       --aplicar --cerrar-hasta=2026-07-31

   Requiere NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY. Antes de
   correrlo hay que haber pegado 20261005000000_maquila_gamuza_personalizados.sql:
   sin fichas en `maquila_productos` no hay nada que respaldar.

   Las funciones de cálculo se exportan para scripts/probar-respaldo-maquila.mjs,
   que las prueba sin base ni red.
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";
import { clasificarPago } from "../lib/maquila/reglas.ts";
import { quincenaDe } from "../lib/maquila/quincenas.ts";
import { calcularCorte } from "../lib/maquila/corte.ts";
import { tallaDeVariante, colorDeVariante } from "../lib/talla.ts";
import { diaMX, horaMX } from "../lib/fecha.ts";

/* Los canales que la tabla admite y de los que hay ventas. TikTok queda fuera
   a propósito: maquila_pedidos.canal no lo acepta (20260924000000). */
const CANALES = ["tienda_nube", "mercado_libre"];

const TASA_IVA = 0.16;

/* Espejo de MODELOS_MAQUILA (lib/catalogos.ts). Copiado y no importado porque
   catalogos.ts resuelve por alias "@/", que node no conoce; son dos modelos y
   uno solo lleva palanca. */
const LLEVA_PALANCA = { powerlift: true, hebilla: false };

/* Cuándo damos por entregada una venta sin estado (las viejas, importadas antes
   de que `sales.estado` existiera). */
const DIAS_PARA_DAR_POR_ENTREGADA = 30;

/* ---- Argumentos ----------------------------------------------------------- */

function leerArgs() {
  const args = process.argv.slice(2);
  const cerrarHasta =
    args.find((a) => a.startsWith("--cerrar-hasta="))?.split("=")[1] ?? "2026-07-31";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cerrarHasta)) {
    console.error(`--cerrar-hasta debe ser AAAA-MM-DD, llegó "${cerrarHasta}".`);
    process.exit(1);
  }
  return { aplicar: args.includes("--aplicar"), cerrarHasta };
}

/* Perezoso: el módulo de pruebas importa las funciones de cálculo y no tiene
   (ni necesita) credenciales. */
let _admin = null;
function cliente() {
  if (!_admin) {
    _admin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } },
    );
  }
  return _admin;
}

/* ---- Utilidades ----------------------------------------------------------- */

/* PostgREST corta en 1000 filas sin avisar (ver ARQUITECTURA.md). Espejo de
   lib/canales/paginacion.ts, local para no arrastrar el alias "@/". */
async function traerTodo(consulta, tam = 1000) {
  const out = [];
  for (let desde = 0; ; desde += tam) {
    const { data, error } = await consulta(desde, desde + tam - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data?.length ?? 0) < tam) return out;
  }
}

async function porLotes(items, tam, fn) {
  let total = 0;
  for (let i = 0; i < items.length; i += tam) total += await fn(items.slice(i, i + tam));
  return total;
}

/* El día de una venta como INSTANTE: `sales.fecha` es un date, y la hora real
   del pago no se guardó. Mediodía de México es lo más neutro que hay — cae
   antes de cualquier hora límite razonable, así que el pago cuenta ese mismo
   día y no se corre al siguiente. */
export function instanteDelDia(fecha) {
  return `${fecha}T18:00:00.000Z`; // 12:00 en America/Mexico_City (UTC−6)
}

function diasDesde(fecha, hoy) {
  return Math.round(
    (new Date(`${hoy}T12:00:00Z`) - new Date(`${fecha}T12:00:00Z`)) / 86_400_000,
  );
}

function centavos(n) {
  return Math.round(n * 100) / 100;
}

/* El estado del pedido de maquila a partir del de la venta, con los instantes
   que le corresponden. Una venta de canal SOLO existe pagada, así que nada
   nace esperando pago: lo mínimo es "pendiente de producción". */
export function estadoDeVenta(venta, hoy) {
  const enviadoEn = venta.envio_despachado_en ?? instanteDelDia(venta.fecha);
  switch (venta.estado) {
    case "entregado":
      return { estado: "entregado", terminado_en: enviadoEn, enviado_en: enviadoEn, entregado_en: enviadoEn };
    case "enviado":
      return { estado: "enviado", terminado_en: enviadoEn, enviado_en: enviadoEn, entregado_en: null };
    case "cancelado":
      return { estado: "cancelado", terminado_en: null, enviado_en: null, entregado_en: null };
    case "devuelto":
      return { estado: "devuelto", terminado_en: enviadoEn, enviado_en: enviadoEn, entregado_en: enviadoEn };
    case "preparando":
      return { estado: "en_produccion", terminado_en: null, enviado_en: null, entregado_en: null };
    case "nuevo":
      return { estado: "pendiente_produccion", terminado_en: null, enviado_en: null, entregado_en: null };
    default:
      /* Sin estado: las importaciones viejas. Si ya pasó de sobra el plazo, la
         pieza salió — dejarla "pendiente" llenaría el tablero de Eduardo de
         trabajo fantasma de hace meses. */
      return diasDesde(venta.fecha, hoy) > DIAS_PARA_DAR_POR_ENTREGADA
        ? { estado: "entregado", terminado_en: enviadoEn, enviado_en: enviadoEn, entregado_en: enviadoEn }
        : { estado: "pendiente_produccion", terminado_en: null, enviado_en: null, entregado_en: null };
  }
}

/* La tarifa vigente para un modelo+acabado en una fecha. Espejo de
   costoVigente() en lib/maquila/consultas.ts (que sí usa alias). */
export function costoVigente(costos, modelo, acabado, fecha) {
  let mejor = null;
  for (const c of costos) {
    if (c.modelo !== modelo || c.acabado !== acabado) continue;
    if (c.vigente_desde > fecha) continue;
    if (!mejor || c.vigente_desde > mejor.vigente_desde) mejor = c;
  }
  return mejor?.costo ?? null;
}

/* ---- 1. Leer el mundo ----------------------------------------------------- */

async function cargarFichas() {
  const filas = await traerTodo((desde, hasta) =>
    cliente()
      .from("maquila_productos")
      .select("producto_id, modelo, acabado, combo, producto:products!producto_id(sku, nombre, variante, imagen_url)")
      .eq("activo", true)
      .range(desde, hasta),
  );
  return new Map(filas.map((f) => [f.producto_id, f]));
}

async function cargarVentas(productoIds) {
  const out = [];
  await porLotes(productoIds, 200, async (lote) => {
    const filas = await traerTodo((desde, hasta) =>
      cliente()
        .from("sales")
        .select(
          "id, canal, referencia_externa, producto_id, cantidad, fecha, estado," +
            " paqueteria, num_guia, url_rastreo, envio_direccion, envio_despachado_en",
        )
        .in("canal", CANALES)
        .in("producto_id", lote)
        .not("referencia_externa", "is", null)
        .order("id")
        .range(desde, hasta),
    );
    out.push(...filas);
    return filas.length;
  });
  return out;
}

/* El folio visible de la orden ("#1234"), que vive en la cabecera y no en el
   renglón. Sin él el tablero muestra el id largo de la orden. */
async function cargarNumerosDeOrden(claves) {
  const mapa = new Map();
  const porCanal = new Map();
  for (const { canal, referencia_orden } of claves) {
    if (!porCanal.has(canal)) porCanal.set(canal, new Set());
    porCanal.get(canal).add(referencia_orden);
  }
  for (const [canal, refs] of porCanal) {
    await porLotes([...refs], 200, async (lote) => {
      const filas = await traerTodo((desde, hasta) =>
        cliente()
          .from("sale_orders")
          .select("canal, referencia_orden, numero")
          .eq("canal", canal)
          .in("referencia_orden", lote)
          .order("id")
          .range(desde, hasta),
      );
      for (const f of filas) mapa.set(`${f.canal}:${f.referencia_orden}`, f.numero);
      return filas.length;
    });
  }
  return mapa;
}

async function cargarCalendario() {
  const [config, festivos] = await Promise.all([
    cliente().from("maquila_config").select("hora_limite, sabado_habil").eq("id", 1).single(),
    cliente().from("maquila_festivos").select("fecha"),
  ]);
  if (config.error) throw new Error(config.error.message);
  if (festivos.error) throw new Error(festivos.error.message);
  return {
    horaLimite: config.data.hora_limite.slice(0, 5),
    sabadoHabil: config.data.sabado_habil,
    noHabiles: new Set((festivos.data ?? []).map((f) => f.fecha)),
  };
}

/* ---- 2. Armar el pedido de maquila ---------------------------------------- */

/* El mismo snapshot que renglonBase() en lib/maquila/ingesta.ts: el tablero de
   Eduardo no joinea nada, todo viaja copiado dentro del pedido. */
export function pedidoDeVenta(venta, ficha, numeroOrden, cal, hoy) {
  const referenciaOrden = venta.referencia_externa.split(":")[0] || null;
  const pagadoEn = instanteDelDia(venta.fecha);
  const cls = clasificarPago(diaMX(pagadoEn), horaMX(pagadoEn), ficha.acabado, cal);
  const dir = venta.envio_direccion ?? null;

  return {
    canal: venta.canal,
    referencia_externa: venta.referencia_externa,
    referencia_orden: referenciaOrden,
    numero_orden: numeroOrden ?? null,
    sale_id: venta.id,
    producto_id: venta.producto_id,
    origen: "api",
    sku: ficha.producto?.sku ?? null,
    diseno: ficha.producto?.nombre ?? null,
    imagen_url: ficha.producto?.imagen_url ?? null,
    modelo: ficha.modelo,
    acabado: ficha.acabado,
    talla: tallaDeVariante(ficha.producto?.variante),
    color: colorDeVariante(ficha.producto?.variante),
    cantidad: Math.max(1, Math.trunc(Number(venta.cantidad) || 1)),
    requiere_palanca: LLEVA_PALANCA[ficha.modelo] ?? false,
    combo: ficha.combo,
    pagado_en: pagadoEn,
    ruta: cls.ruta,
    corte_fecha: cls.corteFecha,
    fecha_prometida: cls.fechaPrometida,
    ...estadoDeVenta(venta, hoy),
    paqueteria: venta.paqueteria ?? null,
    num_guia: venta.num_guia ?? null,
    url_rastreo: venta.url_rastreo ?? null,
    envio_nombre: dir?.nombre ?? null,
    envio_telefono: dir?.telefono ?? null,
    envio_direccion: dir,
    notas: "Respaldo del histórico: la venta es anterior a las fichas de maquila.",
  };
}

/* ---- 3. Escribir ---------------------------------------------------------- */

async function insertarPedidos(filas) {
  return porLotes(filas, 200, async (lote) => {
    const { data, error } = await cliente()
      .from("maquila_pedidos")
      .upsert(lote, { onConflict: "canal,referencia_externa", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    return data?.length ?? 0;
  });
}

/* El upsert con ignoreDuplicates solo devuelve lo NUEVO; para congelar costos y
   armar los cortes hacen falta también los que ya estaban de una corrida
   anterior, así que se releen todos por su referencia. */
async function mapaDePedidos(referencias) {
  const mapa = new Map();
  await porLotes(referencias, 200, async (lote) => {
    const filas = await traerTodo((desde, hasta) =>
      cliente()
        .from("maquila_pedidos")
        .select("id, canal, referencia_externa, modelo, acabado, cantidad, diseno, sku, pagado_en, enviado_en, estado")
        .in("canal", CANALES)
        .in("referencia_externa", lote)
        .order("id")
        .range(desde, hasta),
    );
    for (const f of filas) mapa.set(`${f.canal}:${f.referencia_externa}`, f);
    return filas.length;
  });
  return mapa;
}

async function congelarCostos(pedidos, costos) {
  const filas = [];
  for (const p of pedidos) {
    /* Un pedido sin pago registrado no tiene día al que congelar la tarifa: es
       de la ingesta normal, esperando pago, y ella le pondrá el costo cuando
       entre el dinero. */
    if (!p.pagado_en) continue;
    const costo = costoVigente(costos, p.modelo, p.acabado, diaMX(p.pagado_en));
    if (costo === null) continue;
    filas.push({ pedido_id: p.id, costo });
  }
  await porLotes(filas, 200, async (lote) => {
    const { error } = await cliente()
      .from("maquila_pedido_costos")
      .upsert(lote, { onConflict: "pedido_id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return lote.length;
  });
  return filas.length;
}

/* Los cortes de las quincenas ya pagadas por fuera del CRM. Se insertan
   directamente y NO por maquila_calcular_corte: ese RPC exige es_administrativo()
   y con service role auth.uid() es null.

   Nacen en 'pagado' a propósito. Dejar estos pedidos sueltos haría que el
   primer corte que administración calcule arrastre 100+ piezas de meses
   anteriores y se las cobre otra vez a Fresafit. Con su renglón vivo ya
   asignado, el `not exists` de maquila_calcular_corte los deja fuera para
   siempre. Sin anticipos: los adelantos reales de Eduardo no se consumen en una
   regularización de algo que ya se le pagó.

   Puro: agrupa y calcula, no escribe. Quien escribe es escribirCortes().
   Devuelve `{ cortes, sinTarifa }`, y lo segundo importa tanto como lo primero:
   un pedido sin precio al día de su pago se queda fuera del corte, y un pedido
   fuera del corte es uno que el próximo corte real le vuelve a cobrar a
   Fresafit. Quien corra esto tiene que VERLO, no deducirlo de un total que no
   cuadra. */
export function agruparCortesHistoricos(pedidos, costos, cerrarHasta) {
  const porQuincena = new Map();
  for (const p of pedidos) {
    if (!p.enviado_en || !p.pagado_en) continue;
    if (!["enviado", "entregado"].includes(p.estado)) continue;
    const dia = diaMX(p.enviado_en);
    if (dia > cerrarHasta) continue; // la quincena en curso se paga de verdad
    const q = quincenaDe(dia);
    const clave = `${q.desde}|${q.hasta}`;
    if (!porQuincena.has(clave)) porQuincena.set(clave, { q, pedidos: [] });
    porQuincena.get(clave).pedidos.push(p);
  }

  const cortes = [];
  const sinTarifa = [];
  for (const { q, pedidos: delPeriodo } of [...porQuincena.values()].sort((a, b) =>
    a.q.desde.localeCompare(b.q.desde),
  )) {
    const renglones = [];
    for (const p of delPeriodo) {
      const costo = costoVigente(costos, p.modelo, p.acabado, diaMX(p.pagado_en));
      if (costo === null) {
        sinTarifa.push({ pagado: diaMX(p.pagado_en), modelo: p.modelo, acabado: p.acabado });
        continue;
      }
      renglones.push({
        pedido_id: p.id,
        concepto: p.diseno ?? p.sku ?? "Pieza de maquila",
        modelo: p.modelo,
        acabado: p.acabado,
        cantidad: p.cantidad,
        costo_unitario: costo,
        importe: centavos(costo * p.cantidad),
        enviado_en: p.enviado_en,
      });
    }
    if (!renglones.length) continue;
    cortes.push({ q, renglones, totales: calcularCorte(renglones, [], TASA_IVA) });
  }
  return { cortes, sinTarifa };
}

async function escribirCortes(cortes) {
  let creados = 0;
  for (const { q, renglones, totales } of cortes) {
    /* maquila_cortes_periodo_uidx prohíbe dos cortes vivos del mismo periodo:
       si ya hay uno, esta quincena ya se regularizó (o administración la está
       trabajando) y no se toca. */
    const { data: existente, error: errBusca } = await cliente()
      .from("maquila_cortes")
      .select("id, estado")
      .eq("periodo_desde", q.desde)
      .eq("periodo_hasta", q.hasta)
      .neq("estado", "cancelado")
      .maybeSingle();
    if (errBusca) throw new Error(errBusca.message);
    if (existente) {
      console.log(`  · ${q.desde}…${q.hasta}: ya existe un corte (${existente.estado}), se salta.`);
      continue;
    }

    const sello = `${q.hasta}T18:00:00.000Z`;
    const { data: corte, error } = await cliente()
      .from("maquila_cortes")
      .insert({
        periodo_desde: q.desde,
        periodo_hasta: q.hasta,
        estado: "pagado",
        piezas: totales.piezas,
        subtotal: totales.subtotal,
        iva_tasa: TASA_IVA,
        iva: totales.iva,
        anticipos_aplicados: 0,
        total: totales.total,
        cerrado_en: sello,
        pagado_en: sello,
        notas:
          "Regularización histórica: piezas fabricadas y pagadas a Eduardo antes de que" +
          " la maquila entrara al CRM. Se registra cerrado para que no vuelva a cobrarse.",
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    await porLotes(renglones, 200, async (lote) => {
      const { error: errR } = await cliente()
        .from("maquila_corte_renglones")
        .insert(lote.map((r) => ({ ...r, corte_id: corte.id })));
      if (errR) throw new Error(errR.message);
      return lote.length;
    });
    creados++;
  }
  return creados;
}

/* ---- Main ----------------------------------------------------------------- */

async function main() {
  const { aplicar, cerrarHasta } = leerArgs();
  const hoy = diaMX(new Date());
  console.log(
    `\nRespaldo de maquila — ${aplicar ? "APLICANDO" : "en seco (agrega --aplicar para escribir)"}`,
  );
  console.log(`Cortes históricos hasta: ${cerrarHasta}\n`);

  const fichas = await cargarFichas();
  if (fichas.size === 0) {
    console.error(
      "No hay fichas activas en maquila_productos.\n" +
        "Pega antes supabase/migrations/20261005000000_maquila_gamuza_personalizados.sql.",
    );
    process.exit(1);
  }
  console.log(`Fichas de maquila activas: ${fichas.size}`);

  const [ventas, cal, costosRes] = await Promise.all([
    cargarVentas([...fichas.keys()]),
    cargarCalendario(),
    cliente().from("maquila_costos").select("modelo, acabado, costo, vigente_desde"),
  ]);
  if (costosRes.error) throw new Error(costosRes.error.message);
  const costos = costosRes.data ?? [];
  console.log(`Ventas de esos productos en ${CANALES.join(" y ")}: ${ventas.length}`);

  const numeros = await cargarNumerosDeOrden(
    ventas.map((v) => ({ canal: v.canal, referencia_orden: v.referencia_externa.split(":")[0] })),
  );

  const filas = ventas.map((v) =>
    pedidoDeVenta(
      v,
      fichas.get(v.producto_id),
      numeros.get(`${v.canal}:${v.referencia_externa.split(":")[0]}`),
      cal,
      hoy,
    ),
  );

  /* Resumen antes de tocar nada: es lo que se revisa en la corrida en seco. */
  const cuenta = (fn) =>
    filas.reduce((m, f) => m.set(fn(f), (m.get(fn(f)) ?? 0) + 1), new Map());
  console.log("\n  por canal :", Object.fromEntries(cuenta((f) => f.canal)));
  console.log("  por estado:", Object.fromEntries(cuenta((f) => f.estado)));
  console.log("  por modelo:", Object.fromEntries(cuenta((f) => `${f.modelo}/${f.acabado}`)));

  /* Los cortes que se van a dar por pagados. Se calculan también en seco —sobre
     las filas, que todavía no tienen id— porque es la parte que toca dinero: hay
     que poder mirar cuánto se va a registrar como ya liquidado ANTES de que
     exista. */
  if (!aplicar) {
    imprimirCortes(agruparCortesHistoricos(filas, costos, cerrarHasta), cerrarHasta);
    const ejemplo = filas[0];
    if (ejemplo) {
      console.log("\n  Ejemplo del primer pedido:");
      for (const k of ["canal", "referencia_externa", "numero_orden", "sku", "diseno", "modelo", "acabado", "talla", "color", "cantidad", "pagado_en", "ruta", "corte_fecha", "fecha_prometida", "estado", "enviado_en"]) {
        console.log(`    ${k.padEnd(20)} ${JSON.stringify(ejemplo[k])}`);
      }
    }
    console.log("\nNada escrito. Repite con --aplicar cuando el resumen cuadre.\n");
    return;
  }

  const nuevos = await insertarPedidos(filas);
  console.log(`\nPedidos creados: ${nuevos} (${filas.length - nuevos} ya existían)`);

  const pedidos = [...(await mapaDePedidos(filas.map((f) => f.referencia_externa))).values()];
  const conCosto = await congelarCostos(pedidos, costos);
  console.log(`Costos congelados: ${conCosto}`);

  const agrupado = agruparCortesHistoricos(pedidos, costos, cerrarHasta);
  imprimirCortes(agrupado, cerrarHasta);
  const creados = await escribirCortes(agrupado.cortes);
  console.log(`Cortes creados: ${creados}\n`);
}

const pesos = (n) => `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })}`;

function imprimirCortes({ cortes, sinTarifa }, cerrarHasta) {
  console.log(
    `\nCortes históricos (quincenas hasta el ${cerrarHasta}, se registran YA PAGADOS): ${cortes.length}`,
  );
  for (const c of cortes) {
    console.log(
      `  · ${c.q.desde}…${c.q.hasta}  ${String(c.totales.piezas).padStart(3)} piezas` +
        `   subtotal ${pesos(c.totales.subtotal).padStart(12)}` +
        `   con IVA ${pesos(c.totales.total).padStart(12)}`,
    );
  }
  const piezas = cortes.reduce((s, c) => s + c.totales.piezas, 0);
  const total = cortes.reduce((s, c) => s + c.totales.total, 0);
  if (cortes.length) {
    console.log(`    ${"".padEnd(21)} ${String(piezas).padStart(3)} piezas   ya pagadas a Eduardo, ${pesos(centavos(total))} con IVA`);
  }

  /* Lo que se quedó fuera se GRITA: un pedido sin renglón de corte es un pedido
     que el próximo corte real va a cobrar de nuevo. */
  if (sinTarifa.length) {
    const familias = new Map();
    for (const s of sinTarifa) {
      const k = `${s.modelo}/${s.acabado}`;
      const f = familias.get(k) ?? { n: 0, desde: s.pagado, hasta: s.pagado };
      familias.set(k, {
        n: f.n + 1,
        desde: s.pagado < f.desde ? s.pagado : f.desde,
        hasta: s.pagado > f.hasta ? s.pagado : f.hasta,
      });
    }
    console.log(
      `\n  ⚠ ${sinTarifa.length} pieza(s) SIN TARIFA al día de su pago: quedan fuera del` +
        ` corte histórico y el próximo corte real se las va a cobrar a Fresafit.`,
    );
    for (const [k, f] of familias) {
      console.log(`      ${k}: ${f.n} pieza(s), pagos del ${f.desde} al ${f.hasta}`);
    }
    console.log(
      "      Arréglalo cargando una vigencia anterior en maquila_costos" +
        " (ver 20261006000100_maquila_tarifas_historicas.sql) y vuelve a correr esto.",
    );
  }
}

/* Solo cuando se invoca como programa: importarlo desde las pruebas no debe
   disparar una corrida contra la base. */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error("\nFalló el respaldo:", e.message);
    process.exit(1);
  });
}
