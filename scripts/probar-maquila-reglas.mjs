/* ============================================================================
   scripts/probar-maquila-reglas.mjs — Las fechas de la maquila, a prueba
   ----------------------------------------------------------------------------
   Comprueba los criterios de aceptación de la Fase 1 que son puro cálculo:

     · prensado promete a +7 días hábiles y bordado a +10 (criterio 2)
     · un bordado pagado en viernes cae al corte del LUNES (criterio 3)
     · un festivo oficial no cuenta como día hábil (criterio 10)
     · pagar después de la hora límite corre el plazo al día siguiente
     · el domingo nunca cuenta; el sábado obedece a la configuración

   No toca la base ni levanta la app: lib/maquila/reglas.ts no importa nada a
   propósito, y Node ≥ 23 ejecuta el .ts directo (type stripping). Correr con:

     node scripts/probar-maquila-reglas.mjs
   ============================================================================ */

import {
  arranqueDePedido,
  clasificarPago,
  corteSiguiente,
  diaEfectivoDePago,
  esDiaHabil,
  esperaArte,
  particionarPedidos,
  semaforoMaquila,
  sumarDiasHabiles,
} from "../lib/maquila/reglas.ts";

let fallas = 0;
function prueba(nombre, obtenido, esperado) {
  const ok = JSON.stringify(obtenido) === JSON.stringify(esperado);
  if (ok) {
    console.log(`  ✓ ${nombre}`);
  } else {
    fallas++;
    console.error(`  ✗ ${nombre}\n      esperado: ${JSON.stringify(esperado)}\n      obtenido: ${JSON.stringify(obtenido)}`);
  }
}

/* Calendario de referencia: hora límite 13:00, sábado hábil, y los festivos
   reales del seed de 20260922000000_maquila_festivos.sql que caen cerca de las
   fechas de prueba. */
const cal = {
  horaLimite: "13:00",
  sabadoHabil: true,
  noHabiles: new Set(["2026-09-16", "2026-11-16", "2026-12-25"]),
};
const calSinSabado = { ...cal, sabadoHabil: false };

/* Referencias de agosto 2026: el 7 es viernes, el 8 sábado, el 9 domingo,
   el 10 lunes, el 13 jueves. */

console.log("Días hábiles:");
prueba("el domingo no es hábil", esDiaHabil("2026-08-09", cal), false);
prueba("el sábado es hábil si la config lo dice", esDiaHabil("2026-08-08", cal), true);
prueba("el sábado deja de serlo al apagarlo", esDiaHabil("2026-08-08", calSinSabado), false);
prueba("el 16 de septiembre (festivo) no es hábil", esDiaHabil("2026-09-16", cal), false);

console.log("Hora límite:");
prueba(
  "pago del lunes a las 09:00 cuenta ese lunes",
  diaEfectivoDePago("2026-08-10", "09:00", cal),
  "2026-08-10",
);
prueba(
  "pago del lunes a las 14:00 corre al martes",
  diaEfectivoDePago("2026-08-10", "14:00", cal),
  "2026-08-11",
);
prueba(
  "pago del domingo cuenta desde el lunes",
  diaEfectivoDePago("2026-08-09", "10:00", cal),
  "2026-08-10",
);

console.log("Cortes (lunes/jueves):");
prueba(
  "un bordado pagado el VIERNES cae al corte del LUNES",
  corteSiguiente("2026-08-07", cal),
  "2026-08-10",
);
prueba(
  "pagado el lunes mismo (antes de la hora) usa ese corte",
  corteSiguiente("2026-08-10", cal),
  "2026-08-10",
);
prueba(
  "pagado el martes espera al jueves",
  corteSiguiente("2026-08-11", cal),
  "2026-08-13",
);
prueba(
  "si el lunes de corte es festivo, el lote corre al jueves",
  corteSiguiente("2026-11-14", cal), // sábado; lunes 16-nov-2026 es festivo
  "2026-11-19",
);

