/* ============================================================================
   scripts/refrescar-token-tiktok.mjs — Renovar el token de TikTok Shop
   ----------------------------------------------------------------------------
   Los permisos de TikTok quedan grabados en el ACCESS TOKEN, no en la app: si se
   concede un permiso nuevo, el token que ya estaba emitido sigue sin él. Este
   script fuerza la renovación (mismo flujo que usa el CRM) para que el token
   recoja los permisos vigentes, sin tener que esperar a que venza.

   Si después de esto la API sigue negando el acceso, es que hace falta volver a
   autorizar la tienda desde cero (Inventario → conectar TikTok), porque el
   permiso nuevo no entra por refresh sino por una autorización nueva.

   Uso:  node --env-file=.env.local scripts/refrescar-token-tiktok.mjs
   ============================================================================ */

import { createClient } from "@supabase/supabase-js";

const AUTH = "https://auth.tiktok-shops.com";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const { data: fila } = await admin
  .from("integraciones")
  .select("access_token, refresh_token, expires_at")
  .eq("id", "tiktok")
  .maybeSingle();

if (!fila?.refresh_token) {
  console.error("TikTok no está conectado o no tiene refresh token.");
  process.exit(1);
}
console.log("token actual vence:", fila.expires_at);

const url = new URL(`${AUTH}/api/v2/token/refresh`);
url.searchParams.set("app_key", process.env.TIKTOK_APP_KEY ?? "");
url.searchParams.set("app_secret", process.env.TIKTOK_APP_SECRET ?? "");
url.searchParams.set("refresh_token", fila.refresh_token);
url.searchParams.set("grant_type", "refresh_token");

const res = await fetch(url, { headers: { "Content-Type": "application/json" } });
const json = await res.json().catch(() => null);

if (json?.code !== 0 || !json?.data?.access_token) {
  console.error("No se pudo renovar:", JSON.stringify(json).slice(0, 400));
  process.exit(1);
}

const t = json.data;
const expira = new Date((t.access_token_expire_in - 60) * 1000).toISOString();
const { error } = await admin
  .from("integraciones")
  .update({ access_token: t.access_token, refresh_token: t.refresh_token, expires_at: expira })
  .eq("id", "tiktok");
if (error) {
  console.error("Renovado pero no se pudo guardar:", error.message);
  process.exit(1);
}

console.log("token renovado y guardado · nuevo vencimiento:", expira);
/* La respuesta del refresh a veces enumera los permisos concedidos; si viene,
   es la forma más directa de confirmar que el nuevo ya trae analíticas. */
if (t.granted_scopes) console.log("permisos del token:", JSON.stringify(t.granted_scopes));
