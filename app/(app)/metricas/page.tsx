import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { estadoTiendanube } from "@/lib/tiendanube/api";
import { carritosAbandonadosTN, saludML, visitasML } from "@/lib/canales/salud";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelMetricas } from "@/components/metricas/panel";
import type { Customer, OrdenMetricas, Product, RolId, VentaMetricas } from "@/lib/types";

export const metadata = { title: "Métricas · Fresafit" };

/* Ventana de datos: un año, para que el rango de fechas a mano tenga historia
   que filtrar (los periodos fijos solo llegaban a "mes pasado"). */
const DIAS_VENTANA = 365;

/* Tope de renglones que se bajan al navegador. Se expone como constante para
   poder detectar cuándo se alcanzó y avisarlo en pantalla. */
const LIMITE_VENTAS = 5000;

/* Ventana de los datos que se piden a los canales en vivo. 30 días es lo que
   Mercado Libre reporta de visitas y basta para leer una tendencia. */
const DIAS_PLATAFORMAS = 30;

export default async function MetricasPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const [
    ventasRes,
    ordenesRes,
    productosRes,
    clientesRes,
    tiendanube,
    visitas,
    salud,
    carritos,
  ] = await Promise.all([
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
      .limit(LIMITE_VENTAS),
    /* Totales por orden: es la cifra que reportan los paneles de los canales
       (producto + envío − descuentos). Son bastantes menos filas que `sales`
       —una por orden y no por renglón—, así que caben holgadamente. */
    supabase
      .from("sale_orders")
      .select("canal, fecha, total, subtotal, envio, descuento, metodo_pago, cupon, meses")
      .gte("fecha", diasDesdeHoy(-DIAS_VENTANA))
      .neq("estado", "cancelled")
      .order("fecha", { ascending: false })
      .limit(20000),
    supabase
      .from("products")
      .select("id, nombre, variante, sku, precio, activo")
      .order("nombre"),
    supabase.from("customers").select("id, nombre, correo, telefono").order("nombre"),
    estadoTiendanube(),
    /* Lo que las plataformas saben y no llega a `sales`. Cada uno devuelve null
       si su canal no contesta, y el panel oculta ese bloque en vez de romperse:
       Métricas no puede depender de que una API ajena esté arriba. */
    visitasML(DIAS_PLATAFORMAS),
    saludML(),
    carritosAbandonadosTN(DIAS_PLATAFORMAS),
  ]);

  const ventas = (ventasRes.data ?? []) as unknown as VentaMetricas[];
  /* `sale_orders` es de una migración reciente y se aplica a mano: mientras no
     esté, el KPI de ventas cae a la suma de renglones (el comportamiento de
     siempre) en vez de tumbar la página. */
  if (ordenesRes.error) {
    console.warn("[metricas] sale_orders no disponible:", ordenesRes.error.message);
  }
  const ordenes = (ordenesRes.data ?? []) as OrdenMetricas[];

  /* Si se llegó al tope, las ventas MÁS VIEJAS del año se quedaron fuera (el
     orden es descendente) y los totales de los periodos largos saldrían cortos.
     Hasta ahora eso pasaba en silencio, que es la peor forma de descuadrar. */
  const truncado = ventas.length >= LIMITE_VENTAS;
  const productos = (productosRes.data ?? []) as Pick<
    Product,
    "id" | "nombre" | "variante" | "sku" | "precio" | "activo"
  >[];
  const clientes = (clientesRes.data ?? []) as Pick<Customer, "id" | "nombre" | "correo" | "telefono">[];

  /* Unidades vendidas en Mercado Libre dentro de la MISMA ventana que las
     visitas: comparar 30 días de visitas contra un año de ventas daría una
     conversión inventada. */
  const desdePlataformas = diasDesdeHoy(-DIAS_PLATAFORMAS);
  const ventasMLVentana = ventas
    .filter((v) => v.canal === "mercado_libre" && v.fecha >= desdePlataformas)
    .reduce((a, v) => a + (v.cantidad || 0), 0);

  return (
    <PanelMetricas
      ventas={ventas}
      ordenes={ordenes}
      truncado={truncado}
      productos={productos}
      clientes={clientes}
      rol={rol}
      tiendanube={tiendanube}
      visitas={visitas}
      salud={salud}
      carritos={carritos}
      ventasMLVentana={ventasMLVentana}
    />
  );
}
