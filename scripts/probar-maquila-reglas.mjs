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
  clasificarPago,
  corteSiguiente,
  diaEfectivoDePago,
  esDiaHabil,
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

if (fallas) {
  console.error(`\n${fallas} prueba(s) fallaron.`);
  process.exit(1);
}
console.log("\nTodo en orden: las reglas de fechas cumplen los criterios de aceptación.");
