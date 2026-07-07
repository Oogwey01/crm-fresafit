/* ============================================================================
   scripts/seed.mjs  —  Siembra inicial de Fresafit CRM (equipo real, 11 personas)
   ----------------------------------------------------------------------------
   Crea/asegura los 11 usuarios del equipo en Supabase Auth con sus correos
   reales, fija sus perfiles (rol/área/color/nombre) e inserta tareas de ejemplo.
   Es idempotente: se puede correr varias veces sin duplicar.

   Uso (Node 20+):
     node --env-file=.env.local scripts/seed.mjs

   Requiere en el entorno:
     NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY   (service role — NUNCA en el cliente ni en git)

   Contraseña inicial para todos: variable SEED_PASSWORD o "Fresafit2026!".
   Cámbienla desde Supabase tras el primer login.
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = process.env.SEED_PASSWORD || "Fresafit2026!";

if (!URL || !SERVICE_KEY || URL.includes("placeholder")) {
  console.error(
    "Faltan credenciales reales. Configura NEXT_PUBLIC_SUPABASE_URL y " +
      "SUPABASE_SERVICE_ROLE_KEY en .env.local antes de sembrar.",
  );
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Equipo real de Fresafit (coincide con EQUIPO_SEED en lib/catalogos.ts).
const EQUIPO = [
  { slug: "armando",  email: "armando@fresafit.com.mx",   nombre: "Diego Armando Duarte Palacios",  rol: "direccion",   area: "direccion",   color: "#e84393" },
  { slug: "rene",     email: "rene@fresafit.com.mx",       nombre: "René Duarte Palacios",           rol: "direccion",   area: "operaciones", color: "#0984e3" },
  { slug: "manuel",   email: "manuel@fresafit.com.mx",     nombre: "Manuel Enrique Barrera Rodríguez", rol: "coordinador", area: "diseno",    color: "#8e44ad" },
  { slug: "julio",    email: "juliozea10@gmail.com",       nombre: "Julio Enrique Zea Silva",        rol: "coordinador", area: "contenido",   color: "#16a085" },
  { slug: "juanpablo",email: "juanpverdugolopez@gmail.com",nombre: "Juan Pablo Verdugo López",       rol: "miembro",     area: "diseno",      color: "#9b59b6" },
  { slug: "ulises",   email: "ulises@fresafit.com.mx",     nombre: "Miguel Ulises Zayas Hernández",  rol: "miembro",     area: "diseno",      color: "#a29bfe" },
  { slug: "luna",     email: "lunanava93189@gmail.com",    nombre: "Luna Mayela Parra Nava",         rol: "miembro",     area: "contenido",   color: "#00b894" },
  { slug: "argelia",  email: "adv_16@hotmail.com",         nombre: "Argelia Duarte Villa",           rol: "miembro",     area: "contenido",   color: "#55efc4" },
  { slug: "german",   email: "germansegura02@hotmail.com", nombre: "Germán Segura García",           rol: "miembro",     area: "logistica",   color: "#e17055" },
  { slug: "emiliano", email: "emiliano@fresafit.com.mx",   nombre: "Omar Emiliano Rendón Martínez",  rol: "miembro",     area: "logistica",   color: "#fab1a0" },
  { slug: "aaron",    email: "aaron@fresafit.com.mx",      nombre: "Aaron Oviedo",                   rol: "externo",     area: "tech",        color: "#636e72" },
];

function enDias(d) {
  const f = new Date();
  f.setDate(f.getDate() + d);
  return f.toISOString().slice(0, 10);
}

const TAREAS_EJEMPLO = [
  { titulo: "Diseñar banner colección verano", descripcion: "Banner principal para home y redes.", responsable: "juanpablo", estado: "en_proceso", prioridad: "alta", area: "diseno", fecha_limite: enDias(2), etiquetas: ["grafico"] },
  { titulo: "Renders 3D botella nueva", descripcion: "3 ángulos para la ficha de producto.", responsable: "ulises", estado: "por_hacer", prioridad: "media", area: "diseno", fecha_limite: enDias(5), etiquetas: ["grafico"] },
  { titulo: "Guion video reto 30 días", descripcion: "Video para TikTok Shop.", responsable: "luna", estado: "en_proceso", prioridad: "alta", area: "contenido", fecha_limite: enDias(1), etiquetas: ["video", "tiktok"] },
  { titulo: "Calendario de posts julio", descripcion: "Planeación mensual de contenido.", responsable: "argelia", estado: "en_revision", prioridad: "media", area: "contenido", fecha_limite: enDias(0), etiquetas: [] },
  { titulo: "Coordinar envío mayoreo GYM Halcón", descripcion: "Confirmar paquetería y fechas.", responsable: "german", estado: "por_hacer", prioridad: "alta", area: "logistica", fecha_limite: enDias(3), etiquetas: ["urgente"] },
  { titulo: "Definir metas de ventas Q3", descripcion: "Objetivos por canal.", responsable: "armando", estado: "en_proceso", prioridad: "media", area: "direccion", fecha_limite: enDias(6), etiquetas: [] },
];

/* Devuelve el uid del usuario, creándolo si no existe. */
async function asegurarUsuario(persona) {
  const { data, error } = await admin.auth.admin.createUser({
    email: persona.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { nombre: persona.nombre },
  });

  if (data?.user) return { id: data.user.id, creado: true };

  if (error && /already been registered|already exists/i.test(error.message)) {
    const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const u = lista.users.find((x) => x.email === persona.email);
    if (u) return { id: u.id, creado: false };
  }
  throw error ?? new Error(`No se pudo crear/encontrar ${persona.email}`);
}

async function main() {
  const idPorSlug = {};

  for (const persona of EQUIPO) {
    const { id, creado } = await asegurarUsuario(persona);
    idPorSlug[persona.slug] = id;

    const { error } = await admin.from("profiles").upsert({
      id,
      nombre: persona.nombre,
      rol: persona.rol,
      area: persona.area,
      color: persona.color,
    });
    if (error) throw error;
    console.log(`${creado ? "＋ creado " : "· existente"}  ${persona.slug.padEnd(10)} ${persona.email}`);
  }

  const { count } = await admin.from("tasks").select("*", { count: "exact", head: true });
  if (count && count > 0) {
    console.log(`\nLa tabla tasks ya tiene ${count} tareas; no se siembran ejemplos.`);
    console.log(`\nContraseña inicial de todos: ${PASSWORD}  (cámbienla tras el primer login)`);
    return;
  }

  const filas = TAREAS_EJEMPLO.map((t) => ({
    titulo: t.titulo,
    descripcion: t.descripcion || null,
    responsable_id: idPorSlug[t.responsable],
    area: t.area,
    prioridad: t.prioridad,
    estado: t.estado,
    fecha_limite: t.fecha_limite,
    etiquetas: t.etiquetas ?? [],
    created_by: idPorSlug["armando"],
  }));

  const { error } = await admin.from("tasks").insert(filas);
  if (error) throw error;
  console.log(`\n＋ ${filas.length} tareas de ejemplo insertadas.`);
  console.log(`\nContraseña inicial de todos: ${PASSWORD}  (cámbienla tras el primer login)`);
}

main().catch((e) => {
  console.error("\nError sembrando:", e.message ?? e);
  process.exit(1);
});
