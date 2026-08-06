/* ============================================================================
   lib/tiktok/sync.ts — Sincronización TikTok Shop → tabla `products`
   ----------------------------------------------------------------------------
   Cada SKU de TikTok es un renglón de `products`, mapeado por
   (tiktok_product_id, tiktok_sku_id). Matching al importar (igual que ML):
     1. SKU ya vinculado → esa fila.
     2. SKU ya anotado en `tiktok_publicaciones` → su ficha ya tiene dueño; es una
        publicación secundaria y no hay nada que crear.
     3. Sin vincular y con seller_sku → si EXACTAMENTE una fila del CRM tiene ese
        sku, sigue sin vínculo TikTok Y NO vive en Tienda Nube/Mercado Libre
        (ficha huérfana, sin canal), se vincula esa misma fila.
     4. Con seller_sku pero la única fila que ya lleva ese SKU y tiene vínculo
        de TikTok tiene otra publicación (no la de este renglón) → si la
        entrante y esa publicación anterior NO están las DOS activas ahora
        mismo en TikTok (desactivada o de plano borrada; el fetch pide status
        "ALL", así que las desactivadas también aparecen), es una
        republicación real: se anota como publicación SECUNDARIA de esa ficha
        (antes se creaba una ficha nueva, y de ahí salieron 32 renglones
        fantasma con 328 unidades inventadas el 02/08/2026; una versión más
        simple de este chequeo, que solo miraba si la publicación anterior
        "existía" sin mirar si estaba activa, volvió a crear fichas fantasma
        para ese mismo caso —el propio "Gamuza Lavanda" (SBD043)— el
        03/08/2026). Si las DOS están activas a la vez, son probablemente dos
        artículos distintos con el SKU repetido por error en TikTok → fila
        nueva (igual que el caso 5).
     5. Sin seller_sku, con el sku repartido en varias fichas, o cuyo ÚNICO
        dueño del sku es una ficha de bodega (Tienda Nube/Mercado Libre) sin
        vínculo de TikTok → fila nueva. TikTok NUNCA adopta una ficha de
        bodega así comparta SKU: para este negocio el inventario de TikTok es
        un almacén aparte, no el mismo conteo (confirmado con datos reales:
        SBD019 "Rick and Morty" tenía 73/72/0/0 en TikTok Seller Center contra
        53/54/0/0 en la bodega — números genuinamente distintos, no el mismo
        stock repetido). Por eso cada publicación de TikTok tiene su PROPIA
        ficha, con su PROPIO stock, aunque el mismo diseño también se venda en
        Tienda Nube/Mercado Libre bajo otra ficha con el mismo SKU.

   Requiere la tabla `tiktok_publicaciones`
   (supabase/migrations/20260805000000_tiktok_publicaciones.sql): aplicar esa
   migración ANTES de desplegar este código.
   El stock de TikTok es por almacén; se suma el inventario de todos los
   almacenes del SKU. El almacén principal (para escribir stock) se guarda en
   integraciones.datos al conectar. Solo servidor (service role).

   `tiktok_stock` (supabase/migrations/20260808000100_tiktok_stock.sql) es un
   respaldo defensivo para el caso raro de que una ficha de bodega termine con
   vínculo de TikTok de todos modos (dato viejo, edición a mano): si pasa,
   `stock` lo sigue gobernando bodega y el número de TikTok se guarda aparte
   ahí, en vez de perderse. El camino normal, desde esta versión, es que cada
   publicación de TikTok tenga su propia ficha (caso 5) y ese campo se quede
   en null.
   ============================================================================ */

import { createAdminClient } from "@/lib/supabase/admin";
import { traerTodo } from "@/lib/canales/paginacion";
import { aplicarCambiosProductos } from "@/lib/inventario/escribir-productos";
import { mezclarDatosIntegracion } from "@/lib/canales/integraciones";
import {
  conexionTiktok,
  listarProductosTikTok,
  obtenerProductoTikTok,
  obtenerProductoTikTokEstricto,
  type ConexionTikTok,
  type ImagenTikTok,
  type ProductoTikTok,
  type SkuTikTok,
} from "@/lib/tiktok/api";
import { tipoDesdeProducto } from "@/lib/inventario/tipo-producto";
import { registrarStockLog, type EntradaStockLog } from "@/lib/inventario/stock-log";
import { colorDeVariante } from "@/lib/talla";

