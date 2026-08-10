/* ============================================================================
   scripts/probar-maquila-fase2.mjs — Quincenas, corte y consignación a prueba
   ----------------------------------------------------------------------------
   Los tres cálculos de la Fase 2 que son puro cálculo y donde un error cuesta
   dinero de verdad:

     · la quincena natural (1–15 / 16–fin) y su anterior, cruzando mes y año
     · el corte: subtotal, IVA aparte, anticipos por FIFO y total a pagar
     · qué material de consignación gasta cada pedido (el espejo del trigger
       consumir_insumos_maquila, que es lo que descuenta de verdad)

   No toca la base ni levanta la app, igual que probar-maquila-reglas.mjs:
   estos módulos no importan datos. Correr con:

     node scripts/probar-maquila-fase2.mjs
   ============================================================================ */

import {
  nombreQuincena,
  quincenaAnterior,
  quincenaCerrada,
  quincenaDe,
  quincenasRecientes,
  ultimoDiaDelMes,
} from "../lib/maquila/quincenas.ts";
import { aplicarAnticiposFIFO, calcularCorte } from "../lib/maquila/corte.ts";
import { comprometidoPorInsumo, insumosDePedido } from "../lib/maquila/consignacion.ts";

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

/* ---- Quincenas ----------------------------------------------------------- */
console.log("\nQuincenas naturales:");

prueba("el 10 de agosto cae en la primera", quincenaDe("2026-08-10"), {
  desde: "2026-08-01",
  hasta: "2026-08-15",
});
prueba("el 15 todavía es primera quincena", quincenaDe("2026-08-15"), {
  desde: "2026-08-01",
  hasta: "2026-08-15",
});
prueba("el 16 ya es segunda", quincenaDe("2026-08-16"), {
  desde: "2026-08-16",
  hasta: "2026-08-31",
});
prueba("febrero de año bisiesto cierra el 29", quincenaDe("2028-02-20"), {
  desde: "2028-02-16",
  hasta: "2028-02-29",
});
prueba("febrero normal cierra el 28", ultimoDiaDelMes(2026, 2), 28);
prueba("la anterior a la segunda es la primera del mismo mes", quincenaAnterior({ desde: "2026-08-16", hasta: "2026-08-31" }), {
  desde: "2026-08-01",
  hasta: "2026-08-15",
});
prueba("la anterior a la primera de enero cruza el año", quincenaAnterior({ desde: "2027-01-01", hasta: "2027-01-15" }), {
  desde: "2026-12-16",
  hasta: "2026-12-31",
});
prueba("quincenasRecientes devuelve n, de la más nueva a la más vieja", quincenasRecientes("2026-08-10", 3), [
  { desde: "2026-08-01", hasta: "2026-08-15" },
  { desde: "2026-07-16", hasta: "2026-07-31" },
  { desde: "2026-07-01", hasta: "2026-07-15" },
]);
prueba("nombre legible", nombreQuincena({ desde: "2026-08-01", hasta: "2026-08-15" }), "1–15 ago 2026");
prueba("la quincena en curso no está cerrada", quincenaCerrada({ desde: "2026-08-01", hasta: "2026-08-15" }, "2026-08-10"), false);
prueba("la del mes pasado sí", quincenaCerrada({ desde: "2026-07-16", hasta: "2026-07-31" }, "2026-08-10"), true);

/* ---- El corte ------------------------------------------------------------ */
console.log("\nCorte quincenal:");

/* Tarifas reales del seed: powerlift prensado 340, hebilla bordado 320. */
const renglones = [
  { cantidad: 2, importe: 680 }, // 340 × 2 — el costo es UNITARIO
  { cantidad: 1, importe: 320 },
  { cantidad: 3, importe: 1260 }, // 420 × 3
];

prueba("piezas y subtotal suman las cantidades, no los renglones", calcularCorte(renglones, [], 0.16), {
  piezas: 6,
  subtotal: 2260,
  iva: 361.6,
  anticiposAplicados: 0,
  total: 2621.6,
});

