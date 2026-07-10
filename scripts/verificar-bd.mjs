/* ============================================================================
   scripts/verificar-bd.mjs  —  Verifica el estado del Supabase EN VIVO
   ----------------------------------------------------------------------------
   Comprueba que las migraciones del spec (20250102*) estén aplicadas:
   helpers de rol, tablas satélite, bucket de adjuntos, roles/estados nuevos
   y el equipo sembrado. Solo LEE; no modifica nada.

   Uso (Node 20+):
     node --env-file=.env.local scripts/verificar-bd.mjs
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY || URL.includes("placeholder")) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let fallas = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const mal = (msg) => {
  fallas++;
  console.log(`  ✗ ${msg}`);
};

/* ¿Existe la tabla? Select real con limit(0): para una tabla inexistente
   PostgREST responde PGRST205. OJO: con `head: true` respondería 204 SIN
   error aunque la tabla no exista (falso positivo). */
async function existeTabla(nombre) {
  const { error } = await admin.from(nombre).select("*").limit(0);
  return !error;
}

async function main() {
  console.log("— Helpers de rol (migración 20250102000000/…03) —");
  for (const fn of ["mi_rol", "mi_area", "es_gestor"]) {
    const { error } = await admin.rpc(fn);
    if (error && /could not find|does not exist|PGRST202/i.test(error.message + error.code)) {
      mal(`función public.${fn}() NO existe → migraciones 20250102* sin aplicar`);
    } else {
      ok(`función public.${fn}() existe`);
    }
  }

  console.log("\n— Tablas satélite de tareas (20250102000001) —");
  for (const t of ["task_comments", "task_checklist", "task_links", "task_attachments", "task_activity", "task_shares"]) {
    (await existeTabla(t)) ? ok(`tabla ${t}`) : mal(`tabla ${t} NO existe`);
  }

  console.log("\n— Fase 1: Inventario (migración 20250103000000) —");
  for (const t of ["suppliers", "products", "supplier_orders", "supplier_order_items"]) {
    (await existeTabla(t)) ? ok(`tabla ${t}`) : mal(`tabla ${t} NO existe → falta aplicar 20250103000000_inventario.sql`);
  }
  {
    const { error } = await admin.rpc("es_interno");
    error && /could not find|does not exist|PGRST202/i.test(error.message + error.code)
      ? mal("función public.es_interno() NO existe → falta aplicar 20250103000000_inventario.sql")
      : ok("función public.es_interno() existe");
  }
  if (await existeTabla("inventory")) mal("la esqueleto `inventory` sigue existiendo (la migración de inventario la elimina)");

  console.log("\n— Tablas esqueleto Fase 2+ —");
  for (const t of ["customers", "orders", "finances"]) {
    (await existeTabla(t)) ? ok(`tabla ${t}`) : mal(`tabla ${t} NO existe`);
  }

  console.log("\n— Storage (20250102000002) —");
  const { data: buckets, error: bErr } = await admin.storage.listBuckets();
  if (bErr) mal(`no se pudieron listar buckets: ${bErr.message}`);
  else if (buckets.some((b) => b.name === "adjuntos" && !b.public)) ok("bucket privado «adjuntos»");
  else mal("bucket privado «adjuntos» NO existe");

  console.log("\n— Perfiles / equipo —");
  const { data: perfiles, error: pErr } = await admin.from("profiles").select("id, nombre, rol, area");
  if (pErr) {
    mal(`no se pudo leer profiles: ${pErr.message}`);
  } else {
    const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const emailPorId = new Map(lista.users.map((u) => [u.id, u.email]));
    console.log(`  · ${perfiles.length} perfiles:`);
    for (const p of perfiles) {
      console.log(`      ${(p.nombre ?? "(sin nombre)").padEnd(38)} rol=${String(p.rol).padEnd(12)} area=${String(p.area).padEnd(12)} ${emailPorId.get(p.id) ?? "(sin auth)"}`);
    }
    const rolesViejos = perfiles.filter((p) => !["direccion", "coordinador", "miembro", "externo"].includes(p.rol));
    rolesViejos.length
      ? mal(`roles fuera del catálogo nuevo: ${rolesViejos.map((p) => `${p.nombre}=${p.rol}`).join(", ")}`)
      : ok("todos los roles pertenecen al catálogo nuevo (direccion/coordinador/miembro/externo)");
    const dominioViejo = lista.users.filter((u) => u.email?.endsWith("@fresafit.com"));
    dominioViejo.length
      ? mal(`usuarios con dominio viejo @fresafit.com (posibles duplicados del seed inicial): ${dominioViejo.map((u) => u.email).join(", ")}`)
      : ok("sin usuarios del dominio viejo @fresafit.com");
    perfiles.length >= 11 ? ok(`equipo sembrado (${perfiles.length} ≥ 11)`) : mal(`solo ${perfiles.length} perfiles; el equipo real son 11 (scripts/seed.mjs)`);
  }

  console.log("\n— Datos de tareas —");
  const { data: tareas, error: tErr } = await admin.from("tasks").select("estado, prioridad");
  if (tErr) {
    mal(`no se pudo leer tasks: ${tErr.message}`);
  } else {
    const estadosViejos = tareas.filter((t) => !["por_hacer", "en_proceso", "en_revision", "hecho"].includes(t.estado));
    estadosViejos.length
      ? mal(`${estadosViejos.length} tareas con estado fuera de catálogo (¿en_progreso sin migrar?)`)
      : ok(`${tareas.length} tareas, todos los estados en catálogo`);
    const prioViejas = tareas.filter((t) => !["alta", "media", "baja"].includes(t.prioridad));
    prioViejas.length ? mal(`${prioViejas.length} tareas con prioridad fuera de catálogo (¿urgente?)`) : ok("prioridades en catálogo");
  }

  console.log(fallas ? `\n✗ ${fallas} problema(s). Ver HANDOFF-TAREAS.md para aplicar lo que falte.` : "\n✓ Base de datos al día con el spec.");
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error("\nError verificando:", e.message ?? e);
  process.exit(1);
});
