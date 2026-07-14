/* ============================================================================
   lib/mercadolibre/api.ts — Cliente mínimo de la API de Mercado Libre
   ----------------------------------------------------------------------------
   Solo servidor (service role para leer/guardar tokens en `integraciones`).
   A diferencia de Tienda Nube, el access token dura 6 HORAS y el refresh
   token es de UN SOLO USO (rotación): conexionMercadolibre() renueva solo
   cuando falta poco y con compare-and-swap para tolerar procesos serverless
   concurrentes (webhook + cron a la vez).
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";

const API_BASE = "https://api.mercadolibre.com";
const AUTH_URL = "https://auth.mercadolibre.com.mx/authorization";
/* Renovar cuando falten menos de 30 min de las 6 h de vida del token. */
const MARGEN_REFRESH_MS = 30 * 60 * 1000;

export type ConexionML = { token: string; userId: string };

type AtributoML = { id: string; value_name?: string | null };

export type VariacionML = {
  id: number;
  available_quantity: number;
  price?: number;
  seller_custom_field?: string | null;
  attributes?: AtributoML[];
  attribute_combinations?: AtributoML[]; // "Color: Rojo", "Talla: M", …
};

export type ItemML = {
  id: string; // "MLM..."
  title: string;
  price: number;
  available_quantity: number;
  status: string; // active | paused | closed | ...
  seller_custom_field?: string | null;
  attributes?: AtributoML[];
  variations: VariacionML[];
};

/* El SKU puede venir en seller_custom_field o como atributo SELLER_SKU,
   según cómo se haya creado la publicación. */
export function skuML(x: {
  seller_custom_field?: string | null;
  attributes?: AtributoML[];
}): string | null {
  const directo = x.seller_custom_field?.trim();
  if (directo) return directo;
  const attr = x.attributes?.find((a) => a.id === "SELLER_SKU")?.value_name?.trim();
  return attr || null;
}

/* ------------------------- Conexión y tokens ----------------------------- */

type TokensML = {
  access_token: string;
  refresh_token: string;
  expires_in: number; // segundos (10800 = 6 h)
  user_id: number;
};

export async function guardarConexionML(t: TokensML): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin.from("integraciones").upsert({
    id: "mercadolibre",
    access_token: t.access_token,
    external_id: String(t.user_id),
    refresh_token: t.refresh_token,
    expires_at: expiraEn(t.expires_in),
  });
  if (error) throw new Error(error.message);
}

function expiraEn(expiresInSeg: number): string {
  return new Date(Date.now() + (expiresInSeg - 60) * 1000).toISOString();
}

export async function conexionMercadolibre(): Promise<ConexionML | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integraciones")
    .select("access_token, external_id, refresh_token, expires_at")
    .eq("id", "mercadolibre")
    .maybeSingle();
  if (!data) return null;

  const vence = data.expires_at ? Date.parse(data.expires_at) : 0;
  if (vence - Date.now() > MARGEN_REFRESH_MS) {
    return { token: data.access_token, userId: data.external_id };
  }
  return refrescarToken(data.external_id, data.refresh_token);
}

/* Renueva el token. El refresh token es de un solo uso: si dos procesos
   compiten, solo uno logra el POST; el otro recibe invalid_grant y debe
   releer la fila para usar los tokens del ganador. */
async function refrescarToken(userId: string, refreshViejo: string | null): Promise<ConexionML> {
  if (!refreshViejo) throw new Error("Mercado Libre sin refresh token; reconecta la cuenta.");
  const admin = createAdminClient();

  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.MELI_CLIENT_ID ?? "",
      client_secret: process.env.MELI_CLIENT_SECRET ?? "",
      refresh_token: refreshViejo,
    }),
  });

  if (!res.ok) {
    // ¿Otro proceso ya rotó el token? Releer: si el refresh cambió, ese ganó.
    const { data } = await admin
      .from("integraciones")
      .select("access_token, external_id, refresh_token")
      .eq("id", "mercadolibre")
      .maybeSingle();
    if (data?.refresh_token && data.refresh_token !== refreshViejo) {
      return { token: data.access_token, userId: data.external_id };
    }
    throw new Error(
      `No se pudo renovar el token de Mercado Libre (HTTP ${res.status}); reconecta la cuenta desde Inventario.`,
    );
  }

  const t = (await res.json()) as TokensML;
  const fila = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: expiraEn(t.expires_in),
  };
  // Compare-and-swap sobre el refresh token viejo. Si no matchea (otro
  // proceso escribió en medio), nuestros tokens siguen siendo los más
  // recientes emitidos por ML (el POST exitoso rotó el token): se escriben
  // sin condición para no dejar guardado un refresh ya quemado.
  const { data: cas } = await admin
    .from("integraciones")
    .update(fila)
    .eq("id", "mercadolibre")
    .eq("refresh_token", refreshViejo)
    .select("id");
  if (!cas?.length) {
    await admin.from("integraciones").update(fila).eq("id", "mercadolibre");
  }
  return { token: t.access_token, userId };
}