prueba("un renglón anulado no cuenta", calcularCorte([...renglones, { cantidad: 5, importe: 9999, anulado: true }], [], 0.16), {
  piezas: 6,
  subtotal: 2260,
  iva: 361.6,
  anticiposAplicados: 0,
  total: 2621.6,
});

prueba("un ajuste negativo baja el subtotal", calcularCorte([{ cantidad: 1, importe: 340 }, { cantidad: 0, importe: -100 }], [], 0.16), {
  piezas: 1,
  subtotal: 240,
  iva: 38.4,
  anticiposAplicados: 0,
  total: 278.4,
});

const anticipos = [
  { id: "b", fecha: "2026-08-01", saldo: 1000 },
  { id: "a", fecha: "2026-07-01", saldo: 500 },
];

prueba("FIFO consume primero el más viejo", aplicarAnticiposFIFO(anticipos, 1200), [
  { anticipoId: "a", monto: 500 },
  { anticipoId: "b", monto: 700 },
]);
prueba("no consume más de lo que se debe", aplicarAnticiposFIFO(anticipos, 300), [
  { anticipoId: "a", monto: 300 },
]);
prueba("si los anticipos cubren todo, el total queda en cero", calcularCorte([{ cantidad: 1, importe: 1000 }], [{ id: "x", fecha: "2026-07-01", saldo: 5000 }], 0.16), {
  piezas: 1,
  subtotal: 1000,
  iva: 160,
  anticiposAplicados: 1160,
  total: 0,
});
prueba("el IVA se calcula sobre el subtotal, no sobre el neto de anticipos", calcularCorte(renglones, [{ id: "x", fecha: "2026-07-01", saldo: 1000 }], 0.16).iva, 361.6);

/* ---- Consignación -------------------------------------------------------- */
console.log("\nMaterial que gasta cada pedido:");

prueba("powerlift con palanca negra", insumosDePedido({ requiere_palanca: true, palanca_color: "negra", combo: "ninguno", cantidad: 1 }), [
  { clave: "palanca_negra", cantidad: 1 },
]);
prueba("palanca sin color definido no descuenta nada", insumosDePedido({ requiere_palanca: true, palanca_color: null, combo: "ninguno", cantidad: 1 }), []);
prueba("combo 'ambos' gasta muñequeras y straps", insumosDePedido({ requiere_palanca: false, palanca_color: null, combo: "ambos", cantidad: 1 }), [
  { clave: "munequeras", cantidad: 1 },
  { clave: "straps", cantidad: 1 },
]);
prueba("dos piezas gastan el doble de todo", insumosDePedido({ requiere_palanca: true, palanca_color: "plateada", combo: "straps", cantidad: 2 }), [
  { clave: "palanca_plateada", cantidad: 2 },
  { clave: "straps", cantidad: 2 },
]);

const pedidos = [
  { estado: "en_produccion", enviado_en: null, requiere_palanca: true, palanca_color: "negra", combo: "ninguno", cantidad: 1 },
  { estado: "terminado", enviado_en: null, requiere_palanca: true, palanca_color: "negra", combo: "ninguno", cantidad: 2 },
  /* Ya salió: su consumo YA está en el saldo, no se cuenta dos veces. */
  { estado: "enviado", enviado_en: "2026-08-09T18:00:00Z", requiere_palanca: true, palanca_color: "negra", combo: "ninguno", cantidad: 5 },
  { estado: "cancelado", enviado_en: null, requiere_palanca: true, palanca_color: "negra", combo: "ninguno", cantidad: 9 },
  { estado: "esperando_pago", enviado_en: null, requiere_palanca: true, palanca_color: "negra", combo: "ninguno", cantidad: 7 },
];

prueba(
  "comprometido = lo vivo que no ha salido (ni enviados, ni cancelados, ni sin pagar)",
  [...comprometidoPorInsumo(pedidos).entries()],
  [["palanca_negra", 3]],
);

console.log(
  fallas === 0
    ? "\nTodo en orden: quincenas, corte y consignación cuadran.\n"
    : `\n${fallas} prueba(s) fallaron.\n`,
);
process.exit(fallas === 0 ? 0 : 1);