export type ResumenSyncTikTok = {
  productos: number;
  creados: number;
  actualizados: number;
  vinculados: number;
  desactivados: number;
  /* Fichas de TikTok a las que se les copió la foto de un producto de Tienda
     Nube con nombre parecido (TikTok no siempre trae imágenes). */
  fotos_pobladas: number;
};

type UnidadTikTok = {
  productId: string;
  skuId: string;
  sku: string | null;
  nombre: string;
  variante: string | null;
  precio: number | null;
  stock: number;
  activo: boolean;
  /* Galería de la unidad (foto de la variante primero, si la trae). */
  imagenes: string[];
};

type FilaProducto = {
  id: string;
  stock: number;
  sku: string | null;
  tiktok_product_id: string | null;
  tiktok_sku_id: string | null;
  tiktok_stock: number | null;
  /* Para no pisar las fotos buenas de TN/ML con las de TikTok en fichas unificadas. */
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
};

const CAMPOS_FILA =
  "id, stock, sku, tiktok_product_id, tiktok_sku_id, tiktok_stock, tiendanube_variant_id, meli_item_id";

/* URL utilizable de una imagen de TikTok: primero las grandes (`urls`), luego
   las miniaturas; se dejan `url_list`/`thumb_url_list` como respaldo de la API
   vieja. La primera no vacía. */
function urlImagen(img: ImagenTikTok | null | undefined): string | null {
  const listas = [img?.urls, img?.url_list, img?.thumb_urls, img?.thumb_url_list];
  for (const lista of listas) {
    const u = lista?.find((x) => !!x?.trim());
    if (u) return u;
  }
  return null;
}

/* Foto propia de la variante por COLOR: en v202309 no viene en `sku.sku_img`
   (suele estar vacío) sino dentro del atributo de venta "Color"
   (`sales_attributes[].sku_img`). Se toma la primera que traiga imagen. */
function imagenColorDe(sku: SkuTikTok): ImagenTikTok | null {
  for (const a of sku.sales_attributes ?? []) if (a.sku_img) return a.sku_img;
  return null;
}

/* Galería de una unidad: la foto del COLOR de la variante al frente, luego la
   galería principal del producto, sin repetidas ni vacías. */
function galeriaDe(p: ProductoTikTok, sku: SkuTikTok): string[] {
  const colorImg = urlImagen(sku.sku_img) ?? urlImagen(imagenColorDe(sku));
  const urls = [colorImg, ...(p.main_images ?? []).map(urlImagen)].filter(
    (u): u is string => !!u,
  );
  return [...new Set(urls)];
}

/* Columnas de imagen para el upsert; se omiten si la unidad no trae fotos, para
   no borrar la que ya tenga la ficha. */
function fotos(u: UnidadTikTok): Record<string, unknown> {
  if (u.imagenes.length === 0) return {};
  return { imagen_url: u.imagenes[0], imagenes: u.imagenes };
}

/* El `products/search` de TikTok NO devuelve imágenes ni atributos de venta
   (color/talla): solo vienen en el DETALLE de cada producto. Se traen con una
   llamada por producto (concurrencia limitada) y se inyectan en `main_images` y
   en los `sales_attributes` (con su `sku_img` por color) de cada SKU del catálogo
   en memoria. Sin esto, `variante` queda vacía y las fotos no se guardan. */
async function enriquecerImagenes(cx: ConexionTikTok, productos: ProductoTikTok[]): Promise<void> {
  const CONCURRENCIA = 8;
  for (let i = 0; i < productos.length; i += CONCURRENCIA) {
    await Promise.all(
      productos.slice(i, i + CONCURRENCIA).map(async (p) => {
        const detalle = await obtenerProductoTikTok(cx, p.id);
        if (!detalle) return;
        if (detalle.main_images?.length) p.main_images = detalle.main_images;
        const detPorSku = new Map((detalle.skus ?? []).map((s) => [s.id, s]));
        for (const s of p.skus ?? []) {
          const det = detPorSku.get(s.id);
          if (!det) continue;
          if (det.sales_attributes?.length) s.sales_attributes = det.sales_attributes;
          if (det.sku_img) s.sku_img = det.sku_img;
        }
      }),
    );
  }
}