export async function estadoMercadolibre(): Promise<{ conectada: boolean; ultimaSync: string | null }> {
  try {
    const admin = createAdminClient();
    const { data } = await admin
      .from("integraciones")
      .select("datos")
      .eq("id", "mercadolibre")
      .maybeSingle();
    if (!data) return { conectada: false, ultimaSync: null };
    const datos = data.datos as { ultima_sync?: string } | null;
    return { conectada: true, ultimaSync: datos?.ultima_sync ?? null };
  } catch {
    return { conectada: false, ultimaSync: null };
  }
}

/* ------------------------------ OAuth ------------------------------------ */

export function urlAutorizacionML(): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.MELI_CLIENT_ID ?? "",
    redirect_uri: process.env.MELI_REDIRECT_URI ?? "",
  });
  return `${AUTH_URL}?${params}`;
}

export async function intercambiarCodigoML(code: string): Promise<TokensML> {
  const res = await fetch(`${API_BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.MELI_CLIENT_ID ?? "",
      client_secret: process.env.MELI_CLIENT_SECRET ?? "",
      code,
      redirect_uri: process.env.MELI_REDIRECT_URI ?? "",
    }),
  });
  const data = (await res.json().catch(() => null)) as (TokensML & { message?: string }) | null;
  if (!res.ok || !data?.access_token || !data.refresh_token) {
    throw new Error(`Mercado Libre rechazó el código (HTTP ${res.status}): ${data?.message ?? "sin detalle"}`);
  }
  return data;
}

/* --------------------------- Requests base ------------------------------- */

/* Ante 401 renueva el token una vez y reintenta; ante 429 espera y reintenta
   hasta 3 veces. */
async function mlFetch(cx: ConexionML, path: string, init?: RequestInit): Promise<Response> {
  let token = cx.token;
  for (let intento = 0; ; intento++) {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init?.headers,
      },
      cache: "no-store",
    });
    if (res.status === 401 && intento === 0) {
      const admin = createAdminClient();
      const { data } = await admin
        .from("integraciones")
        .select("external_id, refresh_token")
        .eq("id", "mercadolibre")
        .maybeSingle();
      if (!data) return res;
      token = (await refrescarToken(data.external_id, data.refresh_token)).token;
      continue;
    }
    if (res.status !== 429 || intento >= 3) return res;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

/* ------------------------------- Items ----------------------------------- */

export async function obtenerItemML(cx: ConexionML, id: string): Promise<ItemML | null> {
  const res = await mlFetch(cx, `/items/${id}?include_attributes=all`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al pedir el item ${id}.`);
  return (await res.json()) as ItemML;
}

/* Catálogo completo del seller: ids paginados + multiget en lotes de 20.
   Con search_type=scan alcanza también catálogos de más de 1000 items. */
export async function listarItemsML(cx: ConexionML): Promise<ItemML[]> {
  const ids: string[] = [];
  let scrollId: string | null = null;
  for (;;) {
    const params = new URLSearchParams({ search_type: "scan", limit: "100" });
    if (scrollId) params.set("scroll_id", scrollId);
    const res = await mlFetch(cx, `/users/${cx.userId}/items/search?${params}`);
    if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al listar items.`);
    const data = (await res.json()) as { results: string[]; scroll_id?: string };
    ids.push(...(data.results ?? []));
    if (!data.results?.length || !data.scroll_id) break;
    scrollId = data.scroll_id;
  }

  const items: ItemML[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const lote = ids.slice(i, i + 20);
    const res = await mlFetch(cx, `/items?ids=${lote.join(",")}&include_attributes=all`);
    if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} en el multiget de items.`);
    const cuerpos = (await res.json()) as { code: number; body: ItemML }[];
    items.push(...cuerpos.filter((c) => c.code === 200).map((c) => c.body));
  }
  return items;
}

/* Sync inversa (CRM/hub → ML): actualiza el stock de un item o variación. */
export async function actualizarStockML(
  cx: ConexionML,
  itemId: string,
  variationId: number | null,
  cantidad: number,
): Promise<void> {
  const body =
    variationId == null
      ? { available_quantity: cantidad }
      : { variations: [{ id: variationId, available_quantity: cantidad }] };
  const res = await mlFetch(cx, `/items/${itemId}`, { method: "PUT", body: JSON.stringify(body) });
  if (!res.ok) {
    // Los items cerrados rechazan cambios de stock; el llamador decide si sigue.
    throw new Error(`Mercado Libre respondió ${res.status} al actualizar el stock de ${itemId}.`);
  }
}