console.log("Plazos (+7 / +10 hábiles):");
prueba(
  "prensado pagado el lunes 10-ago promete el martes 18-ago (+7, sin domingos)",
  sumarDiasHabiles("2026-08-10", 7, cal),
  "2026-08-18",
);
prueba(
  "el festivo del 16-sep NO cuenta: +7 desde el jue 10-sep llega al sáb 19-sep",
  sumarDiasHabiles("2026-09-10", 7, cal),
  "2026-09-19",
);
prueba(
  "sin sábados hábiles, ese mismo plazo llega al martes 22-sep",
  sumarDiasHabiles("2026-09-10", 7, calSinSabado),
  "2026-09-22",
);

console.log("Clasificación completa:");
prueba(
  "bordado pagado el viernes 7-ago a las 10:00",
  clasificarPago("2026-08-07", "10:00", "bordado", cal),
  { diaEfectivo: "2026-08-07", ruta: "corte", corteFecha: "2026-08-10", fechaPrometida: "2026-08-19" },
);
prueba(
  "prensado pagado el viernes 7-ago a las 15:00 (tras la hora límite)",
  clasificarPago("2026-08-07", "15:00", "prensado", cal),
  { diaEfectivo: "2026-08-08", ruta: "directa", corteFecha: null, fechaPrometida: "2026-08-17" },
);

console.log("Semáforo:");
prueba("vence hoy → rojo", semaforoMaquila("2026-08-07", "2026-08-07"), "rojo");
prueba("venció ayer → rojo", semaforoMaquila("2026-08-06", "2026-08-07"), "rojo");
prueba("vence en 2 días → amarillo", semaforoMaquila("2026-08-09", "2026-08-07"), "amarillo");
prueba("vence en 3 días → verde", semaforoMaquila("2026-08-10", "2026-08-07"), "verde");
prueba("sin fecha → null", semaforoMaquila(null, "2026-08-07"), null);

/* El arte: quién entra al tablero de Eduardo y desde cuándo le corre el reloj.
   Los dos instantes se escriben con formatos distintos a propósito — la base
   devuelve "+00:00" y toISOString() escribe "Z" —, que es justo lo que rompería
   una comparación de textos. */
const PAGO = "2026-08-04T18:00:00+00:00";
const ARTE = "2026-08-07T15:30:00.000Z";

console.log("El arte (esperaArte):");
prueba(
  "gamuza PRO: sin personalizado ni diseño, no espera a nadie",
  esperaArte({ personalizado_id: null, diseno_id: null, diseno_listo_en: null }),
  false,
);
prueba(
  "personalizado sin arte: espera",
  esperaArte({ personalizado_id: "p1", diseno_id: null, diseno_listo_en: null }),
  true,
);
prueba(
  "personalizado con arte entregado: ya no espera",
  esperaArte({ personalizado_id: "p1", diseno_id: null, diseno_listo_en: ARTE }),
  false,
);
prueba(
  "diseño de biblioteca sin entregar: espera igual",
  esperaArte({ personalizado_id: null, diseno_id: "d1", diseno_listo_en: null }),
  true,
);

console.log("El arranque (arranqueDePedido):");
prueba(
  "lo de catálogo arranca con el pago",
  arranqueDePedido({ pagado_en: PAGO, personalizado_id: null, diseno_id: null, diseno_listo_en: null }),
  PAGO,
);
prueba(
  "un personalizado sin arte todavía no arranca",
  arranqueDePedido({ pagado_en: PAGO, personalizado_id: "p1", diseno_id: null, diseno_listo_en: null }),
  null,
);
prueba(
  "con el arte entregado después del pago, manda el arte",
  arranqueDePedido({ pagado_en: PAGO, personalizado_id: "p1", diseno_id: null, diseno_listo_en: ARTE }),
  ARTE,
);
prueba(
  "arte entregado ANTES del pago: manda el pago (comparación de instantes, no de texto)",
  arranqueDePedido({
    pagado_en: "2026-08-09T01:00:00+00:00",
    personalizado_id: "p1",
    diseno_id: null,
    diseno_listo_en: ARTE,
  }),
  "2026-08-09T01:00:00+00:00",
);
prueba(
  "sin pago, arranca con el arte (captura manual por adelantado)",
  arranqueDePedido({ pagado_en: null, personalizado_id: "p1", diseno_id: null, diseno_listo_en: ARTE }),
  ARTE,
);

