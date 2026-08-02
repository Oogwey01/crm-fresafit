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
import { estadoIntegracion } from "@/lib/canales/integraciones";
import { ESCRITURA_CANALES } from "@/lib/inventario/escritura-canales";

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
  /* Fotos de ESTA variación: son ids que apuntan a `pictures` del item. */
  picture_ids?: string[];
};

/* Foto de la publicación. `secure_url` es la de https; `url` es el respaldo. */
export type FotoML = {
  id: string;
  secure_url?: string | null;
  url?: string | null;
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
  /* Modalidad de envío de la publicación. "fulfillment" = Mercado Full: la
     mercancía YA está depositada en un centro de ML, no en nuestra bodega. El
     dato es del ITEM (no de la variación) y viene en el multiget completo. */
  shipping?: { logistic_type?: string | null } | null;
  /* Artículo del vendedor ("MLMU…"): la unidad de INVENTARIO. Dos publicaciones
     con el mismo user_product_id comparten bodega — es lo que pasa cuando ML
     suma un artículo a su catálogo y crea una publicación gemela. */
  user_product_id?: string | null;
  /* Galería de la publicación, en orden. Las variaciones referencian estas
     fotos por id (`picture_ids`). */
  pictures?: FotoML[];
};

/* Publicación en Mercado Full (stock en el centro de ML). */
export const LOGISTICA_FULL = "fulfillment";

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
  return estadoIntegracion("mercadolibre");
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

/* Stock que tiene AHORA MISMO una unidad (item, o item + variación).

   Lo pide el hub justo antes de escribir, por el mismo motivo que en Tienda
   Nube: se aplica el movimiento sobre lo que hay, no el número que el CRM
   recordaba. `undefined` = la publicación o la variación ya no existe. */
export async function stockActualML(
  cx: ConexionML,
  itemId: string,
  variationId: number | null,
): Promise<number | undefined> {
  const item = await obtenerItemML(cx, itemId);
  if (!item) return undefined;
  if (variationId == null) return Math.max(0, item.available_quantity ?? 0);
  const v = (item.variations ?? []).find((x) => x.id === variationId);
  return v ? Math.max(0, v.available_quantity ?? 0) : undefined;
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

/* Sync inversa (CRM/hub → ML): actualiza el stock de un item o variación.

   CANDADO: con SYNC_ESCRITURA_CANALES apagado (el default) esto es un no-op —
   el CRM no modifica el inventario de Mercado Libre. Es la única función que
   escribe en ML, así que el candado cubre toda ruta presente y futura. */
export async function actualizarStockML(
  cx: ConexionML,
  itemId: string,
  variationId: number | null,
  cantidad: number,
): Promise<void> {
  if (!ESCRITURA_CANALES) {
    console.warn("[solo-lectura] escritura a Mercado Libre omitida", { itemId, variationId, cantidad });
    return;
  }
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

/* ------------------------------ Órdenes ---------------------------------- */

/* Renglón de una orden (un producto vendido). El id del item y su variación
   son las mismas llaves con las que el catálogo mapea a `products`. */
export type LineaOrdenML = {
  item: {
    id: string; // "MLM..."
    title?: string | null;
    variation_id?: number | null;
    seller_sku?: string | null;
  };
  quantity: number | string;
  unit_price: number | string;
};

/* ML restringe el PII del comprador: `email`/`phone` suelen venir ausentes o
   anonimizados; `id` y `nickname` sí llegan siempre. */
export type CompradorML = {
  id: number;
  nickname?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

export type OrdenML = {
  id: number;
  // confirmed | payment_required | payment_in_process | partially_paid |
  // paid | cancelled | invalid
  status: string;
  date_created: string;
  date_closed?: string | null;
  total_amount?: number;
  order_items: LineaOrdenML[];
  buyer?: CompradorML | null;
  // La orden trae el id del envío (el estado vive en /shipments/{id}) y tags de
  // alto nivel ("delivered" / "not_delivered") que evitan consultar los ya
  // entregados.
  shipping?: { id?: number | null } | null;
  tags?: string[] | null;
};

export type EnvioML = {
  // pending | handling | ready_to_ship | shipped | delivered | not_delivered |
  // cancelled | to_be_agreed | …
  status?: string | null;
  substatus?: string | null;
  tracking_number?: string | null;
  tracking_method?: string | null; // nombre de la paquetería / servicio
};

export async function obtenerOrdenML(cx: ConexionML, id: number | string): Promise<OrdenML | null> {
  const res = await mlFetch(cx, `/orders/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al pedir la orden ${id}.`);
  return (await res.json()) as OrdenML;
}

/* Estado de un envío. Devuelve null (sin lanzar) ante cualquier fallo: el
   estado del pedido es un enriquecimiento y jamás debe tumbar la importación
   de la venta. */
export async function obtenerEnvioML(cx: ConexionML, shipmentId: number | string): Promise<EnvioML | null> {
  try {
    const res = await mlFetch(cx, `/shipments/${shipmentId}`);
    if (!res.ok) return null;
    return (await res.json()) as EnvioML;
  } catch {
    return null;
  }
}

/* Órdenes del seller desde una fecha (ISO), paginadas. Incluye canceladas: el
   importador las usa para retirar ventas que se cancelaron tras importarse.
   ML espera el filtro de fecha con offset explícito (…-00:00), no con la 'Z'
   que produce toISOString(). No se pagina más allá de offset 10000 (tope de la
   API): improbable en una ventana de 90 días. */
export async function listarOrdenesML(cx: ConexionML, desdeISO: string): Promise<OrdenML[]> {
  const LIMIT = 50;
  const desde = desdeISO.replace(/Z$/, "-00:00");
  const todas: OrdenML[] = [];
  for (let offset = 0; ; offset += LIMIT) {
    const params = new URLSearchParams({
      seller: cx.userId,
      sort: "date_desc",
      offset: String(offset),
      limit: String(LIMIT),
      "order.date_created.from": desde,
    });
    const res = await mlFetch(cx, `/orders/search?${params}`);
    if (!res.ok) throw new Error(`Mercado Libre respondió ${res.status} al listar órdenes.`);
    const data = (await res.json()) as { results?: OrdenML[]; paging?: { total?: number } };
    const lote = data.results ?? [];
    todas.push(...lote);
    const total = data.paging?.total ?? 0;
    if (lote.length < LIMIT || offset + LIMIT >= total || offset + LIMIT >= 10000) break;
  }
  return todas;
}
