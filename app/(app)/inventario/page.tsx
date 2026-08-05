import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { estadoCanales } from "@/lib/canales/integraciones";
import { traerTodo } from "@/lib/canales/paginacion";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelInventario, type AvisoConexion } from "@/components/inventario/panel";
import { ESCRITURA_CANALES } from "@/lib/inventario/escritura-canales";
import { estadoPiloto } from "@/lib/inventario/piloto";
import { paramsReordenDesdeEnv, type EnCamino, type VentaReorden } from "@/lib/inventario/reabastecimiento";
import type {
  ProductConProveedor,
  ProductPhoto,
  Supplier,
  RolId,
  StockLog,
  ConteoConProducto,
  Profile,
} from "@/lib/types";
import type { ResumenReconciliacion } from "@/lib/inventario/reconciliacion";

export const metadata = { title: "Inventario · Fresafit" };

/* Ventana máxima de ventas que se manda al panel; ahí se recorta a 30/60/90
   días según lo que elija el usuario, sin volver al servidor. */
const DIAS_VENTAS = 90;

type Params = { [key: string]: string | string[] | undefined };

/* Avisos de vuelta del OAuth de un canal. Se arman aquí (el panel solo los
   emite como toast y limpia la URL) porque los query params ya llegan al
   servidor: antes el panel los leía de window.location en un efecto. */
function avisosDeConexion(params: Params): AvisoConexion[] {
  const leer = (k: string) => (typeof params[k] === "string" ? params[k] : undefined);
  const tn = leer("tiendanube");
  const ml = leer("mercadolibre");
  const tk = leer("tiktok");
  if (!tn && !ml && !tk) return [];

  const avisos: AvisoConexion[] = [];
  const productos = leer("productos");
  const vinculados = leer("vinculados");

  if (tn === "conectada") {
    avisos.push({
      tipo: "ok",
      mensaje: `Tienda Nube conectada${productos ? ` · ${productos} productos importados` : ""}.`,
    });
    if (leer("webhooks") === "pendientes") {
      avisos.push({
        tipo: "info",
        mensaje: "La actualización automática (webhooks) se activará con el deploy en Vercel.",
      });
    }
  } else if (tn) {
    avisos.push({ tipo: "error", mensaje: "No se pudo conectar Tienda Nube. Intenta de nuevo." });
  }

  if (ml === "conectada") {
    const items = leer("items");
    avisos.push({
      tipo: "ok",
      mensaje: `Mercado Libre conectado${items ? ` · ${items} publicaciones importadas` : ""}${
        vinculados && vinculados !== "0" ? ` (${vinculados} vinculadas por SKU)` : ""
      }.`,
    });
  } else if (ml) {
    avisos.push({ tipo: "error", mensaje: "No se pudo conectar Mercado Libre. Intenta de nuevo." });
  }

  if (tk === "conectada") {
    avisos.push({
      tipo: "ok",
      mensaje: `TikTok Shop conectado${productos ? ` · ${productos} productos importados` : ""}${
        vinculados && vinculados !== "0" ? ` (${vinculados} vinculados por SKU)` : ""
      }.`,
    });
  } else if (tk === "otra-tienda") {
    /* La cuenta de TikTok trae también una tienda SANDBOX de pruebas, y
       autorizar ésa apuntaría el CRM a un catálogo vacío. Se rechaza y se dice
       qué hacer, en vez de cambiar la conexión en silencio. */
    avisos.push({
      tipo: "error",
      mensaje:
        "Esa autorización es de otra tienda de TikTok (probablemente la SANDBOX de pruebas). " +
        "La conexión actual se dejó intacta: vuelve a autorizar eligiendo la tienda real de Fresafit.",
    });
  } else if (tk) {
    avisos.push({ tipo: "error", mensaje: "No se pudo conectar TikTok Shop. Intenta de nuevo." });
  }

  return avisos;
}

