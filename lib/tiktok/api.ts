/* ============================================================================
   lib/tiktok/api.ts — Cliente firmado de la API de TikTok Shop (Open API v202309)
   ----------------------------------------------------------------------------
   Solo servidor (service role para leer/guardar tokens en `integraciones`,
   id = 'tiktok'). Particularidades de TikTok frente a TN/ML:
     * Cada petición se FIRMA (HMAC-SHA256) — algoritmo validado contra la API
       real (firma buena → pasa; firma rota → code 106001). Ver `firmar`.
     * El access token dura ~7 días; su vencimiento llega como timestamp UNIX
       ABSOLUTO (access_token_expire_in), no como duración relativa.
     * Las llamadas de negocio necesitan `shop_cipher` (se obtiene una vez con
       getAuthorizedShops y se guarda en integraciones.datos).
     * El access token va en el header `x-tts-access-token`, NO se firma.
   ============================================================================ */

import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const API_BASE = "https://open-api.tiktokglobalshop.com";
const AUTH_BASE = "https://auth.tiktok-shops.com";
/* Renovar cuando falte menos de 1 h de vida del token (dura ~7 días). */
const MARGEN_REFRESH_MS = 60 * 60 * 1000;

export type ConexionTikTok = {
  accessToken: string;
  shopCipher: string;
  shopId: string;
  warehouseId: string | null; // almacén principal (para escribir stock)
};

type TokensTikTok = {
  access_token: string;
  refresh_token: string;
  access_token_expire_in: number; // timestamp UNIX absoluto (segundos)
  refresh_token_expire_in: number;
  open_id?: string;
  seller_name?: string;
  seller_base_region?: string;
};

/* ------------------------------- Firma ----------------------------------- */

/* Firma HMAC-SHA256 validada contra la API real:
   app_secret + path + concat("{key}{value}" de params ordenados alfabéticamente,
   excluyendo sign/access_token) + body(si no es GET ni multipart) + app_secret,
   con app_secret como llave, en hexadecimal. */
export function firmar(path: string, query: Record<string, string>, body: string | null): string {
  const secret = process.env.TIKTOK_APP_SECRET ?? "";
  const params = { ...query };
  delete (params as Record<string, string>).sign;
  delete (params as Record<string, string>).access_token;
  let s = path;
  for (const k of Object.keys(params).sort()) s += `${k}${params[k]}`;
  if (body) s += body;
  s = secret + s + secret;
  return createHmac("sha256", secret).update(s).digest("hex");
}

/* ------------------------- Conexión y tokens ----------------------------- */

function expiraEn(timestampAbsSeg: number): string {
  // access_token_expire_in ya es UNIX absoluto; restamos 60 s de colchón.
  return new Date((timestampAbsSeg - 60) * 1000).toISOString();
}

export async function guardarConexionTikTok(
  t: TokensTikTok,
  shop: { cipher: string; id: string },
): Promise<void> {
  const admin = createAdminClient();
  const { data: fila } = await admin.from("integraciones").select("datos").eq("id", "tiktok").maybeSingle();
  const { error } = await admin.from("integraciones").upsert({
    id: "tiktok",
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    external_id: shop.id,
    expires_at: expiraEn(t.access_token_expire_in),
    datos: { ...((fila?.datos as object) ?? {}), shop_cipher: shop.cipher, shop_id: shop.id },
  });
  if (error) throw new Error(error.message);
}

export async function conexionTiktok(): Promise<ConexionTikTok | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("integraciones")
    .select("access_token, refresh_token, external_id, expires_at, datos")
    .eq("id", "tiktok")
    .maybeSingle();
  if (!data) return null;
  const datos = (data.datos ?? {}) as { shop_cipher?: string; shop_id?: string; warehouse_id?: string };
  const shopCipher = datos.shop_cipher ?? "";
  const shopId = datos.shop_id ?? data.external_id ?? "";
  const warehouseId = datos.warehouse_id ?? null;

  const vence = data.expires_at ? Date.parse(data.expires_at) : 0;
  if (vence - Date.now() > MARGEN_REFRESH_MS) {
    return { accessToken: data.access_token, shopCipher, shopId, warehouseId };
  }
  const token = await refrescarToken(data.refresh_token);
  return { accessToken: token, shopCipher, shopId, warehouseId };
}

/* Renueva el access token con el refresh token. Ante fallo, relee la fila por
   si otro proceso serverless ya rotó el token (misma idea que Mercado Libre). */
