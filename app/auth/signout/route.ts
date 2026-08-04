import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

/* Cierra la sesión y vuelve al login.

   No usa el createClient() de lib/supabase/server a propósito: aquel escribe en
   el store de next/headers, y aquí la respuesta se construye a mano con
   NextResponse.redirect(), que nace vacía. Las cookies que Supabase borra tienen
   que aterrizar en ESA respuesta o el navegador se queda con la sesión puesta —
   y una cookie que sobrevive a su propia sesión es justo el estado que hacía
   rebotar al proxy contra el layout hasta el ERR_TOO_MANY_REDIRECTS.

   `scope: "local"` cierra solo este dispositivo. El global (el que traía por
   omisión) revocaba la sesión en todos: cerrar sesión en la laptop tumbaba el
   celular de la misma persona, que se quedaba con un JWT aún firmado pero ya
   muerto. */
export async function POST(request: Request) {
  const cookieStore = await cookies();
  const { origin } = new URL(request.url);
  const respuesta = NextResponse.redirect(`${origin}/login`, { status: 303 });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            respuesta.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  await supabase.auth.signOut({ scope: "local" });

  return respuesta;
}