export default async function InventarioPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;
  const avisosConexion = avisosDeConexion(await searchParams);

  const [
    productosRes,
    fotosRes,
    proveedoresRes,
    movimientosRes,
    ventasRes,
    enCaminoRes,
    equipoRes,
    reconSnapRes,
    conteosRes,
    canales,
    piloto,
  ] = await Promise.all([
    /* Paginado con traerTodo: PostgREST corta las respuestas en ~1000 filas SIN
       error, así que un `select` sin rango sobre un catálogo que crece devuelve
       un resultado incompleto en silencio — y un producto que "no aparece" se
       lee como un producto que no existe. Con cientos de variantes por línea el
       catálogo ya ronda ese techo.

       Todas las columnas MENOS `imagenes`: esa galería pesa ~950 KB sobre el
       catálogo completo y solo la usa el diálogo de edición de UN producto,
       que la pide al abrirse (galeriaDeProducto). */
    traerTodo<ProductConProveedor>((desde, hasta) =>
      supabase
        .from("products")
        .select(
          "id, nombre, variante, sku, tipo, costo, precio, stock, stock_minimo," +
            " proveedor_id, activo, bajo_pedido, descontinuado, notas, imagen_url," +
            " meli_item_id, meli_variation_id, meli_logistic_type, meli_stock_full," +
            " meli_user_product_id, tiendanube_product_id, tiendanube_variant_id," +
            " tiktok_product_id, tiktok_sku_id, tiktok_stock, created_at, created_by, updated_at," +
            " proveedor:suppliers!proveedor_id(id, nombre, dias_entrega)",
        )
        .order("nombre")
        /* El join anidado hace que supabase-js no pueda inferir la forma; el
           cast es el mismo patrón que ya usa la página de clientes. */
        .range(desde, hasta) as unknown as Promise<{
        data: ProductConProveedor[] | null;
        error: { message: string } | null;
      }>,
    ),
    // Fotos subidas a mano. Van aparte de products.imagenes (la galería
    // importada) porque cada sincronización de canal reescribe esa columna.
    // Paginadas por el mismo motivo: son varias por producto.
    traerTodo<ProductPhoto>((desde, hasta) =>
      supabase.from("product_photos").select("*").order("orden").range(desde, hasta),
    ),
    supabase.from("suppliers").select("*").order("nombre"),
    // Historial de movimientos de stock (los 300 más recientes).
    supabase
      .from("stock_log")
      .select("*, producto:products!producto_id(nombre, variante)")
      .order("creado_en", { ascending: false })
      .limit(300),
    // Ventas de la ventana: alimentan la velocidad de salida de cada producto.
    // Agregadas por día/canal/producto en la base (RPC ventas_reorden), que es
    // la granularidad que usa el panel: mismo resultado, muchas menos filas
    // que bajar cada venta. Los cancelados no cuentan (mismo criterio que
    // Métricas, dentro de la RPC).
    supabase.rpc("ventas_reorden", { desde: diasDesdeHoy(-DIAS_VENTAS) }),
    /* Unidades pedidas a proveedor que aún no llegan. Va por RPC y no leyendo
       supplier_order_items porque esa tabla ahora es solo de dirección: la
       función devuelve producto y cantidad, sin costo ni proveedor, para que
       «Qué pedir» siga descontando lo que ya viene en camino. */
    supabase.rpc("unidades_en_camino"),
    // Equipo (para los selectores de "quién contó/corroboró" en el conteo físico).
    supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
    // Última reconciliación guardada: se muestra al instante (la lectura en vivo
    // de los canales es lo que tarda; se refresca con «Revisar ahora» o el cron).
    supabase.from("reconciliacion_snapshots").select("resumen, creado_en").eq("id", "actual").maybeSingle(),
    // Conteos físicos recientes (con el producto para comparar contra el CRM).
    supabase
      .from("conteos_fisicos")
      .select("*, producto:products!producto_id(id, nombre, variante, sku, stock)")
      .order("fecha", { ascending: false })
      .limit(200),
    // Estado de los tres canales para la UI, en una sola query.
    estadoCanales(),
    // Monitor del piloto: sale de la foto horaria y del ledger, sin llamar a
    // las APIs de los canales.
    estadoPiloto(),
  ]);

  const fotosPorProducto: Record<string, ProductPhoto[]> = {};
  for (const f of fotosRes) {
    (fotosPorProducto[f.producto_id] ??= []).push(f);
  }
  const productos = productosRes.map((p) => ({
    ...p,
    fotos_propias: fotosPorProducto[p.id] ?? [],
  }));
  const proveedores = (proveedoresRes.data ?? []) as Supplier[];
  const movimientos = (movimientosRes.data ?? []) as unknown as StockLog[];
  const ventas = (ventasRes.data ?? []) as unknown as VentaReorden[];
  const conteos = (conteosRes.data ?? []) as unknown as ConteoConProducto[];
  const equipo = (equipoRes.data ?? []) as Profile[];
  const snap = reconSnapRes.data as { resumen: ResumenReconciliacion; creado_en: string } | null;
  const reconciliacionInicial = snap
    ? { resumen: snap.resumen, creadoEn: snap.creado_en }
    : null;

  /* La RPC ya viene agrupada por producto y filtrada por estado. */
  const enCamino: EnCamino = {};
  for (const f of (enCaminoRes.data ?? []) as { producto_id: string; unidades: number }[]) {
    enCamino[f.producto_id] = Number(f.unidades);
  }

  return (
    <PanelInventario
      productos={productos}
      proveedores={proveedores}
      movimientos={movimientos}
      ventas={ventas}
      enCamino={enCamino}
      paramsReorden={paramsReordenDesdeEnv()}
      rol={rol}
      tiendanube={canales.tiendanube}
      mercadolibre={canales.mercadolibre}
      tiktok={canales.tiktok}
      escrituraCanales={ESCRITURA_CANALES}
      piloto={piloto}
      conteos={conteos}
      equipo={equipo}
      reconciliacionInicial={reconciliacionInicial}
      avisosConexion={avisosConexion}
    />
  );
}