async function refrescarToken(refreshViejo: string | null): Promise<string> {
  if (!refreshViejo) throw new Error("TikTok Shop sin refresh token; reconecta la cuenta.");
  const admin = createAdminClient();

  const url = new URL(`${AUTH_BASE}/api/v2/token/refresh`);
  url.searchParams.set("app_key", process.env.TIKTOK_APP_KEY ?? "");
  url.searchParams.set("app_secret", process.env.TIKTOK_APP_SECRET ?? "");
  url.searchParams.set("refresh_token", refreshViejo);
  url.searchParams.set("grant_type", "refresh_token");

  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { code?: number; data?: TokensTikTok } | null;
  if (!res.ok || json?.code !== 0 || !json.data?.access_token) {
    const { data } = await admin
      .from("integraciones")
      .select("access_token, refresh_token")
      .eq("id", "tiktok")
      .maybeSingle();
    if (data?.refresh_token && data.refresh_token !== refreshViejo) return data.access_token;
    throw new Error("No se pudo renovar el token de TikTok Shop; reconecta la cuenta desde Inventario.");
  }

  const t = json.data;
  const fila = {
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    expires_at: expiraEn(t.access_token_expire_in),
  };
  const { data: cas } = await admin
    .from("integraciones")
    .update(fila)
    .eq("id", "tiktok")
    .eq("refresh_token", refreshViejo)
    .select("id");
  if (!cas?.length) await admin.from("integraciones").update(fila).eq("id", "tiktok");
  return t.access_token;
}

/* Guarda el almacén principal en integraciones.datos (se elige al conectar). */
export async function guardarWarehouseTikTok(warehouseId: string): Promise<void> {
  const admin = createAdminClient();
  const { data } = await admin.from("integraciones").select("datos").eq("id", "tiktok").maybeSingle();
  await admin
    .from("integraciones")
    .update({ datos: { ...((data?.datos as object) ?? {}), warehouse_id: warehouseId } })
    .eq("id", "tiktok");
}

export async function estadoTiktok(): Promise<{ conectada: boolean; ultimaSync: string | null }> {
  try {
    const admin = createAdminClient();
    const { data } = await admin.from("integraciones").select("datos").eq("id", "tiktok").maybeSingle();
    if (!data) return { conectada: false, ultimaSync: null };
    const datos = data.datos as { ultima_sync?: string } | null;
    return { conectada: true, ultimaSync: datos?.ultima_sync ?? null };
  } catch {
    return { conectada: false, ultimaSync: null };
  }
}

/* ------------------------------ OAuth ------------------------------------ */

/* URL de autorización (el vendedor la abre para conceder acceso a su tienda).
   Formato basado en el app_id (service), el mismo que funcionó al autorizar la
   tienda sandbox. Redirige al login del vendedor y de vuelta a TIKTOK_REDIRECT_URI
   con `code`. Región MX (Fresafit es seller local mexicano). */
const TIKTOK_APP_ID = process.env.TIKTOK_APP_ID ?? "7663534939447363336";

export function urlAutorizacionTikTok(): string {
  return `https://seller-mx.tiktok.com/services/market/custom-authorize/${TIKTOK_APP_ID}?shop_region=MX`;
}

export async function intercambiarCodigoTikTok(code: string): Promise<TokensTikTok> {
  const url = new URL(`${AUTH_BASE}/api/v2/token/get`);
  url.searchParams.set("app_key", process.env.TIKTOK_APP_KEY ?? "");
  url.searchParams.set("app_secret", process.env.TIKTOK_APP_SECRET ?? "");
  url.searchParams.set("auth_code", code);
  url.searchParams.set("grant_type", "authorized_code");

  const res = await fetch(url, { headers: { "Content-Type": "application/json" }, cache: "no-store" });
  const json = (await res.json().catch(() => null)) as
    | { code?: number; message?: string; data?: TokensTikTok }
    | null;
  if (!res.ok || json?.code !== 0 || !json.data?.access_token || !json.data.refresh_token) {
    throw new Error(`TikTok Shop rechazó el código: ${json?.message ?? `HTTP ${res.status}`}`);
  }
  return json.data;
}

/* --------------------------- Requests firmadas --------------------------- */

type RespuestaTT<T> = { code: number; message: string; data?: T };