/* El pedido se clasifica desde el arranque, no desde el pago. Es lo que hace
   recalcularArranqueMaquila (lib/maquila/arranque.ts) al soltarse el pedido:
   los tres días que tardó el diseño no se los come el taller. */
console.log("La promesa cuenta desde el arte, no desde el pago:");
prueba(
  "sublimado pagado el mar 4-ago: corte del jue 6, promesa 15-ago",
  clasificarPago("2026-08-04", "10:00", "sublimado", cal),
  { diaEfectivo: "2026-08-04", ruta: "corte", corteFecha: "2026-08-06", fechaPrometida: "2026-08-15" },
);
prueba(
  "con el arte entregado el vie 7-ago, ese mismo pedido pasa al corte del lun 10 y promete el 19",
  clasificarPago("2026-08-07", "10:00", "sublimado", cal),
  { diaEfectivo: "2026-08-07", ruta: "corte", corteFecha: "2026-08-10", fechaPrometida: "2026-08-19" },
);

/* La partición del tablero: una sola pasada reparte lo que pintan el panel del
   equipo, el tablero compartido y la vista del maquilero. Siete pedidos que
   cubren cada cajón, con "hoy" = jueves 13-ago-2026. */
const CATALOGO = { personalizado_id: null, diseno_id: null, diseno_listo_en: null };
const PEDIDOS = [
  { id: "sin-pagar", estado: "esperando_pago", ruta: "corte", acabado: "sublimado", corte_fecha: null, fecha_prometida: null, ...CATALOGO },
  { id: "sin-arte", estado: "recibido", ruta: "corte", acabado: "sublimado", corte_fecha: "2026-08-13", fecha_prometida: null, ...CATALOGO, personalizado_id: "p1" },
  { id: "arte-listo", estado: "recibido", ruta: "corte", acabado: "sublimado", corte_fecha: "2026-08-13", fecha_prometida: "2026-08-25", ...CATALOGO, personalizado_id: "p2", diseno_listo_en: ARTE },
  { id: "atrasado", estado: "en_produccion", ruta: "corte", acabado: "bordado", corte_fecha: "2026-08-06", fecha_prometida: "2026-08-10", ...CATALOGO },
  { id: "prensado", estado: "recibido", ruta: "directa", acabado: "prensado", corte_fecha: null, fecha_prometida: "2026-08-20", ...CATALOGO },
  { id: "vence-hoy", estado: "terminado", ruta: "corte", acabado: "sublimado", corte_fecha: "2026-08-06", fecha_prometida: "2026-08-13", ...CATALOGO },
  { id: "entregado", estado: "entregado", ruta: "corte", acabado: "sublimado", corte_fecha: null, fecha_prometida: "2026-08-01", ...CATALOGO },
];
const ACTIVOS = ["recibido", "pendiente_produccion", "en_produccion", "terminado"];
const ids = (xs) => xs.map((p) => p.id);

console.log("La partición del tablero (particionarPedidos):");
const parte = particionarPedidos(PEDIDOS, ACTIVOS, "2026-08-13");
prueba("lo sin pagar se aparta y no toca lo demás", ids(parte.esperandoPago), ["sin-pagar"]);
prueba("lo trabado en diseño no es trabajo del taller", ids(parte.esperandoArte), ["sin-arte"]);
prueba("con el arte entregado, el pedido cuenta como listo", ids(parte.listos), ["arte-listo", "atrasado", "prensado", "vence-hoy"]);
prueba("«hoy» = vence hoy o ya se pasó (contiene a los atrasados)", ids(parte.paraHoy), ["atrasado", "vence-hoy"]);
prueba("atrasado es SOLO lo ya vencido", ids(parte.atrasados), ["atrasado"]);
prueba("prensados = ruta directa", ids(parte.prensados), ["prensado"]);
prueba("el corte actual es el lote pendiente más VIEJO", parte.corteActual, "2026-08-06");
prueba("el lote actual junta lo de ese corte, no lo del siguiente", ids(parte.loteActual), ["atrasado", "vence-hoy"]);
prueba("el historial es lo que ya salió del juego", ids(parte.historial), ["entregado"]);

if (fallas) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nTodo en orden: las reglas de fechas cumplen los criterios de aceptación.");
