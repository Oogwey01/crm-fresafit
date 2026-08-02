import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { estadoCanales } from "@/lib/canales/integraciones";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelInventario } from "@/components/inventario/panel";
import { ESCRITURA_CANALES } from "@/lib/inventario/escritura-canales";
import { estadoPiloto } from "@/lib/inventario/piloto";
import { paramsReordenDesdeEnv, type EnCamino, type VentaReorden } from "@/lib/inventario/reabastecimiento";
import type {
  ProductConProveedor,
  ProductPhoto,
  Supplier,
  SupplierOrderConDetalle,
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

/* Un pedido a proveedor en estos estados todavía no llegó: sus unidades cuentan
   como "en camino" y bajan lo que hay que volver a pedir. */
const ESTADOS_EN_CAMINO = ["pedido", "en_transito", "en_aduana"];

export default async function InventarioPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const [
    productosRes,
    fotosRes,
    proveedoresRes,
    pedidosRes,
    movimientosRes,
    ventasRes,
    enCaminoRes,
    equipoRes,
    reconSnapRes,
    conteosRes,
    canales,
    piloto,
  ] = await Promise.all([
    supabase
      .from("products")
      .select("*, proveedor:suppliers!proveedor_id(id, nombre, dias_entrega)")
      .order("nombre"),
    // Fotos subidas a mano. Van aparte de products.imagenes (la galería
    // importada) porque cada sincronización de canal reescribe esa columna.
    supabase.from("product_photos").select("*").order("orden"),
    supabase.from("suppliers").select("*").order("nombre"),
    supabase
      .from("supplier_orders")
      .select(
        "*, proveedor:suppliers!proveedor_id(id, nombre), items:supplier_order_items(*, producto:products!producto_id(id, nombre, variante))",
      )
      .order("fecha_pedido", { ascending: false }),
    // Historial de movimientos de stock (los 300 más recientes).
    supabase
      .from("stock_log")
      .select("*, producto:products!producto_id(nombre, variante)")
      .order("creado_en", { ascending: false })
      .limit(300),
    // Ventas de la ventana: alimentan la velocidad de salida de cada producto.
    // Los cancelados no cuentan (mismo criterio que Métricas).
    supabase
      .from("sales")
      .select("fecha, canal, cantidad, producto_id")
      .gte("fecha", diasDesdeHoy(-DIAS_VENTAS))
      .or("estado.is.null,estado.neq.cancelado")
      .limit(20000),
    // Renglones de pedidos a proveedor que aún no llegan.
    supabase
      .from("supplier_order_items")
      .select("producto_id, cantidad, pedido:supplier_orders!pedido_id(estado)")
      .not("producto_id", "is", null),
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
  for (const f of (fotosRes.data ?? []) as ProductPhoto[]) {
    (fotosPorProducto[f.producto_id] ??= []).push(f);
  }
  const productos = ((productosRes.data ?? []) as unknown as ProductConProveedor[]).map((p) => ({
    ...p,
    fotos_propias: fotosPorProducto[p.id] ?? [],
  }));
  const proveedores = (proveedoresRes.data ?? []) as Supplier[];
  const pedidos = (pedidosRes.data ?? []) as unknown as SupplierOrderConDetalle[];
  const movimientos = (movimientosRes.data ?? []) as unknown as StockLog[];
  const ventas = (ventasRes.data ?? []) as unknown as VentaReorden[];
  const conteos = (conteosRes.data ?? []) as unknown as ConteoConProducto[];
  const equipo = (equipoRes.data ?? []) as Profile[];
  const snap = reconSnapRes.data as { resumen: ResumenReconciliacion; creado_en: string } | null;
  const reconciliacionInicial = snap
    ? { resumen: snap.resumen, creadoEn: snap.creado_en }
    : null;

  /* Unidades pedidas que siguen sin llegar, por producto. El filtro de estado se
     hace aquí (PostgREST no filtra por columnas de la tabla embebida sin cambiar
     la forma del resultado). */
  const filasCamino = (enCaminoRes.data ?? []) as unknown as {
    producto_id: string;
    cantidad: number;
    pedido: { estado: string } | null;
  }[];
  const enCamino: EnCamino = {};
  for (const f of filasCamino) {
    if (!f.pedido || !ESTADOS_EN_CAMINO.includes(f.pedido.estado)) continue;
    enCamino[f.producto_id] = (enCamino[f.producto_id] ?? 0) + f.cantidad;
  }

  return (
    <PanelInventario
      productos={productos}
      proveedores={proveedores}
      pedidos={pedidos}
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
    />
  );
}