/* Petición firmada a la Open API. Añade app_key, timestamp, sign (query) y el
   access token en header. `shop_cipher` se incluye cuando la conexión ya lo
   tiene (todas las llamadas de negocio lo requieren; getAuthorizedShops no). */
async function ttFetch<T>(
  cx: ConexionTikTok,
  method: "GET" | "POST" | "PUT",
  path: string,
  opts?: { query?: Record<string, string>; body?: unknown; sinCipher?: boolean },
): Promise<T> {
  const query: Record<string, string> = {
    app_key: process.env.TIKTOK_APP_KEY ?? "",
    timestamp: String(Math.floor(Date.now() / 1000)),
    ...(opts?.sinCipher ? {} : cx.shopCipher ? { shop_cipher: cx.shopCipher } : {}),
    ...(opts?.query ?? {}),
  };
  const bodyStr = opts?.body != null ? JSON.stringify(opts.body) : "";
  query.sign = firmar(path, query, bodyStr || null);

  const res = await fetch(`${API_BASE}${path}?${new URLSearchParams(query)}`, {
    method,
    headers: { "x-tts-access-token": cx.accessToken, "Content-Type": "application/json" },
    body: bodyStr || undefined,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as RespuestaTT<T> | null;
  if (!json || json.code !== 0) {
    throw new Error(`TikTok Shop ${path} respondió code ${json?.code}: ${json?.message ?? res.status}`);
  }
  return json.data as T;
}

/* ------------------------- Shops (shop_cipher) --------------------------- */

export type ShopTikTok = { id: string; name?: string; cipher: string; region?: string };

/* Tiendas autorizadas del vendedor. Da el `shop_cipher` que necesita todo lo
   demás. Se llama con una conexión sin cipher todavía (sinCipher: true). */
export async function obtenerShopsTikTok(accessToken: string): Promise<ShopTikTok[]> {
  const cx: ConexionTikTok = { accessToken, shopCipher: "", shopId: "", warehouseId: null };
  const data = await ttFetch<{ shops?: ShopTikTok[] }>(cx, "GET", "/authorization/202309/shops", {
    sinCipher: true,
  });
  return data.shops ?? [];
}

/* ------------------------------ Warehouses ------------------------------- */

export type WarehouseTikTok = { id: string; name?: string; type?: string; sub_type?: string };

/* Almacenes del vendedor. Necesario para actualizar stock (el inventario en
   TikTok es por almacén). El principal se guarda en integraciones.datos. */
export async function listarWarehousesTikTok(cx: ConexionTikTok): Promise<WarehouseTikTok[]> {
  const data = await ttFetch<{ warehouses?: WarehouseTikTok[] }>(cx, "GET", "/logistics/202309/warehouses");
  return data.warehouses ?? [];
}

/* ------------------------------ Productos -------------------------------- */

/* Imagen de TikTok. La API v202309 devuelve las URLs grandes en `urls` y las
   miniaturas en `thumb_urls` (NO `url_list`/`thumb_url_list`, que eran de una
   versión vieja; se dejan como respaldo). `uri` es el id interno. */
export type ImagenTikTok = {
  uri?: string | null;
  urls?: string[] | null;
  thumb_urls?: string[] | null;
  url_list?: string[] | null;
  thumb_url_list?: string[] | null;
};

export type SkuTikTok = {
  id: string;
  seller_sku?: string | null;
  price?: { sale_price?: string; tax_exclusive_price?: string; currency?: string } | null;
  inventory?: { quantity: number; warehouse_id: string }[] | null;
  sales_attributes?: { name?: string; value_name?: string; sku_img?: ImagenTikTok | null }[] | null;
  /* Foto propia de la variante (si la publicación la trae). */
  sku_img?: ImagenTikTok | null;
};

export type ProductoTikTok = {
  id: string;
  title?: string;
  status?: string; // ACTIVATE | DEACTIVATED | DELETED | ...
  /* Galería principal de la publicación (la comparten todos sus SKUs). */
  main_images?: ImagenTikTok[] | null;
  skus?: SkuTikTok[] | null;
};

/* Catálogo completo del vendedor. El search 202309 ya devuelve los SKUs con su
   inventario y precio, así que no hace falta pedir el detalle uno por uno. */
export async function listarProductosTikTok(cx: ConexionTikTok): Promise<ProductoTikTok[]> {
  const todos: ProductoTikTok[] = [];
  let pageToken = "";
  for (;;) {
    const query: Record<string, string> = { page_size: "100" };
    if (pageToken) query.page_token = pageToken;
    const data = await ttFetch<{ products?: ProductoTikTok[]; next_page_token?: string }>(
      cx,
      "POST",
      "/product/202309/products/search",
      { query, body: { status: "ALL" } },
    );
    todos.push(...(data.products ?? []));
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return todos;
}

/* Detalle completo de un producto (incluye `main_images`, que el search NO
   devuelve). null = ya no existe. Lo usa la sync para traer las imágenes. */
export async function obtenerProductoTikTok(
  cx: ConexionTikTok,
  productId: string,
): Promise<ProductoTikTok | null> {
  try {
    return await ttFetch<ProductoTikTok>(cx, "GET", `/product/202309/products/${productId}`);
  } catch {
    return null;
  }
}

/* Stock actual de un SKU en TikTok (suma de sus almacenes). undefined = el
   producto/SKU ya no existe. Lo usa el hub para leer antes de escribir. */
export async function stockActualTikTok(
  cx: ConexionTikTok,
  productId: string,
  skuId: string,
): Promise<number | undefined> {
  const p = await ttFetch<ProductoTikTok>(cx, "GET", `/product/202309/products/${productId}`);
  const sku = p.skus?.find((s) => s.id === skuId);
  if (!sku) return undefined;
  return Math.max(0, (sku.inventory ?? []).reduce((a, i) => a + (i.quantity ?? 0), 0));
}

/* Actualiza el stock de un SKU en el almacén principal (el inventario en TikTok
   es por almacén: hay que decir a cuál va la cantidad). */
export async function actualizarStockTikTok(
  cx: ConexionTikTok,
  productId: string,
  skuId: string,
  cantidad: number,
): Promise<void> {
  if (!cx.warehouseId) throw new Error("TikTok Shop sin almacén configurado; reconecta la cuenta.");
  await ttFetch(cx, "POST", `/product/202309/products/${productId}/inventory/update`, {
    body: { skus: [{ id: skuId, inventory: [{ warehouse_id: cx.warehouseId, quantity: cantidad }] }] },
  });
}

/* ------------------------------ Órdenes ---------------------------------- */

export type LineItemTikTok = {
  id: string; // único por renglón de la orden
  product_id?: string;
  sku_id?: string;
  seller_sku?: string | null;
  product_name?: string;
  sale_price?: string; // precio unitario (cada line_item es una unidad)
  currency?: string;
};

export type OrdenTikTok = {
  id: string;
  // UNPAID | ON_HOLD | AWAITING_SHIPMENT | AWAITING_COLLECTION | IN_TRANSIT |
  // DELIVERED | COMPLETED | CANCELLED
  status: string;
  create_time?: number; // unix segundos
  buyer_email?: string | null; // enmascarado (@scs.tiktok.com)
  payment?: { total_amount?: string; sub_total?: string; currency?: string } | null;
  line_items?: LineItemTikTok[] | null;
  tracking_number?: string | null;
};

/* Órdenes del vendedor desde una fecha (unix seg), paginadas por page_token.
   Incluye canceladas: el importador las usa para retirar ventas canceladas. */
export async function listarOrdenesTikTok(cx: ConexionTikTok, desdeUnix: number): Promise<OrdenTikTok[]> {
  const todas: OrdenTikTok[] = [];
  let pageToken = "";
  for (;;) {
    const query: Record<string, string> = {
      page_size: "50",
      sort_field: "create_time",
      sort_order: "DESC",
    };
    if (pageToken) query.page_token = pageToken;
    const data = await ttFetch<{ orders?: OrdenTikTok[]; next_page_token?: string }>(
      cx,
      "POST",
      "/order/202309/orders/search",
      { query, body: { create_time_ge: desdeUnix } },
    );
    todas.push(...(data.orders ?? []));
    if (!data.next_page_token) break;
    pageToken = data.next_page_token;
  }
  return todas;
}

/* Una orden por id (la avisa el webhook). */
export async function obtenerOrdenTikTok(cx: ConexionTikTok, orderId: string): Promise<OrdenTikTok | null> {
  const data = await ttFetch<{ orders?: OrdenTikTok[] }>(cx, "GET", "/order/202309/orders", {
    query: { ids: orderId },
  });
  return data.orders?.[0] ?? null;
}

export { ttFetch };
