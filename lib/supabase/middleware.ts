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
  /* El service worker y el manifest los pide el navegador SIN cookies de sesión
     (y a veces antes de que exista sesión). Si se redirigen al login, el
     registro del worker falla y no llega ni un aviso push. */
  "/sw.js",
  "/manifest.webmanifest",
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
  // El search se descarta a propósito: un redirect de navegación no debe
  // arrastrar el `?_rsc=` de un prefetch ni el `?sesion=` del aviso de expirada.
  function redirigir(pathname: string) {
    const url = request.nextUrl.clone();
    url.pathname = pathname;
    url.search = "";
    const res = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
    return res;
  }

  // Sin sesión y en ruta protegida → al login.
  if (!autenticado && !esPublica) return redirigir("/login");

  /* Con sesión aparente y en el login → al tablero, pero SOLO tras confirmarlo
     contra Supabase.

     getClaims() únicamente verifica la firma del JWT: un token revocado (cerrar
     sesión en otro dispositivo, cambio de contraseña, refresh token ya rotado)
     se sigue viendo válido hasta que expira, hasta una hora después. El layout
     de (app) sí pregunta por red, así que veía lo contrario y rebotaba a
     /login... que aquí rebotaba a /tareas. Ese ping-pong es el
     ERR_TOO_MANY_REDIRECTS que dejaba a la gente fuera del CRM — y en la PWA
     instalada, sin barra de direcciones, sin escapatoria.

     La confirmación se paga solo en /login, que casi no se visita; el resto de
     las rutas conserva el getClaims() rápido de arriba. */
  if (autenticado && path === "/login") {
    /* Red de seguridad: si el layout de (app) acaba de rebotar aquí porque su
       getUser() no vio sesión, no se vuelve a mandar al tablero pase lo que
       pase. Así ningún desajuste futuro entre las dos guardias puede reabrir el
       bucle — y de paso se ahorra la llamada de red, porque la respuesta ya se
       sabe. */
    const rebotadoPorSesion = request.nextUrl.searchParams.get("sesion") === "expirada";

    let vivo = false;
    if (!rebotadoPorSesion) {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      vivo = !!user;
    }
    if (vivo) return redirigir("/tareas");

    /* Sesión zombi: firmada pero muerta. Se borran las cookies (scope local: no
       toca las sesiones de los demás dispositivos, y no cuesta red) para que la
       próxima visita arranque limpia en vez de repetir este rodeo en cada
       request hasta que el token expire. signOut escribe las cookies vacías en
       supabaseResponse a través de setAll, así que basta con devolverla. */
    await supabase.auth.signOut({ scope: "local" });
  }

  return supabaseResponse;
}
