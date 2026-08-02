import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { PanelClientes } from "@/components/clientes/panel";
import type { Customer, CustomerConStats, RolId, SaleConProducto } from "@/lib/types";

export const metadata = { title: "Clientes · Fresafit" };

export default async function ClientesPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const [clientesRes, ventasRes] = await Promise.all([
    supabase.from("customers").select("*").order("nombre"),
    /* Ventas con cliente: alimentan las estadísticas y el historial. Se
       calculan aquí (no se guardan) para que nunca se desincronicen. */
    supabase
      .from("sales")
      .select("*, producto:products!producto_id(id, nombre, variante)")
      .not("cliente_id", "is", null)
      .or("estado.is.null,estado.neq.cancelado") // los cancelados no cuentan
      .order("fecha", { ascending: false })
      .limit(10000),
  ]);

  const clientes = (clientesRes.data ?? []) as Customer[];
  const ventas = (ventasRes.data ?? []) as unknown as SaleConProducto[];

  /* Estadísticas por cliente (compras, total gastado, última compra). */
  const stats = new Map<string, { compras: number; total: number; ultima: string | null }>();
  for (const v of ventas) {
    if (!v.cliente_id) continue;
    const s = stats.get(v.cliente_id) ?? { compras: 0, total: 0, ultima: null };
    s.compras += 1;
    s.total += v.monto;
    if (!s.ultima || v.fecha > s.ultima) s.ultima = v.fecha;
    stats.set(v.cliente_id, s);
  }

  const conStats: CustomerConStats[] = clientes.map((c) => {
    const s = stats.get(c.id);
    return {
      ...c,
      compras: s?.compras ?? 0,
      total: s?.total ?? 0,
      ultimaCompra: s?.ultima ?? null,
      recurrente: (s?.compras ?? 0) >= 2,
    };
  });

  return <PanelClientes clientes={conStats} ventas={ventas} rol={rol} />;
}
