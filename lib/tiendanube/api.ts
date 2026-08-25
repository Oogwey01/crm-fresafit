/* ============================================================================
   lib/tiendanube/api.ts — Cliente mínimo de la API de Tienda Nube (2025-03)
   ----------------------------------------------------------------------------
   Solo servidor: usa el service role para leer/guardar el access token en la
   tabla `integraciones`. El token no expira mientras la app siga instalada.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { estadoIntegracion } from "@/lib/canales/integraciones";
import { ESCRITURA_CANALES } from "@/lib/inventario/escritura-canales";

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
  image_id?: number | null; // imagen propia de la variante (puede faltar)
};

/* Foto de un producto. `src` es la URL pública del CDN de Tienda Nube y
   `position` (1 = portada) define el orden de la galería. */
export type ImagenTN = {
  id: number;
  src: string;
  position: number;
};

/* Categoría tal como viaja EMBEBIDA en el producto: id, nombre i18n y padre.
   Con eso alcanza para espejear el árbol sin otra llamada a /categories. */
export type CategoriaTN = {
  id: number;
  name: Record<string, string>;
  parent?: number | null;
};

export type ProductoTN = {
  id: number;
  name: Record<string, string>;
  published: boolean;
  variants: VarianteTN[];
  images?: ImagenTN[];
  /* Las categorías del producto (con sus padres asignados por la tienda). */
  categories?: CategoriaTN[];
  /* URL pública del producto en la tienda (dominio real + slug). Es la única
     forma de enlazar la vista de comprador: el slug no se puede armar desde el
     id. */
  canonical_url?: string | null;
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
  return estadoIntegracion("tiendanube");
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

/* La etiqueta PDF de una orden, si Tienda Nube la entrega por API. Los
   fulfillment orders traen los documentos de la etiqueta con URL firmada
   (necesita el scope read_fulfillment_orders). Null cuando la orden no tiene
   etiqueta generada, el token no alcanza, o el recurso no aplica: quien llama
   decide el plan B (mandar al admin). La forma de `labels` se maneja como
   objeto o lista porque la doc no fija una sola. */
export async function urlEtiquetaTN(cx: ConexionTN, ordenId: number): Promise<string | null> {
  try {
    const res = await tnFetch(cx, `/orders/${ordenId}/fulfillment-orders`);
    if (!res.ok) return null;
    type Doc = { url?: string | null; type?: string | null };
    type Labels = { documents?: Doc[] | null };
    const lista = (await res.json()) as { labels?: Labels | Labels[] | null }[] | null;
    for (const fo of Array.isArray(lista) ? lista : []) {
      const labels = Array.isArray(fo?.labels) ? fo.labels : fo?.labels ? [fo.labels] : [];
      for (const l of labels) {
        for (const d of l?.documents ?? []) {
          if (d?.url?.trim()) return d.url.trim();
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/* Historial de rastreo de una orden, tal como lo publica Tienda Nube.

   Es el PLAN B del rastreo: la fuente principal es el buscador de envia.com
   (lib/envia/rastreo.ts), que cubre más y en un solo viaje por cada diez guías,
   mientras que esto es una petición por orden. Pero aquélla usa un endpoint no
   documentado que puede cerrarse cualquier día, y ésta es la API oficial con el
   permiso que la app ya tiene. Cuando la principal falla, ésta contesta.

   OJO con el `status` del fulfillment (UNPACKED/PACKED/DISPATCHED/DELIVERED): en
   esta tienda se queda en DISPATCHED PARA SIEMPRE —comprobado sobre 76 órdenes,
   incluidas 24 que sus propios eventos dan por entregadas—, que es justamente por
   qué el panel de Tienda Nube sigue ofreciendo "Marcar como entregado". El dato
   bueno son los `tracking_events`, y de ellos el último. */
export type EventoEnvioTN = { status: string; descripcion: string | null; cuando: string | null };

export async function ultimoEventoEnvioTN(
  cx: ConexionTN,
  ordenId: number,
): Promise<EventoEnvioTN | null> {
  const res = await tnFetch(cx, `/orders/${ordenId}/fulfillment-orders`);
  if (!res.ok) throw new Error(`Tienda Nube respondió ${res.status} al pedir el rastreo.`);
  type Evento = { status?: string | null; description?: string | null; happened_at?: string | null };
  const lista = (await res.json()) as { tracking_events?: Evento[] | null }[] | null;

  /* Una orden puede partirse en varios paquetes: se juntan los eventos de todos
     y manda el más reciente por fecha, no por orden de aparición. */
  const eventos = (Array.isArray(lista) ? lista : [])
    .flatMap((fo) => (Array.isArray(fo?.tracking_events) ? fo.tracking_events : []))
    .filter((e): e is Evento & { status: string } => !!e?.status);
  if (eventos.length === 0) return null;

  eventos.sort((a, b) => (a.happened_at ?? "").localeCompare(b.happened_at ?? ""));
  const ultimo = eventos[eventos.length - 1];
  return {
    status: ultimo.status,
    descripcion: ultimo.description?.trim() || null,
    cuando: ultimo.happened_at ?? null,
  };
}

/* Dominio del panel de la tienda ("fresafit2.mitiendanube.com"). El admin de
   Tienda Nube vive en el subdominio de cada tienda, así que sin este dato no se
   puede armar el enlace "ver la orden en Tienda Nube". Se consulta una vez por
   sync y se guarda en `integraciones.datos`. */
export async function dominioAdminTN(cx: ConexionTN): Promise<string | null> {
  const res = await tnFetch(cx, "/store");
  if (!res.ok) return null;
  const store = (await res.json()) as { original_domain?: string | null };
  return store.original_domain?.trim() || null;
}

/* ------------------------------ Productos -------------------------------- */

export async function obtenerProductoTN(cx: ConexionTN, id: number): Promise<ProductoTN | null> {
  const res = await tnFetch(cx, `/products/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Tienda Nube respondió ${res.status} al pedir el producto ${id}.`);
  return (await res.json()) as ProductoTN;
}

/* Stock que tiene AHORA MISMO una variante en la tienda.

   Lo pide el hub justo antes de escribir: mandar el número que el CRM leyó hace
   rato es lo que borró 27 unidades el 18/07. Con el valor fresco se aplica el
   MOVIMIENTO (−1) sobre lo que realmente hay, en vez de imponer un resultado.

   `null` = la variante existe pero no lleva control de stock (combos, bundles y
   personalizados); `undefined` = ya no está en el catálogo. Son cosas distintas
   y el llamador debe tratarlas distinto. */
export async function stockVarianteTN(
  cx: ConexionTN,
  productId: number,
  variantId: number,
): Promise<number | null | undefined> {
  const res = await tnFetch(cx, `/products/${productId}/variants/${variantId}`);
  if (res.status === 404) return undefined;
  if (!res.ok) {
    throw new Error(`Tienda Nube respondió ${res.status} al pedir la variante ${variantId}.`);
  }
  const v = (await res.json()) as { stock?: number | null };
  return typeof v.stock === "number" ? Math.max(0, v.stock) : null;
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
   Solo los campos presentes en `cambios` se tocan.

   CANDADO: con SYNC_ESCRITURA_CANALES apagado (el default) esto es un no-op —
   el CRM no modifica el catálogo de la tienda. Es la única función que escribe
   en Tienda Nube, así que el candado cubre toda ruta presente y futura. */
export async function actualizarVarianteTN(
  cx: ConexionTN,
  productId: number,
  variantId: number,
  cambios: { stock?: number; price?: number; cost?: number },
): Promise<void> {
  if (!ESCRITURA_CANALES) {
    console.warn("[solo-lectura] escritura a Tienda Nube omitida", { productId, variantId, cambios });
    return;
  }
  const res = await tnFetch(cx, `/products/${productId}/variants/${variantId}`, {
    method: "PUT",
    body: JSON.stringify(cambios),
  });
  if (!res.ok) {
    throw new Error(`Tienda Nube respondió ${res.status} al actualizar la variante ${variantId}.`);
  }
}

/* ------------------------------ Órdenes ----------------------------------- */

/* Renglón de una orden (un producto vendido). `price` es el precio unitario.

   OJO con `variant_id`: la API lo devuelve NÚMERO en el listado de órdenes y
   TEXTO en el detalle (`/orders/{id}`). El mismo campo, dos tipos, sin que la
   documentación lo mencione. Aquí se declara `number` porque `normalizarOrden`
   lo garantiza a la salida de este módulo; no confiar en el JSON crudo. */
export type LineaOrdenTN = {
  product_id: number;
  variant_id: number;
  name: string;
  price: string;
  quantity: number | string;
  sku?: string | null;
};

/* Id numérico, o null si el valor no lo es. Null y cadena vacía se descartan
   ANTES de `Number`, que los convertiría en 0 — un id inventado que cruzaría
   con el producto equivocado. */
function aIdNumerico(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* Deja los ids de los renglones en número, venga la orden del listado o del
   detalle.

   Es la corrección de un fallo silencioso y caro: el webhook lee el DETALLE, y
   sus `variant_id` de texto no encontraban nada en los mapas del CRM, que se
   arman con las llaves numéricas de la base (`mapaVariantes` en
   lib/tiendanube/ventas.ts, `fichasPorVarianteTN` en lib/maquila/ingesta.ts).
   Resultado: toda venta avisada por webhook entraba SIN `producto_id` y sin
   pedido de maquila — el 85% de las ventas de Tienda Nube de agosto de 2026—,
   mientras las mismas órdenes releídas por el cron (que usa el listado, con
   números) sí cruzaban. Por eso el síntoma era intermitente y por orden entera.
   El tipo declaraba `number`, así que el compilador no podía avisar.

   Se normaliza en la FRONTERA para que nadie río abajo tenga que acordarse.
   `referencia_externa` no cambia de forma —"2053141788:1508700595" se escribe
   igual con el texto que con el número—, así que esto no duplica renglones ni
   rompe la idempotencia de lo ya importado. */
function normalizarOrden(o: OrdenTN): OrdenTN {
  if (!Array.isArray(o?.products)) return o;
  return {
    ...o,
    products: o.products.map((l) => ({
      ...l,
      variant_id: aIdNumerico(l.variant_id) ?? l.variant_id,
      product_id: aIdNumerico(l.product_id) ?? l.product_id,
    })),
  };
}

export type OrdenTN = {
  id: number;
  number: number;
  status: string; // open | closed | cancelled
  payment_status: string; // pending | paid | voided | refunded | …
  created_at: string;
  paid_at?: string | null;
  /* Totales de la orden. El panel de Tienda Nube reporta `total` (con envío y
     descuentos); `sales.monto` solo suma producto, de ahí que los números no
     cuadraran. Se guardan en `sale_orders`. */
  total: string;
  subtotal?: string | null;
  shipping_cost_customer?: string | null;
  discount?: string | null;
  promotional_discount?: string | null;
  currency?: string | null;
  /* Cómo se pagó. `gateway_name` es la pasarela ("Pago Nube", "Mercado Pago") y
     `payment_details` el medio concreto con sus mensualidades. */
  gateway_name?: string | null;
  payment_details?: {
    method?: string | null; // credit_card | cash | bank_transfer …
    credit_card_company?: string | null;
    installments?: number | string | null;
  } | null;
  /* Cupones aplicados. Es un arreglo aunque casi siempre trae uno solo. */
  coupon?: { code?: string | null }[] | null;
  products: LineaOrdenTN[];
  /* OJO: Tienda Nube NO envía `customer` en las órdenes (ni en el listado ni en
     /orders/{id}); los datos del comprador vienen en estos campos planos. */
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  /* Estado de preparación/envío: unpacked | unshipped | shipped | delivered. */
  shipping_status?: string | null;
  /* OJO: en la API 2025-03 estos dos campos ya NO se rellenan —solo existían en
     v1— y el rastreo vive en `fulfillments`. Leerlos era la razón de que ningún
     pedido de Tienda Nube mostrara guía en el CRM. Se dejan declarados porque la
     API los sigue devolviendo (siempre en null) y para no romper si vuelven. */
  shipping_tracking_number?: string | null;
  shipping_carrier_name?: string | null;
  /* Nombre comercial del envío elegido en la tienda ("Envío Nube - Estafeta
     Terrestre"): es lo más cercano a la paquetería cuando el fulfillment solo
     dice "Envío estándar". */
  shipping_option?: string | null;
  /* Envíos de la orden (2025-03). Una orden puede partirse en varios paquetes;
     el CRM se queda con el primero que traiga guía. */
  fulfillments?: {
    id?: string | null;
    number?: string | null;
    status?: string | null; // PENDING | DISPATCHED | DELIVERED …
    shipping?: {
      carrier?: { name?: string | null } | null;
      option?: { name?: string | null } | null;
    } | null;
    tracking_info?: { code?: string | null; url?: string | null } | null;
  }[] | null;
  /* Dirección de envío. La API sí la manda; el CRM no la guardaba, así que para
     empacar había que entrar al panel de la tienda. */
  shipping_address?: {
    name?: string | null;
    phone?: string | null;
    address?: string | null; // calle
    number?: string | null;
    floor?: string | null; // interior / referencias
    locality?: string | null; // colonia
    city?: string | null;
    province?: string | null; // estado
    zipcode?: string | null;
    country?: string | null;
  } | null;
};

export async function obtenerOrdenTN(cx: ConexionTN, id: number): Promise<OrdenTN | null> {
  const res = await tnFetch(cx, `/orders/${id}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Tienda Nube respondió ${res.status} al pedir la orden ${id}.`);
  return normalizarOrden((await res.json()) as OrdenTN);
}

/* Órdenes ACTUALIZADAS desde una fecha (ISO), paginadas. Incluye canceladas: el
   importador las usa para retirar ventas que se cancelaron después de importarse.

   Va por `updated_at_min` y no por `created_at_min`, que es lo que usaba antes.
   Con la fecha de creación, una orden hecha hace veinte días y entregada hoy no
   volvía a leerse NUNCA: la ventana incremental son siete días. De ahí que los
   pedidos se quedaran en "enviado" para siempre y acabaran contados como
   atrasados. Filtrando por actualización, cualquier cambio de la tienda —se
   empacó, salió, llegó, se devolvió— entra en la siguiente pasada.

   Lo que NACE sigue gobernado por la fecha de creación; ver `separarAltas` en
   lib/canales/ventas-cuadre.ts. */
export async function listarOrdenesTN(cx: ConexionTN, desdeISO: string): Promise<OrdenTN[]> {
  const POR_PAGINA = 200;
  const todas: OrdenTN[] = [];
  for (let page = 1; ; page++) {
    const res = await tnFetch(
      cx,
      `/orders?per_page=${POR_PAGINA}&page=${page}&updated_at_min=${encodeURIComponent(desdeISO)}`,
    );
    if (res.status === 404) break; // más allá de la última página
    if (!res.ok) throw new Error(`Tienda Nube respondió ${res.status} al listar órdenes.`);
    const lote = (await res.json()) as OrdenTN[];
    todas.push(...lote.map(normalizarOrden));
    if (lote.length < POR_PAGINA) break;
  }
  return todas;
}

/* ------------------------------ Webhooks --------------------------------- */

/* Eventos de ORDEN que el CRM escucha. Todos acaban en `procesarOrdenTN`, que
   relee la orden completa, así que añadir uno no cuesta lógica nueva.

   `order/created` existe por la maquila: las órdenes SIN pagar tienen que
   aparecer en la bandeja "Esperando pago" en cuanto nacen. A `sales` siguen sin
   entrar (el importador filtra por pago).

   Los cuatro del ENVÍO son los que faltaban, y son la razón de que un pedido
   despachado se quedara en "enviado" para siempre: nada avisaba de que se empacó,
   salió o llegó. `fulfillment_order/status_updated` es el que trae el DELIVERED
   de Envío Nube. Se re-registran solos en el cron de las 6:00. */
export const EVENTOS_ORDEN_TN = [
  "order/created",
  "order/paid",
  "order/cancelled",
  "order/packed",
  "order/fulfilled",
  "order/updated",
  "fulfillment_order/status_updated",
] as const;

const EVENTOS_WEBHOOK = [
  "product/created",
  "product/updated",
  "product/deleted",
  ...EVENTOS_ORDEN_TN,
] as const;

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
