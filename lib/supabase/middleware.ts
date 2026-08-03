/* Refresco de sesión + protección de rutas para el middleware de Next.
   Se ejecuta en cada request: renueva el token de Supabase y redirige a /login
   a quien no tenga sesión (salvo las rutas públicas de auth). */
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/* /api/tiendanube y /api/mercadolibre quedan fuera del gate de sesión: los
   webhooks llegan sin cookies (validan firma/origen adentro) y los
   conectar/callback verifican sesión por su cuenta.

   /api/inventario/foto y /api/tareas/recordatorios igual: los dispara un
   programador externo (el plan Hobby de Vercel no da crons frecuentes) y llegan
   sin cookies. Se lista la ruta exacta, no todo el segmento, para no abrir de
   más. Adentro exigen CRON_SECRET o usuario interno, así que sin credencial
   responden 401. */
const RUTAS_PUBLICAS = [
  "/login",
  "/auth",
  "/api/tiendanube",
  "/api/mercadolibre",
  "/api/tiktok",
  "/api/inventario/foto",
  "/api/inventario/reconciliacion",
  "/api/tareas/recordatorios",
];

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  /* IMPORTANTE: no meter lógica entre createServerClient y la validación.

     getClaims() verifica la FIRMA del token localmente contra el JWKS del
     proyecto (ES256, ya publicado), en vez de preguntarle a Supabase por red
     como hace getUser(). Esa llamada costaba ~200 ms en CADA request, y el
     middleware corre en todas las rutas menos los estáticos. El JWKS se
     cachea, y cuando el access token vence getClaims igual dispara el refresh
     por debajo, así que la rotación de cookies sigue funcionando.

     Sigue siendo seguro: se valida criptográficamente, no se confía en la
     cookie a ciegas (que es el motivo por el que no se usa getSession).

     A prueba de fallos: si getClaims no devuelve nada (JWKS inalcanzable, token
     firmado con el secreto viejo HS256, versión sin soporte...) se cae a
     getUser() antes de decidir un redirect. Así el peor caso es perder la
     mejora de velocidad, nunca dejar fuera a alguien con sesión válida. */
  const { data: claims } = await supabase.auth.getClaims();
  let autenticado = !!claims?.claims;
  if (!autenticado) {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    autenticado = !!user;
  }

  const path = request.nextUrl.pathname;
  const esPublica = RUTAS_PUBLICAS.some((r) => path.startsWith(r));

  // Redirige copiando las cookies de sesión ya refrescadas por getUser(); si no,
  // los tokens rotados se perderían y la sesión podría romperse.
  function redirigir(pathname: string) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  }

  // Sin sesión y en ruta protegida → al login.
  if (!autenticado && !esPublica) return redirigir("/login");

  // Con sesión y en el login → directo al tablero.
  if (autenticado && path === "/login") return redirigir("/tareas");

  return supabaseResponse;
}
