import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { PanelClientes } from "@/components/clientes/panel";
import type { Customer, CustomerConStats, RolId } from "@/lib/types";

export const metadata = { title: "Clientes · Fresafit" };

/* Fila de la RPC stats_por_cliente() (agregado en la base; mismo criterio que
   el cálculo en JS que sustituye: ventas con cliente y no canceladas). */
type StatCliente = { cliente_id: string; compras: number; total: number; ultima: string | null };

export default async function ClientesPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const [clientesRes, statsRes] = await Promise.all([
    supabase.from("customers").select("*").order("nombre"),
    /* Estadísticas por cliente calculadas en Postgres: antes se bajaban hasta
       10.000 ventas con join solo para sumarlas aquí (y se serializaban
       íntegras al navegador; el historial ahora se carga al abrir la ficha). */
    supabase.rpc("stats_por_cliente"),
  ]);

  const clientes = (clientesRes.data ?? []) as Customer[];
  const stats = new Map(
    ((statsRes.data ?? []) as StatCliente[]).map((s) => [s.cliente_id, s]),
  );

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

  return <PanelClientes clientes={conStats} rol={rol} />;
}
