/* ============================================================================
   lib/tiendanube/api.ts — Cliente mínimo de la API de Tienda Nube (2025-03)
   ----------------------------------------------------------------------------
   Solo servidor: usa el service role para leer/guardar el access token en la
   tabla `integraciones`. El token no expira mientras la app siga instalada.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";

const API_BASE = "https://api.tiendanube.com/2025-03";
const AUTH_BASE = "https://www.tiendanube.com/apps";
/* Header obligatorio: sin User-Agent la API responde 400. */
const USER_AGENT = "CRM Fresafit (ovy3200@gmail.com)";

export type ConexionTN = { token: string; storeId: string };

/* Los textos (name, values) llegan multiidioma: { es: "...", pt: "..." }. */
export type VarianteTN = {
  id: number;
  product_id: number;
  price: string | null;
  cost?: string | null;
  stock: number | null; // null = la tienda no controla stock de esta variante
  sku: string | null;
  values: Record<string, string>[];
};

export type ProductoTN = {
  id: number;
  name: Record<string, string>;
  published: boolean;
  variants: VarianteTN[];
};

/* ------------------------- Conexión guardada ----------------------------- */

export async function conexionTiendanube(): Promise<ConexionTN | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integraciones")
    .select("access_token, external_id")
    .eq("id", "tiendanube")
    .maybeSingle();
  if (!data) return null;
  return { token: data.access_token, storeId: data.external_id };
}

export async function guardarConexion(token: string, storeId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("integraciones")
    .upsert({ id: "tiendanube", access_token: token, external_id: storeId });
  if (error) throw new Error(error.message);
}

/* Estado para la UI (sin exponer el token). Si el entorno no tiene service
   role key, simplemente se reporta como no conectada. */
export async function estadoTiendanube(): Promise<{ conectada: boolean; ultimaSync: string | null }> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("integraciones")
      .select("datos")
      .eq("id", "tiendanube")
      .maybeSingle();
    if (!data) return { conectada: false, ultimaSync: null };
    const datos = data.datos as { ultima_sync?: string } | null;
    return { conectada: true, ultimaSync: datos?.ultima_sync ?? null };
  } catch {
    return { conectada: false, ultimaSync: null };
  }
}

/* ------------------------------ OAuth ------------------------------------ */

export function urlAutorizacion(): string {
  return `${AUTH_BASE}/${process.env.TIENDANUBE_CLIENT_ID}/authorize`;
}

/* Cambia el código de autorización (válido 5 minutos) por el access token. */
export async function intercambiarCodigo(code: string): Promise<{ token: string; storeId: string }> {
  const res = await fetch(`${AUTH_BASE}/authorize/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": USER_AGENT },
    body: JSON.stringify({
      client_id: process.env.TIENDANUBE_CLIENT_ID,
      client_secret: process.env.TIENDANUBE_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
    }),
  });
  const data = (await res.json().catch(() => null)) as
    | { access_token?: string; user_id?: number | string; error?: string; error_description?: string }
    | null;
  if (!res.ok || !data?.access_token || data.user_id == null) {
    throw new Error(
      `Tienda Nube rechazó el código (HTTP ${res.status}): ${data?.error_description ?? data?.error ?? "sin detalle"}`,
    );
  }
  return { token: data.access_token, storeId: String(data.user_id) };
}

/* --------------------------- Requests base ------------------------------- */

/* Rate limit (leaky bucket, 2 req/s): ante 429 espera lo que indique
   x-rate-limit-reset y reintenta hasta 3 veces. */
async function tnFetch(cx: ConexionTN, path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_BASE}/${cx.storeId}${path}`;
  for (let intento = 0; ; intento++) {
    const res = await fetch(url, {
      ...init,
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        /* La doc de 2025-03 pide Authorization; las versiones previas leían
           Authentication. Mandar ambos cubre las dos sin estorbar. */
        Authorization: `bearer ${cx.token}`,
        Authentication: `bearer ${cx.token}`,
        ...init?.headers,
      },
      cache: "no-store",
    });
    if (res.status !== 429 || intento >= 3) return res;
    const reset = Number(res.headers.get("x-rate-limit-reset")) || 2000;
    await new Promise((r) => setTimeout(r, Math.min(reset, 10_000)));
  }
}

/* ------------------------------ Productos -------------------------------- */

export async function obtenerProductoTN(cx: ConexionTN, id: number): Promise<ProductoTN | null> {
  const res = await tnFetch(cx, `/products/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Tienda Nube respondió ${res.status} al pedir el producto ${id}.`);
  return (await res.json()) as ProductoTN;
}

/* Catálogo completo (incluye no publicados), paginado. */
export async function listarProductosTN(cx: ConexionTN): Promise<ProductoTN[]> {
  const POR_PAGINA = 200;
  const todos: ProductoTN[] = [];
  for (let page = 1; ; page++) {
    const res = await tnFetch(cx, `/products?per_page=${POR_PAGINA}&page=${page}`);
    if (res.status === 404) break; // más allá de la última página
    if (!res.ok) throw new Error(`Tienda Nube respondió ${res.status} al listar productos.`);
    const lote = (await res.json()) as ProductoTN[];
    todos.push(...lote);
    if (lote.length < POR_PAGINA) break;
  }
  return todos;
}

/* Empuja cambios de una variante hacia Tienda Nube (sync inversa CRM → tienda).
   Solo los campos presentes en `cambios` se tocan. */
export async function actualizarVarianteTN(
  cx: ConexionTN,
  productId: number,
  variantId: number,
  cambios: { stock?: number; price?: number; cost?: number },
): Promise<void> {
  const res = await tnFetch(cx, `/products/${productId}/variants/${variantId}`, {
    method: "PUT",
    body: JSON.stringify(cambios),
  });
  if (!res.ok) {
    throw new Error(`Tienda Nube respondió ${res.status} al actualizar la variante ${variantId}.`);
  }
}

/* ------------------------------ Webhooks --------------------------------- */

const EVENTOS_WEBHOOK = ["product/created", "product/updated", "product/deleted"] as const;

/* Alta idempotente: crea (o corrige la URL de) los webhooks de productos.
   Tienda Nube solo acepta URLs https públicas. */
export async function registrarWebhooksTN(cx: ConexionTN, baseUrl: string): Promise<void> {
  const url = `${baseUrl}/api/tiendanube/webhook`;
  const res = await tnFetch(cx, "/webhooks");
  if (!res.ok) throw new Error(`Tienda Nube respondió ${res.status} al listar webhooks.`);
  const existentes = (await res.json()) as { id: number; event: string; url: string }[];

  for (const event of EVENTOS_WEBHOOK) {
    const previo = existentes.find((w) => w.event === event);
    if (previo?.url === url) continue;
    const r = previo
      ? await tnFetch(cx, `/webhooks/${previo.id}`, { method: "PUT", body: JSON.stringify({ event, url }) })
      : await tnFetch(cx, "/webhooks", { method: "POST", body: JSON.stringify({ event, url }) });
    if (!r.ok) throw new Error(`No se pudo registrar el webhook ${event} (HTTP ${r.status}).`);
  }
}
