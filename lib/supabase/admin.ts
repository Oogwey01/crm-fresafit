import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/* Cliente con service role (salta RLS). SOLO para código de servidor que corre
   sin sesión de usuario: webhooks y sincronización de Tienda Nube, crons.
   Nunca importarlo desde componentes de cliente.
   Singleton perezoso: el cliente es stateless (sin sesión ni refresh), así que
   las ~50 llamadas repartidas por lib/ comparten una sola instancia. */
/* SupabaseClient sin genéricos = Database `any`, igual que devolvía
   createClient() antes del singleton (ReturnType del genérico daría `never`). */
let instancia: SupabaseClient | null = null;

export function createAdminClient() {
  if (instancia) return instancia;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  }
  instancia = createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return instancia;
}