/* ---- Poblado de imágenes desde el catálogo de Tienda Nube (por nombre) ------
   TikTok no siempre trae fotos. Como los productos de Tienda Nube (que sí tienen
   foto) se llaman casi igual, se copia la imagen del más parecido por nombre. */

function normalizarNombre(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita acentos
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/* Copia la foto de un producto de Tienda Nube (mismo nombre) a las fichas de
   TikTok que se quedaron sin imagen propia. Red de seguridad: TikTok ya trae su
   foto por color; esto solo cubre las contadas fichas sin ninguna. Idempotente.
   Devuelve cuántas se poblaron. */
type FuenteTN = { nombre: string; variante: string | null; imagen_url: string; imagenes: string[] | null };

/* Un producto de TN agrupado: sus variantes comparten nombre, y cada COLOR tiene
   su foto (imagen_url por variante). */
type GrupoFuente = {
  porColor: Map<string, string>; // color normalizado → imagen_url
  distintas: Set<string>; // imágenes distintas del grupo
};

async function poblarImagenesTikTokDesdeCatalogo(): Promise<number> {
  const admin = createAdminClient();

  // Fuente: variantes de Tienda Nube con foto (imagen_url es la foto por color).
  // Paginado con traerTodo: sin él, PostgREST corta en ~1000 filas sin avisar.
  const fuentes = await traerTodo<FuenteTN>((desde, hasta) =>
    admin
      .from("products")
      .select("nombre, variante, imagen_url, imagenes")
      .not("tiendanube_variant_id", "is", null)
      .not("imagen_url", "is", null)
      .range(desde, hasta),
  );
  if (fuentes.length === 0) return 0;

  // URLs que provienen de TN: sirven para saber qué fotos de TikTok pusimos
  // nosotros (y por tanto se pueden corregir) vs. las reales de TikTok.
  const urlsTN = new Set(fuentes.map((f) => f.imagen_url));

  // Agrupar por nombre normalizado; dentro, indexar la foto por color.
  const grupos = new Map<string, GrupoFuente>();
  for (const f of fuentes) {
    const clave = normalizarNombre(f.nombre);
    let g = grupos.get(clave);
    if (!g) {
      g = { porColor: new Map(), distintas: new Set() };
      grupos.set(clave, g);
    }
    g.distintas.add(f.imagen_url);
    const color = colorDeVariante(f.variante);
    if (color && !g.porColor.has(color)) g.porColor.set(color, f.imagen_url);
  }

  // Objetivo: fichas SOLO-TikTok (sin foto o con foto que copiamos de TN).
  const objetivos = await traerTodo<{
    id: string;
    nombre: string;
    variante: string | null;
    imagen_url: string | null;
  }>((desde, hasta) =>
    admin
      .from("products")
      .select("id, nombre, variante, imagen_url")
      .not("tiktok_product_id", "is", null)
      .is("tiendanube_variant_id", null)
      .is("meli_item_id", null)
      .range(desde, hasta),
  );

  const cambios: { id: string; imagen_url: string }[] = [];
  for (const o of objetivos) {
    // Solo tocar filas sin foto o cuya foto la pusimos desde TN (no pisar TikTok real).
    if (o.imagen_url && !urlsTN.has(o.imagen_url)) continue;

    // Ubicar el grupo por nombre EXACTO normalizado (sin cruces difusos entre
    // productos distintos, que ponían fotos equivocadas).
    const grupo = grupos.get(normalizarNombre(o.nombre)) ?? null;
    if (!grupo) continue;

    let imagen: string | null = null;
    if (grupo.distintas.size === 1) {
      // Producto con una sola foto (sin variantes de color): se usa esa.
      imagen = [...grupo.distintas][0];
    } else {
      // Multicolor: la foto del color de esta variante.
      const color = colorDeVariante(o.variante);
      if (color) {
        imagen = grupo.porColor.get(color) ?? null;
        if (!imagen) {
          // Tolerancia: color que comparte alguna palabra ("Rosa" vs "Rosa Mexicano").
          const tks = new Set(color.split(" "));
          for (const [c, url] of grupo.porColor) {
            if (c.split(" ").some((t) => tks.has(t))) {
              imagen = url;
              break;
            }
          }
        }
      }
      // Si no se identifica el color, se deja como está (no forzar un repetido).
    }

    if (imagen && imagen !== o.imagen_url) cambios.push({ id: o.id, imagen_url: imagen });
  }

  /* Se quedan fila por fila (el helper lo decide solo): son cambios de una o dos
     columnas, sin `nombre` —NOT NULL— y por tanto imposibles de mandar por
     upsert. Tampoco haría falta: esto es una red de seguridad idempotente, así
     que en cuanto las fichas sin foto quedan cubiertas la lista viene vacía. */
  await aplicarCambiosProductos(
    admin,
    cambios.map(({ id, imagen_url }) => ({ id, fila: { imagen_url, imagenes: [imagen_url] } })),
  );
  return cambios.length;
}

/* ---- Publicaciones: 1 ficha del CRM → N publicaciones de TikTok ------------
   `products` guarda la principal (tiktok_product_id/sku_id) y
   `tiktok_publicaciones` guarda todas, incluidas las secundarias. */
type Publicacion = {
  tiktok_sku_id: string;
  tiktok_product_id: string;
  producto_id: string;
  principal: boolean;
};

async function registrarPublicaciones(filas: Publicacion[]): Promise<void> {
  if (filas.length === 0) return;
  const admin = createAdminClient();
  /* Una unidad de TikTok pertenece a una sola ficha; si ya estaba anotada, se
     actualiza (una publicación puede cambiar de dueño al fusionar fichas). */
  const unicas = [...new Map(filas.map((f) => [f.tiktok_sku_id, f])).values()];
  for (let i = 0; i < unicas.length; i += 200) {
    const { error } = await admin
      .from("tiktok_publicaciones")
      .upsert(unicas.slice(i, i + 200), { onConflict: "tiktok_sku_id" });
    if (error) throw new Error(error.message);
  }
}

function numero(v: string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function precioDe(sku: SkuTikTok): number | null {
  return numero(sku.price?.sale_price) ?? numero(sku.price?.tax_exclusive_price);
}

function stockDe(sku: SkuTikTok): number {
  return Math.max(0, (sku.inventory ?? []).reduce((a, i) => a + (i.quantity ?? 0), 0));
}

function varianteDe(sku: SkuTikTok): string | null {
  return (
    (sku.sales_attributes ?? [])
      .map((a) => a.value_name?.trim())
      .filter(Boolean)
      .join(" / ") || null
  );
}

function unidadesDe(p: ProductoTikTok): UnidadTikTok[] {
  const activo = p.status === "ACTIVATE";
  return (p.skus ?? []).map((s) => ({
    productId: p.id,
    skuId: s.id,
    sku: s.seller_sku?.trim() || null,
    nombre: p.title || `Producto ${p.id}`,
    variante: varianteDe(s),
    precio: precioDe(s),
    stock: stockDe(s),
    activo,
    imagenes: galeriaDe(p, s),
  }));
}

/* Upsert de un lote de productos de TikTok, con matching por SKU. */
export async function sincronizarProductosTikTok(
  productos: ProductoTikTok[],
): Promise<Omit<ResumenSyncTikTok, "productos" | "desactivados" | "fotos_pobladas">> {
  const admin = createAdminClient();
  const unidades = productos.flatMap(unidadesDe);
  const skuIds = [...new Set(unidades.map((u) => u.skuId))];
  // Unidad completa (con su `activo`) por sku_id, para el chequeo de la rama
  // ambigua más abajo. listarProductosTikTok pide status "ALL": trae activos
  // e inactivos, así que una publicación vieja desactivada (pero NO borrada)
  // sigue apareciendo aquí — no basta con mirar si el sku_id sigue existiendo,
  // hay que mirar si sigue ACTIVO. Confirmado con datos reales: el "Cinturón
  // de Powerlift Gamuza Lavanda" (SBD043, el mismo del incidente del
  // 02/08/2026) seguía devuelto por TikTok con status distinto de ACTIVATE, y
  // una versión anterior de este chequeo que solo miraba "existe" lo tomó
  // como publicación viva y le creó una ficha fantasma con su stock viejo.
  const unidadPorSkuId = new Map(unidades.map((u) => [u.skuId, u]));

  // 1) Filas ya vinculadas a estos SKUs (la publicación PRINCIPAL de la ficha).
  const vinculadas = new Map<string, FilaProducto>();
  for (let i = 0; i < skuIds.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select(CAMPOS_FILA)
      .in("tiktok_sku_id", skuIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaProducto[]) vinculadas.set(f.tiktok_sku_id!, f);
  }

  /* 1b) Publicaciones SECUNDARIAS ya registradas: el mismo artículo puede tener
     varias fichas en TikTok (una borrada y resubida, un borrador, otro título) y
     todas llevan el mismo seller_sku. Ya tienen dueño en el CRM, así que aquí no
     hay ficha que crear ni que actualizar: solo la principal manda. */
  const yaMapeadas = new Set<string>();
  for (let i = 0; i < skuIds.length; i += 100) {
    const { data, error } = await admin
      .from("tiktok_publicaciones")
      .select("tiktok_sku_id")
      .in("tiktok_sku_id", skuIds.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const p of (data ?? []) as { tiktok_sku_id: string }[]) yaMapeadas.add(p.tiktok_sku_id);
  }

  // 2) Candidatas por SKU para las unidades aún sin vínculo. Se traen TODAS las
  //    fichas con ese sku, vinculadas o no: las libres se pueden adoptar; las
  //    tomadas dicen que el artículo ya está en el CRM con otra publicación.
  const pendientes = unidades.filter((u) => !vinculadas.has(u.skuId) && !yaMapeadas.has(u.skuId));
  const skusBuscados = [...new Set(pendientes.filter((u) => u.sku).map((u) => u.sku as string))];
  const porSku = new Map<string, FilaProducto[]>();
  for (let i = 0; i < skusBuscados.length; i += 100) {
    const { data, error } = await admin
      .from("products")
      .select(CAMPOS_FILA)
      .in("sku", skusBuscados.slice(i, i + 100));
    if (error) throw new Error(error.message);
    for (const f of (data ?? []) as FilaProducto[]) porSku.set(f.sku!, [...(porSku.get(f.sku!) ?? []), f]);
  }

  const nuevos: Record<string, unknown>[] = [];
  const cambios: { id: string; fila: Record<string, unknown> }[] = [];
  /* Publicaciones a registrar: la principal de cada ficha y las secundarias que
     esta corrida descubrió. Es el mapa que usa la importación de ventas. */
  const publicaciones: Publicacion[] = [];
  const reclamadas = new Set<string>();
  // tiktok_sku_id que reclamó cada ficha EN ESTA MISMA corrida (rama
  // libres.length === 1, más abajo) — hace falta para el chequeo de "sigue
  // vivo" de la rama ambigua, cuando el sku_id dueño todavía no está guardado
  // en `products` porque se acaba de vincular en este mismo loop.
  const reclamadaPorSkuId = new Map<string, string>();
  /* Renglones para el historial de stock. Se escriben DESPUÉS de aplicar los
     cambios: si la escritura falla, el ledger no debe contar un movimiento que
     nunca ocurrió. Las fichas nuevas no entran (mismo criterio que Tienda Nube
     y Mercado Libre: un alta no es un movimiento, es el punto de partida). */
  const logs: EntradaStockLog[] = [];
  let vinculados = 0;

  for (const u of unidades) {
    const tiktokIds = { tiktok_product_id: u.productId, tiktok_sku_id: u.skuId };
    const existente = vinculadas.get(u.skuId);

    /* Publicación secundaria conocida: su ficha ya está resuelta. */
    if (!existente && yaMapeadas.has(u.skuId)) continue;

    if (existente) {
      publicaciones.push({ ...tiktokIds, producto_id: existente.id, principal: true });
      /* Un producto que también vive en Tienda Nube o Mercado Libre tiene ahí su
         dueño del catálogo Y del inventario: `stock`, nombre, fotos y estado los
         gobierna ese canal, no TikTok. Ya pasó una vez —la sync dejó MQR004 en
         stock 0 y desactivado, copiando los valores de su publicación de TikTok
         encima de los reales de TN/ML—.
         Pero el número que TikTok reporta para SU publicación es un dato real y
         distinto al de la bodega (mismo motivo que `meli_stock_full`): se guarda
         aparte en `tiktok_stock`, sin tocar `stock` ni nada más de la ficha. */
      const soloTikTok = existente.tiendanube_variant_id == null && existente.meli_item_id == null;
      if (!soloTikTok) {
        if (u.stock !== existente.tiktok_stock) {
          cambios.push({ id: existente.id, fila: { tiktok_stock: u.stock } });
          /* Canal `tiktok_shop` y no `crm`: lo que se movió es el inventario de
             LA PUBLICACIÓN de TikTok, no el de bodega —que esta rama tiene
             prohibido tocar—. Por eso también lleva origen propio: en el
             historial hay que poder distinguir «TikTok movió su almacén» de
             «el CRM igualó su stock al de un canal». */
          logs.push({
            producto_id: existente.id,
            canal: "tiktok_shop",
            origen: "tiktok_stock",
            stock_anterior: existente.tiktok_stock, // null la primera vez que se observa
            stock_nuevo: u.stock,
          });
        }
        continue;
      }

      /* Ficha que vive SOLO en TikTok: aquí TikTok sí es la única fuente de
         verdad, así que aporta todo (ficha, fotos, estado y su propio stock). */
      const fila: Record<string, unknown> = {
        nombre: u.nombre,
        variante: u.variante,
        precio: u.precio,
        sku: u.sku,
        activo: u.activo,
        ...fotos(u),
        ...(u.stock !== existente.stock ? { stock: u.stock } : {}),
      };
      cambios.push({ id: existente.id, fila });
      /* Aquí sí se escribió `products.stock`, así que el canal es `crm` y el
         origen el mismo que usan las otras syncs: el CRM igualó su número al
         del canal que manda esta ficha. */
      if (u.stock !== existente.stock) {
        logs.push({
          producto_id: existente.id,
          canal: "crm",
          origen: "tiktok_sync",
          stock_anterior: existente.stock,
          stock_nuevo: u.stock,
        });
      }
      continue;
    }

    const conEseSku = (u.sku && porSku.get(u.sku)) || [];

    /* Candidatas para vincular DIRECTO (misma ficha, sin crear otra): solo
       fichas huérfanas, sin ningún canal (creadas a mano en el CRM, o
       resultado de una fila nueva de una corrida anterior). Una ficha que
       YA vive en Tienda Nube o Mercado Libre queda fuera aunque su SKU
       coincida y no tenga vínculo de TikTok: para este negocio, el inventario
       de TikTok es un almacén aparte del de bodega —no el mismo conteo—, así
       que TikTok nunca debe adoptar/absorber una ficha de bodega. Siempre
       recibe su PROPIA ficha, con su propio stock (ver "fila nueva" abajo). */
    const libres = conEseSku.filter(
      (f) =>
        f.tiktok_sku_id == null &&
        !reclamadas.has(f.id) &&
        f.tiendanube_variant_id == null &&
        f.meli_item_id == null,
    );
    if (libres.length === 1) {
      // Match único por SKU → vincular (conserva el stock vigente del CRM).
      const fila = libres[0];
      reclamadas.add(fila.id);
      reclamadaPorSkuId.set(fila.id, u.skuId);
      cambios.push({ id: fila.id, fila: tiktokIds });
      publicaciones.push({ ...tiktokIds, producto_id: fila.id, principal: true });
      vinculados++;
      continue;
    }

    /* Candidatas ya tomadas por OTRA publicación de TikTok (sin importar si
       además viven en bodega): puede ser el mismo artículo publicado dos
       veces en TikTok (republicación real) O DOS ARTÍCULOS DISTINTOS que
       comparten seller_sku por error en TikTok — caso ya documentado y a
       propósito NO fusionado en la limpieza histórica
       (20260805000000_tiktok_publicaciones.sql, líneas 24-28: MQR017P, dos
       muñequeras distintas con el mismo SKU).
       Se distinguen exigiendo que TANTO la entrante (`u`) COMO la publicación
       que ya tiene la ficha estén ACTIVAS ahora mismo en TikTok (no solo que
       existan: status "ALL" también devuelve publicaciones desactivadas). Si
       las dos están activas a la vez → son probablemente dos artículos
       distintos, no se debe esconder (cae a "fila nueva", más abajo, igual
       que hace Mercado Libre ante un SKU ambiguo). Si cualquiera de las dos
       NO está activa —desactivada o de plano ya no existe— se trata como
       republicación real: se anota como publicación secundaria de la ficha que
       ya existe, sin duplicar inventario ni perder ventas. */
    const tomadas = conEseSku.filter((f) => f.tiktok_sku_id != null);
    if (libres.length === 0 && tomadas.length === 1) {
      const ficha = tomadas[0];
      const skuIdDueño = ficha.tiktok_sku_id ?? reclamadaPorSkuId.get(ficha.id) ?? null;
      const dueño = skuIdDueño != null ? unidadPorSkuId.get(skuIdDueño) : undefined;
      const dosActivasALaVez = u.activo && !!dueño?.activo;
      if (!dosActivasALaVez) {
        publicaciones.push({ ...tiktokIds, producto_id: ficha.id, principal: false });
        continue;
      }
      // Las dos publicaciones están activas a la vez → no ocultar: cae a "fila nueva".
    }

    /* Sin SKU, sin match, SKU ambiguo, dos publicaciones activas con el mismo
       SKU, o el único match es una ficha de bodega (TN/ML) sin vínculo de
       TikTok → fila nueva: TikTok siempre recibe su propia ficha delegada,
       con su propio stock, nunca se mete en la de bodega. */
    nuevos.push({
      nombre: u.nombre,
      variante: u.variante,
      tipo: tipoDesdeProducto({ nombre: u.nombre, sku: u.sku }),
      precio: u.precio,
      sku: u.sku,
      stock: u.stock,
      activo: u.activo,
      ...fotos(u),
      ...tiktokIds,
    });
  }

  if (nuevos.length > 0) {
    const { data, error } = await admin.from("products").insert(nuevos).select("id, tiktok_sku_id");
    if (error) throw new Error(error.message);
    const porSkuId = new Map(unidades.map((u) => [u.skuId, u]));
    for (const f of (data ?? []) as { id: string; tiktok_sku_id: string }[]) {
      const u = porSkuId.get(f.tiktok_sku_id);
      if (u) {
        publicaciones.push({
          tiktok_product_id: u.productId,
          tiktok_sku_id: f.tiktok_sku_id,
          producto_id: f.id,
          principal: true,
        });
      }
    }
  }
  /* En lote van las fichas que viven SOLO en TikTok, que son la mayoría del
     catálogo de este canal (es un catálogo aparte del de bodega): de esas TikTok
     es la única fuente de verdad y el cambio trae la ficha entera.

     Los otros dos casos siguen fila por fila —el helper los separa solo—: el
     `tiktok_stock` de una ficha que TAMBIÉN vive en Tienda Nube/Mercado Libre y
     los identificadores al vincular por SKU. Los dos son cambios de una o dos
     columnas, sin `nombre` (NOT NULL), así que el upsert los rechazaría; y
     rellenarlos con lo que ya hay en la base para poder agruparlos sería
     justamente lo que se prohibió después del incidente de MQR004: dejar que
     TikTok escriba encima de una ficha cuyo dueño es otro canal. */
  await aplicarCambiosProductos(admin, cambios);
  await registrarPublicaciones(publicaciones);
  /* Un solo lote por corrida, como en las otras syncs: la pantalla agrupa los N
     renglones de la misma pasada en un bloque en vez de pintarlos como N
     cambios sueltos a la misma hora. */
  await registrarStockLog(logs);

  return { creados: nuevos.length, actualizados: cambios.length - vinculados, vinculados };
}

/* Sync de un solo producto (lo dispara la notificación de TikTok). */
export async function sincronizarProductoTikTok(productId: string): Promise<void> {
  const cx = await conexionTiktok();
  if (!cx) return;
  /* El DETALLE trae exactamente ese producto, con `main_images` y los
     `sales_attributes` (sku_img por color) que el search no da: no hace falta
     paginar el catálogo completo ni pasar por enriquecerImagenes (que hace esta
     misma llamada por producto). Estricto: null SOLO si TikTok confirma que no
     existe — un error transitorio se propaga y NO desactiva fichas. */
  const p = await obtenerProductoTikTokEstricto(cx, productId);
  if (p) {
    await sincronizarProductosTikTok([p]);
    return;
  }
  // Producto eliminado en TikTok: baja lógica de sus renglones solo-TikTok.
  const admin = createAdminClient();
  const { error } = await admin
    .from("products")
    .update({ activo: false })
    .eq("tiktok_product_id", productId)
    .is("tiendanube_variant_id", null)
    .is("meli_item_id", null);
  if (error) throw new Error(error.message);
}

/* Pasa la publicación principal de cada ficha a una que siga viva, cuando la
   que tenía guardada ya no está en TikTok. `vivos` son los sku_id del catálogo
   recién traído, así que esto solo se puede hacer en la importación completa. */
async function repuntarPrincipales(vivos: Set<string>): Promise<number> {
  const admin = createAdminClient();

  const fichas = await traerTodo<{ id: string; tiktok_sku_id: string }>((desde, hasta) =>
    admin.from("products").select("id, tiktok_sku_id").not("tiktok_sku_id", "is", null).range(desde, hasta),
  );
  const huerfanas = fichas.filter((f) => !vivos.has(f.tiktok_sku_id));
  if (huerfanas.length === 0) return 0;

  const porFicha = new Map<string, { tiktok_sku_id: string; tiktok_product_id: string }>();
  const ids = huerfanas.map((f) => f.id);
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await admin
      .from("tiktok_publicaciones")
      .select("producto_id, tiktok_sku_id, tiktok_product_id")
      .in("producto_id", ids.slice(i, i + 100));
    if (error) throw new Error(error.message);
    type FilaPub = { producto_id: string; tiktok_sku_id: string; tiktok_product_id: string };
    for (const p of (data ?? []) as FilaPub[]) {
      if (vivos.has(p.tiktok_sku_id) && !porFicha.has(p.producto_id)) porFicha.set(p.producto_id, p);
    }
  }
  if (porFicha.size === 0) return 0;

  const nuevas: Publicacion[] = [];
  for (const [producto_id, p] of porFicha) {
    const { error } = await admin
      .from("products")
      .update({ tiktok_product_id: p.tiktok_product_id, tiktok_sku_id: p.tiktok_sku_id })
      .eq("id", producto_id);
    if (error) throw new Error(error.message);
    nuevas.push({ ...p, producto_id, principal: true });
    const vieja = huerfanas.find((f) => f.id === producto_id);
    if (vieja) {
      await admin
        .from("tiktok_publicaciones")
        .update({ principal: false })
        .eq("tiktok_sku_id", vieja.tiktok_sku_id);
    }
  }
  await registrarPublicaciones(nuevas);
  return nuevas.length;
}

/* Importación inicial y reconciliación (cron / botón). Guarda también el
   almacén principal para poder escribir stock después. */
export async function importacionCompletaTikTok(cx?: ConexionTikTok): Promise<ResumenSyncTikTok> {
  const conexion = cx ?? (await conexionTiktok());
  if (!conexion) throw new Error("TikTok Shop no está conectado.");

  const productos = await listarProductosTikTok(conexion);
  // El search no trae imágenes; se leen del detalle antes de guardar.
  await enriquecerImagenes(conexion, productos);
  const resumenLote = await sincronizarProductosTikTok(productos);

  // Renglones solo-TikTok cuyo SKU ya no existe → inactivos.
  const admin = createAdminClient();
  const vivos = new Set(productos.flatMap((p) => (p.skus ?? []).map((s) => s.id)));

  /* Antes de dar nada de baja: si la publicación PRINCIPAL de una ficha murió
     (borrada en TikTok) pero otra de sus publicaciones sigue viva, la ficha pasa
     a apuntar a esa. Si no, el CRM se quedaría hablándole a una publicación que
     ya no existe —y ahí es donde se leería y escribiría el stock cuando el
     piloto vuelva a encenderse—. */
  await repuntarPrincipales(vivos);
  const { data: enBase, error } = await admin
    .from("products")
    .select("id, tiktok_sku_id")
    .not("tiktok_sku_id", "is", null)
    .is("tiendanube_variant_id", null)
    .is("meli_item_id", null)
    .eq("activo", true);
  if (error) throw new Error(error.message);
  const sobrantes = ((enBase ?? []) as { id: string; tiktok_sku_id: string }[])
    .filter((f) => !vivos.has(f.tiktok_sku_id))
    .map((f) => f.id);
  if (sobrantes.length > 0) {
    const { error: errBaja } = await admin.from("products").update({ activo: false }).in("id", sobrantes);
    if (errBaja) throw new Error(errBaja.message);
  }

  // Rellenar las fichas de TikTok sin foto con la de un producto de Tienda Nube
  // de nombre parecido (TikTok no siempre trae imágenes).
  const fotos_pobladas = await poblarImagenesTikTokDesdeCatalogo();

  const resumen: ResumenSyncTikTok = {
    productos: productos.length,
    ...resumenLote,
    fotos_pobladas,
    desactivados: sobrantes.length,
  };

  await mezclarDatosIntegracion("tiktok", { ultima_sync: new Date().toISOString(), ...resumen });

  return resumen;
}
