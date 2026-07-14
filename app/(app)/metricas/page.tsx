import { createClient } from "@/lib/supabase/server";
import { estadoTiendanube } from "@/lib/tiendanube/api";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelMetricas } from "@/components/metricas/panel";
import type { Product, RolId, SaleConProducto } from "@/lib/types";

export const metadata = { title: "Métricas · Fresafit" };

/* Ventana de datos: cubre "mes pasado" y su comparativo (el antepasado). */
const DIAS_VENTANA = 120;

export default async function MetricasPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [ventasRes, productosRes, perfilRes, tiendanube] = await Promise.all([
    supabase
      .from("sales")
      .select("*, producto:products!producto_id(id, nombre, variante)")
      .gte("fecha", diasDesdeHoy(-DIAS_VENTANA))
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(5000),
    supabase
      .from("products")
      .select("id, nombre, variante, sku, precio, activo")
      .order("nombre"),
    user
      ? supabase.from("profiles").select("rol").eq("id", user.id).single()
      : Promise.resolve({ data: null }),
    estadoTiendanube(),
  ]);

  const ventas = (ventasRes.data ?? []) as unknown as SaleConProducto[];
  const productos = (productosRes.data ?? []) as Pick<
    Product,
    "id" | "nombre" | "variante" | "sku" | "precio" | "activo"
  >[];
  const rol = ((perfilRes.data as { rol?: RolId } | null)?.rol ?? "miembro") as RolId;

  return <PanelMetricas ventas={ventas} productos={productos} rol={rol} tiendanube={tiendanube} />;
}
