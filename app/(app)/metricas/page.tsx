import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { estadoTiendanube } from "@/lib/tiendanube/api";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelMetricas } from "@/components/metricas/panel";
import type { Customer, Product, RolId, VentaMetricas } from "@/lib/types";

export const metadata = { title: "Métricas · Fresafit" };

/* Ventana de datos: un año, para que el rango de fechas a mano tenga historia
   que filtrar (los periodos fijos solo llegaban a "mes pasado"). */
const DIAS_VENTANA = 365;

export default async function MetricasPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const [ventasRes, productosRes, clientesRes, tiendanube] = await Promise.all([
    supabase
      .from("sales")
      /* Solo lo que usa el panel (y el diálogo de venta al editar): con `*` la
         respuesta pesaba 742 KB contra 570 KB. El orden por created_at sigue
         funcionando aunque la columna no se seleccione. */
      .select(
        "id, fecha, canal, cantidad, monto, descripcion, notas, origen," +
          " producto_id, cliente_id, referencia_externa," +
          " producto:products!producto_id(id, nombre, variante, tipo)",
      )
      .gte("fecha", diasDesdeHoy(-DIAS_VENTANA))
      .or("estado.is.null,estado.neq.cancelado") // los cancelados no cuentan como venta
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("products")
      .select("id, nombre, variante, sku, precio, activo")
      .order("nombre"),
    supabase.from("customers").select("id, nombre, correo, telefono").order("nombre"),
    estadoTiendanube(),
  ]);

  const ventas = (ventasRes.data ?? []) as unknown as VentaMetricas[];
  const productos = (productosRes.data ?? []) as Pick<
    Product,
    "id" | "nombre" | "variante" | "sku" | "precio" | "activo"
  >[];
  const clientes = (clientesRes.data ?? []) as Pick<Customer, "id" | "nombre" | "correo" | "telefono">[];

  return (
    <PanelMetricas
      ventas={ventas}
      productos={productos}
      clientes={clientes}
      rol={rol}
      tiendanube={tiendanube}
    />
  );
}
