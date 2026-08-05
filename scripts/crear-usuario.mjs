/* ============================================================================
   scripts/crear-usuario.mjs  —  Alta de UNA persona en el CRM
   ----------------------------------------------------------------------------
   Crea el usuario en Supabase Auth y deja su perfil (nombre, rol, área, color)
   como se pide. Si el correo ya existe, no falla: actualiza la contraseña y el
   perfil. Es idempotente.

   `scripts/seed.mjs` hace esto para el equipo entero, pero además inserta tareas
   de ejemplo: correrlo en producción para dar de alta a una sola persona
   ensuciaría el tablero. De ahí este script.

   Uso (Node 20+):
     node --env-file=.env.local scripts/crear-usuario.mjs \
       --email diana@fresafit.com.mx --nombre "Diana" \
       --rol administracion --area administracion --color "#00cec9" \
       --password "…"

     node --env-file=.env.local scripts/crear-usuario.mjs … --dry-run

   Requiere en el entorno:
     NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY   (service role — NUNCA en el cliente ni en git)
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

const ROLES = ["direccion", "administracion", "coordinador", "miembro", "externo"];
const AREAS = ["direccion", "administracion", "operaciones", "diseno", "contenido", "logistica", "tech"];

/* --flag valor  →  { flag: "valor" }. Los booleanos (--dry-run) quedan en true. */
function leerArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const clave = argv[i].slice(2);
    const siguiente = argv[i + 1];
    if (siguiente && !siguiente.startsWith("--")) {
      args[clave] = siguiente;
      i++;
    } else {
      args[clave] = true;
    }
  }
  return args;
}

const args = leerArgs(process.argv.slice(2));
const SIMULACRO = args["dry-run"] === true;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY || URL.includes("placeholder")) {
  console.error(
    "Faltan credenciales reales. Configura NEXT_PUBLIC_SUPABASE_URL y " +
      "SUPABASE_SERVICE_ROLE_KEY en .env.local.",
  );
  process.exit(1);
}

const email = String(args.email ?? "").trim().toLowerCase();
const nombre = String(args.nombre ?? "").trim();
const rol = String(args.rol ?? "miembro").trim();
const area = String(args.area ?? "operaciones").trim();
const color = String(args.color ?? "#94a3b8").trim();
const password = String(args.password ?? "").trim();

const problemas = [];
if (!email.includes("@")) problemas.push("--email debe ser un correo válido");
if (!nombre) problemas.push("--nombre es obligatorio");
if (!ROLES.includes(rol)) problemas.push(`--rol debe ser uno de: ${ROLES.join(", ")}`);
if (!AREAS.includes(area)) problemas.push(`--area debe ser una de: ${AREAS.join(", ")}`);
if (password.length < 8) problemas.push("--password debe tener al menos 8 caracteres");
if (problemas.length) {
  console.error("No se puede dar de alta:\n  - " + problemas.join("\n  - "));
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log(
    `${SIMULACRO ? "[simulacro] " : ""}${nombre} <${email}> — rol ${rol}, área ${area}`,
  );

  const { data: lista, error: errLista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (errLista) throw errLista;
  const existente = lista.users.find((u) => u.email?.toLowerCase() === email);

  if (SIMULACRO) {
    console.log(existente ? "· actualizaría el usuario y su perfil" : "＋ crearía el usuario y su perfil");
    return;
  }

  let id;
  if (existente) {
    const { error } = await admin.auth.admin.updateUserById(existente.id, {
      password,
      user_metadata: { nombre },
    });
    if (error) throw new Error(`${email}: ${error.message}`);
    id = existente.id;
    console.log("· usuario actualizado");
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nombre },
    });
    if (error) throw new Error(`${email}: ${error.message}`);
    id = data.user.id;
    console.log("＋ usuario creado");
  }

  /* El trigger `handle_new_user` ya insertó la fila del perfil con los valores
     por defecto; esto le pone el rol, el área y el color que tocan. */
  const { error: errPerfil } = await admin
    .from("profiles")
    .upsert({ id, nombre, rol, area, color }, { onConflict: "id" });
  if (errPerfil) throw new Error(`perfil de ${email}: ${errPerfil.message}`);
  console.log("· perfil listo");

  console.log("\nListo. Entrega la contraseña en privado y pídele cambiarla.");
}

main().catch((e) => {
  console.error("\nError dando de alta:", e.message ?? e);
  process.exit(1);
});
