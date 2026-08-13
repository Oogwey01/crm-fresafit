/* ============================================================================
   scripts/cerrar-personalizados-entregados.mjs
   ----------------------------------------------------------------------------
   Marca como «enviado» las fichas de personalizados que quedaron en «recibido»
   de meses ya cerrados, PERO solo cuando su pedido de maquila dice que el
   cinturón ya salió (entregado o enviado). Las que maquila reporta todavía en
   producción no se tocan: siguen vivas de verdad.

   Por qué existe: el estado de la ficha se movía a mano y quedó atrasado en
   ~56 pedidos de mayo–julio 2026. La mitad ya está entregada según maquila;
   la otra mitad sigue en la cola del taller.

   Uso (Node 20+):
     # Ver el plan sin tocar nada. SIEMPRE correr esto primero.
     node --env-file=.env.local scripts/cerrar-personalizados-entregados.mjs

     # Ejecutarlo (escribe en la base de PRODUCCIÓN).
     node --env-file=.env.local scripts/cerrar-personalizados-entregados.mjs --ejecutar

     # Otro corte de fecha (default: fichas compradas antes del mes actual).
     node --env-file=.env.local scripts/cerrar-personalizados-entregados.mjs --antes-de 2026-08-01

   Idempotente: las fichas ya en «enviado» dejan de aparecer en la selección.

   Requiere en el entorno:
     NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY   (service role — NUNCA en el cliente ni en git)
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

const args = process.argv.slice(2);
const EJECUTAR = args.includes("--ejecutar");
const iAntes = args.indexOf("--antes-de");
/* Default: todo lo comprado antes del mes en curso ya es historia. */
const ANTES_DE =
  iAntes >= 0 ? args[iAntes + 1] : `${new Date().toISOString().slice(0, 7)}-01`;
if (!/^\d{4}-\d{2}-\d{2}$/.test(ANTES_DE ?? "")) {
  console.error("--antes-de necesita una fecha AAAA-MM-DD.");
  process.exit(1);
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/* Candidatas: recibido, de meses ya cerrados. (Muy por debajo del corte de
   ~1000 de PostgREST; si algún día se acerca, paginar como el importador.) */
const { data: fichas, error: errFichas } = await admin
  .from("personalizados")
  .select("id, no_venta, cliente, fecha_compra")
  .eq("estado", "recibido")
  .lt("fecha_compra", ANTES_DE)
  .order("fecha_compra")
  .limit(900);
if (errFichas) {
  console.error("No se pudieron leer las fichas:", errFichas.message);
  process.exit(1);
}

const { data: pedidos, error: errPed } = await admin
  .from("maquila_pedidos")
  .select("personalizado_id, estado")
  .in("personalizado_id", fichas.map((f) => f.id))
  .limit(1000);
if (errPed) {
  console.error("No se pudieron leer los pedidos de maquila:", errPed.message);
  process.exit(1);
}

const estadosPorFicha = new Map();
for (const p of pedidos) {
  if (!estadosPorFicha.has(p.personalizado_id)) estadosPorFicha.set(p.personalizado_id, []);
  estadosPorFicha.get(p.personalizado_id).push(p.estado);
}

/* Terminada = TODOS sus pedidos de maquila ya salieron. Sin pedido ligado no
   hay evidencia: se reporta pero no se toca. */
const YA_SALIO = ["entregado", "enviado"];
const cerrar = [];
const enTaller = [];
const sinEvidencia = [];
for (const f of fichas) {
  const estados = estadosPorFicha.get(f.id) ?? [];
  if (!estados.length) sinEvidencia.push(f);
  else if (estados.every((e) => YA_SALIO.includes(e))) cerrar.push(f);
  else enTaller.push({ ...f, maquila: [...new Set(estados)].join(",") });
}

const linea = (f, extra = "") =>
  `  ${(f.no_venta ?? "—").padEnd(20)} ${(f.cliente ?? "").slice(0, 34).padEnd(36)} compra=${f.fecha_compra}${extra}`;

console.log(`Fichas en «recibido» compradas antes de ${ANTES_DE}: ${fichas.length}\n`);
console.log(`Se marcan «enviado» (maquila ya las entregó/envió): ${cerrar.length}`);
for (const f of cerrar) console.log(linea(f));
console.log(`\nSe quedan como están (maquila sigue trabajándolas): ${enTaller.length}`);
for (const f of enTaller) console.log(linea(f, `  maquila=${f.maquila}`));
if (sinEvidencia.length) {
  console.log(`\nSin pedido de maquila ligado (no se tocan; revisar a mano): ${sinEvidencia.length}`);
  for (const f of sinEvidencia) console.log(linea(f));
}

if (!EJECUTAR) {
  console.log("\n(Prueba en seco: no se tocó nada. Repite con --ejecutar cuando el plan se vea bien.)");
  process.exit(0);
}

if (cerrar.length) {
  const { error } = await admin
    .from("personalizados")
    .update({ estado: "enviado" })
    .in("id", cerrar.map((f) => f.id));
  if (error) {
    console.error("\nNo se pudieron marcar:", error.message);
    process.exit(1);
  }
}
console.log(`\nMarcadas ${cerrar.length} fichas como «enviado».`);
