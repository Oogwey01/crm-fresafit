/* ============================================================================
   scripts/set-passwords.mjs  —  Aplica en Supabase Auth las contraseñas
   individuales del archivo usuarios-fresafit.txt (que NO está en git).
   ----------------------------------------------------------------------------
   Lee la tabla del .txt (columnas: Usuario | Correo | Contraseña | Rol | Área),
   crea al usuario si no existe y le actualiza la contraseña si ya existe.
   Es idempotente: se puede correr varias veces.

   Uso (Node 20+):
     node --env-file=.env.local scripts/set-passwords.mjs
     node --env-file=.env.local scripts/set-passwords.mjs --dry-run

   Requiere en el entorno:
     NEXT_PUBLIC_SUPABASE_URL
     SUPABASE_SERVICE_ROLE_KEY   (service role — NUNCA en el cliente ni en git)
   ============================================================================ */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), "..");
const ARCHIVO = join(RAIZ, "usuarios-fresafit.txt");
const SIMULACRO = process.argv.includes("--dry-run");

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !SERVICE_KEY || URL.includes("placeholder")) {
  console.error(
    "Faltan credenciales reales. Configura NEXT_PUBLIC_SUPABASE_URL y " +
      "SUPABASE_SERVICE_ROLE_KEY en .env.local.",
  );
  process.exit(1);
}

/* Parsea las filas de la tabla: 5 columnas separadas por "|". */
function leerEquipo() {
  const lineas = readFileSync(ARCHIVO, "utf8").split("\n");
  const personas = [];

  for (const linea of lineas) {
    const cols = linea.split("|").map((c) => c.trim());
    if (cols.length !== 5) continue;
    const [nombre, email, password, rol, area] = cols;
    if (!email.includes("@")) continue; // salta el encabezado y separadores
    personas.push({ nombre, email, password, rol, area });
  }
  return personas;
}

const admin = createClient(URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const equipo = leerEquipo();
  if (equipo.length === 0) {
    console.error(`No se encontraron filas de usuarios en ${ARCHIVO}`);
    process.exit(1);
  }

  const debiles = equipo.filter((p) => p.password.length < 8);
  if (debiles.length > 0) {
    console.error(
      "Contraseñas de menos de 8 caracteres (Supabase las rechaza): " +
        debiles.map((p) => p.email).join(", "),
    );
    process.exit(1);
  }

  const repetidas = equipo.length - new Set(equipo.map((p) => p.password)).size;
  if (repetidas > 0) {
    console.error(`Hay ${repetidas} contraseña(s) repetida(s); deben ser distintas.`);
    process.exit(1);
  }

  console.log(`${equipo.length} usuarios en ${ARCHIVO}${SIMULACRO ? "  (simulacro)" : ""}\n`);

  const { data: lista, error: errLista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (errLista) throw errLista;
  const porCorreo = new Map(lista.users.map((u) => [u.email?.toLowerCase(), u]));

  for (const persona of equipo) {
    const existente = porCorreo.get(persona.email.toLowerCase());

    if (SIMULACRO) {
      console.log(`${existente ? "· actualizaría" : "＋ crearía   "}  ${persona.email}`);
      continue;
    }

    if (existente) {
      const { error } = await admin.auth.admin.updateUserById(existente.id, {
        password: persona.password,
      });
      if (error) throw new Error(`${persona.email}: ${error.message}`);
      console.log(`· actualizado  ${persona.email}`);
    } else {
      const { error } = await admin.auth.admin.createUser({
        email: persona.email,
        password: persona.password,
        email_confirm: true,
        user_metadata: { nombre: persona.nombre },
      });
      if (error) throw new Error(`${persona.email}: ${error.message}`);
      console.log(`＋ creado      ${persona.email}`);
    }
  }

  console.log("\nListo. Entreguen cada contraseña en privado a su dueño.");
}

main().catch((e) => {
  console.error("\nError aplicando contraseñas:", e.message ?? e);
  process.exit(1);
});
