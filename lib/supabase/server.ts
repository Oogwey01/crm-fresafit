/* Cliente de Supabase para el SERVIDOR (Server Components, Route Handlers,
   Server Actions). Lee/escribe la sesión desde las cookies de la petición. */
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "@/lib/supabase/tipos-bd";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Llamado desde un Server Component (sin acceso a escribir cookies).
            // El middleware ya se encarga de refrescar la sesión, así que ok.
          }
        },
      },
    },
  );
}
