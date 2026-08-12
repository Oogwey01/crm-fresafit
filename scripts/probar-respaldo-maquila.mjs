/* ============================================================================
   scripts/probar-respaldo-maquila.mjs — El respaldo del histórico, a prueba
   ----------------------------------------------------------------------------
   De scripts/respaldo-maquila.mjs cuelgan dos cosas que cuestan dinero si están
   mal, y las dos son puro cálculo:

     · el estado con que nace cada pedido histórico (de él salen `enviado_en` y,
       por lo tanto, a qué quincena se cobra)
     · el agrupado de los cortes ya pagados: si un pedido viejo se escapa de su
       corte histórico, el siguiente corte real se lo vuelve a cobrar a Fresafit

   No toca la base ni la red: importa las funciones puras del script. Correr con:

     node scripts/probar-respaldo-maquila.mjs
   ============================================================================ */

import {
  agruparCortesHistoricos,
  costoVigente,
  estadoDeVenta,
  instanteDelDia,
  pedidoDeVenta,
} from "./respaldo-maquila.mjs";

let fallas = 0;
function prueba(nombre, obtenido, esperado) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (ok) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallas++;
    console.error(
      `  ✗ ${nombre}\n      esperado: ${JSON.stringify(esperado)}\n      obtenido: ${JSON.stringify(obtenido)}`,
    );
  }
}

const HOY = "2026-08-11";

/* Calendario mínimo: hora límite 13:00, sábado hábil, sin festivos. Es la
   configuración sembrada por 20260921000000/20260922000000 menos los días de
   ley, que aquí no hacen falta. */
const CAL = { horaLimite: "13:00", sabadoHabil: true, noHabiles: new Set() };

const COSTOS = [
  { modelo: "powerlift", acabado: "bordado_gamuza", costo: 420, vigente_desde: "2026-08-01" },
  { modelo: "powerlift", acabado: "bordado_gamuza", costo: 380, vigente_desde: "2026-01-01" },
  { modelo: "hebilla", acabado: "sublimado", costo: 240, vigente_desde: "2026-08-01" },
];

console.log("\nEl instante del día");
{
  /* Mediodía de México: tiene que caer ANTES de la hora límite, o todo pago
     histórico se correría al día hábil siguiente y las promesas saldrían un día
     tarde. */
  prueba("mediodía MX en UTC", instanteDelDia("2026-05-04"), "2026-05-04T18:00:00.000Z");
}

console.log("\nEl estado del pedido a partir de la venta");
{
  const base = { fecha: "2026-05-04", envio_despachado_en: null };
  prueba(
    "entregado sella envío y entrega",
    estadoDeVenta({ ...base, estado: "entregado" }, HOY),
    {
      estado: "entregado",
      terminado_en: "2026-05-04T18:00:00.000Z",
      enviado_en: "2026-05-04T18:00:00.000Z",
      entregado_en: "2026-05-04T18:00:00.000Z",
    },
  );
  prueba(
    "enviado sella salida pero no entrega",
    estadoDeVenta({ ...base, estado: "enviado" }, HOY).entregado_en,
    null,
  );
  prueba(
    "nuevo entra a producción sin fecha de salida",
    estadoDeVenta({ ...base, estado: "nuevo" }, HOY),
    { estado: "pendiente_produccion", terminado_en: null, enviado_en: null, entregado_en: null },
  );
  prueba(
    "cancelado no sella nada",
    estadoDeVenta({ ...base, estado: "cancelado" }, HOY).enviado_en,
    null,
  );
  /* El despacho real manda sobre la fecha de la venta: es el instante que
     decide a qué quincena se cobra la pieza. */
  prueba(
    "usa envio_despachado_en cuando existe",
    estadoDeVenta(
      { fecha: "2026-05-04", envio_despachado_en: "2026-05-07T22:30:00.000Z", estado: "entregado" },
      HOY,
    ).enviado_en,
    "2026-05-07T22:30:00.000Z",
  );
  prueba(
    "sin estado y vieja: se da por entregada",
    estadoDeVenta({ ...base, estado: null }, HOY).estado,
    "entregado",
  );
  prueba(
    "sin estado y reciente: sigue en producción",
    estadoDeVenta({ fecha: "2026-08-09", envio_despachado_en: null, estado: null }, HOY).estado,
    "pendiente_produccion",
  );
}

console.log("\nLa tarifa vigente");
{
  prueba("toma la vigente al día del pago", costoVigente(COSTOS, "powerlift", "bordado_gamuza", "2026-08-05"), 420);
  prueba("no usa una tarifa futura", costoVigente(COSTOS, "powerlift", "bordado_gamuza", "2026-05-04"), 380);
  prueba("sin tarifa devuelve null", costoVigente(COSTOS, "hebilla", "bordado", "2026-08-05"), null);
}

