/* ============================================================================
   scripts/sesion-verificacion.mjs — Abrir una sesión para verificar en local
   ----------------------------------------------------------------------------
   La receta de verificación entraba por el formulario de login con la contraseña
   del seed, pero esa contraseña deja de servir en cuanto alguien la cambia —que
   es lo normal en una cuenta real—, y entonces no hay forma de mirar la app con
   un navegador automatizado.

   Esto genera la sesión con la llave de servicio (sin conocer contraseñas) y la
   convierte en las MISMAS cookies que escribe la app, usando su propio
   adaptador: así no hay que replicar a mano un formato que puede cambiar entre
   versiones de @supabase/ssr.

   Imprime un JSON listo para `context.addCookies(...)` de Playwright.
   Solo desarrollo: la sesión apunta a localhost.

   Uso:  node --env-file=.env.local scripts/sesion-verificacion.mjs [correo]
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const correo = process.argv[2] ?? "aaron@fresafit.com.mx";
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const servicio = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !servicio || !anon) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY o la llave pública.");
  process.exit(1);
}

/* 1. Un token de acceso de un solo uso, emitido con la llave de servicio. */
const admin = createClient(url, servicio, { auth: { persistSession: false } });
const { data: enlace, error: errEnlace } = await admin.auth.admin.generateLink({
  type: "magiclink",
  email: correo,
});
if (errEnlace) {
  console.error("No se pudo generar el enlace:", errEnlace.message);
  process.exit(1);
}

/* 2. Canjearlo por una sesión real (mismo canje que hace el correo de acceso). */
const publico = createClient(url, anon, { auth: { persistSession: false } });
const { data: sesion, error: errOtp } = await publico.auth.verifyOtp({
  token_hash: enlace.properties.hashed_token,
  type: "magiclink",
});
if (errOtp || !sesion.session) {
  console.error("No se pudo canjear el token:", errOtp?.message ?? "sin sesión");
  process.exit(1);
}

/* 3. Dejar que @supabase/ssr serialice esa sesión en cookies. Se le da un
      almacén de mentira que solo captura lo que intenta escribir. */
const cookies = [];
const servidor = createServerClient(url, anon, {
  cookies: {
    getAll: () => [],
    setAll: (nuevas) => cookies.push(...nuevas),
  },
});
await servidor.auth.setSession({
  access_token: sesion.session.access_token,
  refresh_token: sesion.session.refresh_token,
});

if (cookies.length === 0) {
  console.error("El adaptador no escribió cookies; revisa la versión de @supabase/ssr.");
  process.exit(1);
}

console.log(
  JSON.stringify(
    cookies.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "localhost",
      path: "/",
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    })),
  ),
);
