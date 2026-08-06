import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { adjuntarCostos } from "@/lib/supabase/montos";
import { estadoCanales } from "@/lib/canales/integraciones";
import { traerTodo } from "@/lib/canales/paginacion";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelInventario, type AvisoConexion } from "@/components/inventario/panel";
import { ESCRITURA_CANALES } from "@/lib/inventario/escritura-canales";
import { estadoPiloto } from "@/lib/inventario/piloto";
import { FILTRO_PUESTA_AL_DIA, LIMITE_MOVIMIENTOS } from "@/lib/inventario/origenes";
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
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

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
  await exigirModulo("inventario");
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;
  const avisosConexion = avisosDeConexion(await searchParams);

  /* El costo es EGRESO —lo que nos cuesta— y el precio, INGRESO. Con los dos al
     lado, el margen de cada SKU es una resta, así que ninguno viaja para quien
     no puede verlos. El costo ni siquiera se pide a la tabla: está fuera del
     alcance del token y sale de `producto_costos` (ver 20260902000000).
     Anotado como `string`: el parser de tipos de supabase-js se rinde ante una
     lista de columnas armada al vuelo. */
  /* Sin await: solo el catálogo depende de él (columnas y costo), así que
     encadena dentro del Promise.all en vez de frenar a las demás en serie. */
  const dineroP = vistaDinero();
  const columnasCatalogo = (ingresos: boolean): string =>
    "id, nombre, variante, sku, tipo, stock, stock_minimo," +
    " proveedor_id, activo, bajo_pedido, descontinuado, notas, imagen_url," +
    " meli_item_id, meli_variation_id, meli_logistic_type, meli_stock_full," +
    " meli_user_product_id, tiendanube_product_id, tiendanube_variant_id," +
    " tiktok_product_id, tiktok_sku_id, tiktok_stock, created_at, created_by, updated_at," +
    " proveedor:suppliers!proveedor_id(id, nombre, dias_entrega)" +
    (ingresos ? ", precio" : "");

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
    dineroP.then((dinero) =>
      traerTodo<ProductConProveedor>((desde, hasta) =>
        supabase
          .from("products")
          .select(columnasCatalogo(dinero.ingresos))
          .order("nombre")
          /* El join anidado hace que supabase-js no pueda inferir la forma; el
             cast es el mismo patrón que ya usa la página de clientes. */
          .range(desde, hasta) as unknown as Promise<{
          data: ProductConProveedor[] | null;
          error: { message: string } | null;
        }>,
      ).then((catalogo) =>
        /* El costo se une aquí mismo, desde `producto_costos`: la columna está
           fuera del alcance del token y la vista la sirve solo a quien lleva
           los egresos. Encadenado, no después del Promise.all: es un viaje que
           corre mientras las otras diez consultas siguen en vuelo. */
        adjuntarCostos(supabase, catalogo, dinero.egresos),
      ),
    ),
    // Fotos subidas a mano. Van aparte de products.imagenes (la galería
    // importada) porque cada sincronización de canal reescribe esa columna.
    // Paginadas por el mismo motivo: son varias por producto.
    traerTodo<ProductPhoto>((desde, hasta) =>
      supabase.from("product_photos").select("*").order("orden").range(desde, hasta),
    ),
    supabase.from("suppliers").select("*").order("nombre"),
    /* Historial de movimientos de stock. Solo los REALES: las puestas al día
       —el CRM copiando el número que ya tenía el canal— son el 93% de la tabla
       y sepultaban a las ventas y a la mercancía recibida. Se piden aparte,
       cuando alguien las pide (ver `movimientosStock` en actions.ts).

       El tope se aplica ANTES que cualquier filtro, así que tiene que ser
       holgado o el filtro de canal mentiría: con ~70 movimientos reales al mes
       y 90 días de retención, 250 no corta nunca en la práctica.

       `autor` es quien lo provocó: null en lo que hicieron el cron o un webhook. */
    supabase
      .from("stock_log")
      .select("*, producto:products!producto_id(nombre, variante), autor:profiles!created_by(nombre)")
      .not("origen", "in", FILTRO_PUESTA_AL_DIA)
      .order("creado_en", { ascending: false })
      .limit(LIMITE_MOVIMIENTOS),
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

  const dinero = await dineroP;
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
      dinero={dinero}
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