console.log("\nEl pedido armado desde la venta");
{
  const venta = {
    id: "venta-1",
    canal: "tienda_nube",
    referencia_externa: "1234567:987654",
    producto_id: "prod-1",
    cantidad: 2,
    fecha: "2026-05-04", // lunes
    estado: "entregado",
    paqueteria: "Estafeta",
    num_guia: "ABC123",
    url_rastreo: null,
    envio_direccion: { nombre: "Ana", telefono: "5512345678", ciudad: "CDMX" },
    envio_despachado_en: null,
  };
  const ficha = {
    modelo: "powerlift",
    acabado: "bordado_gamuza",
    combo: "ninguno",
    producto: { sku: "SBD040M", nombre: "Cinturon de Powerlift Gamuza Negro PRO", variante: "M" },
  };
  const p = pedidoDeVenta(venta, ficha, "1042", CAL, HOY);

  prueba("la orden sale de la referencia", p.referencia_orden, "1234567");
  prueba("el folio visible viene de sale_orders", p.numero_orden, "1042");
  prueba("liga la venta hermana", p.sale_id, "venta-1");
  prueba("copia el snapshot del producto", [p.sku, p.diseno, p.talla], [
    "SBD040M",
    "Cinturon de Powerlift Gamuza Negro PRO",
    "M",
  ]);
  prueba("powerlift lleva palanca", p.requiere_palanca, true);
  /* bordado_gamuza va por corte de lunes/jueves, +10 hábiles desde el pago. */
  prueba("ruta y promesa las calcula clasificarPago", [p.ruta, p.corte_fecha, p.fecha_prometida], [
    "corte",
    "2026-05-04",
    "2026-05-15",
  ]);
  prueba("el envío se desdobla de la dirección", [p.envio_nombre, p.envio_telefono], ["Ana", "5512345678"]);
  prueba("hereda la guía de la venta", [p.paqueteria, p.num_guia], ["Estafeta", "ABC123"]);
  prueba("el estado viene de la venta", p.estado, "entregado");

  const hebilla = pedidoDeVenta(
    venta,
    { ...ficha, modelo: "hebilla", acabado: "sublimado" },
    null,
    CAL,
    HOY,
  );
  prueba("hebilla no lleva palanca", hebilla.requiere_palanca, false);
  prueba("sin folio queda en null", hebilla.numero_orden, null);
}

console.log("\nLos cortes históricos");
{
  const pedido = (id, enviadoEn, estado = "entregado", cantidad = 1) => ({
    id,
    estado,
    enviado_en: enviadoEn,
    pagado_en: "2026-08-02T18:00:00.000Z",
    modelo: "powerlift",
    acabado: "bordado_gamuza",
    cantidad,
    diseno: "Gamuza Negro PRO",
    sku: "SBD040M",
  });

  const cortes = agruparCortesHistoricos(
    [
      pedido("a", "2026-08-03T18:00:00.000Z"),
      pedido("b", "2026-08-10T18:00:00.000Z", "entregado", 2),
      pedido("c", "2026-08-20T18:00:00.000Z"), // fuera del tope: quincena en curso
      pedido("d", null, "pendiente_produccion"), // sin salir: no se cobra
      pedido("e", "2026-07-30T18:00:00.000Z"),
    ],
    COSTOS,
    "2026-08-15",
  );

  prueba("una quincena por periodo, en orden", cortes.map((c) => `${c.q.desde}…${c.q.hasta}`), [
    "2026-07-16…2026-07-31",
    "2026-08-01…2026-08-15",
  ]);
  prueba("deja fuera lo posterior al tope", cortes.flatMap((c) => c.renglones.map((r) => r.pedido_id)).includes("c"), false);
  prueba("deja fuera lo que no ha salido", cortes.flatMap((c) => c.renglones.map((r) => r.pedido_id)).includes("d"), false);

  const agosto = cortes.find((c) => c.q.desde === "2026-08-01");
  prueba("suma piezas, no renglones", agosto.totales.piezas, 3);
  prueba("subtotal a la tarifa del pago", agosto.totales.subtotal, 1260); // 3 × 420
  prueba("IVA aparte al 16 %", agosto.totales.iva, 201.6);
  /* Sin anticipos: una regularización de lo ya pagado no consume los adelantos
     vivos de Eduardo. */
  prueba("no consume anticipos", agosto.totales.anticiposAplicados, 0);
  prueba("total = subtotal + IVA", agosto.totales.total, 1461.6);

  /* La tarifa se congela al día del PAGO, no al del envío: julio y agosto
     comparten pagado_en, así que comparten precio. */
  const julio = cortes.find((c) => c.q.desde === "2026-07-16");
  prueba("julio cobra a la tarifa de su pago", julio.renglones[0].costo_unitario, 420);

  /* Un pedido sin tarifa no se puede cobrar: se queda fuera antes que entrar en
     cero y descuadrar el pago. */
  const sinTarifa = agruparCortesHistoricos(
    [{ ...pedido("f", "2026-08-03T18:00:00.000Z"), acabado: "bordado" }],
    COSTOS,
    "2026-08-15",
  );
  prueba("sin tarifa no genera corte", sinTarifa.length, 0);
}

console.log(
  fallas === 0 ? "\n✓ Todo bien.\n" : `\n✗ ${fallas} prueba(s) fallaron.\n`,
);
process.exit(fallas === 0 ? 0 : 1);
