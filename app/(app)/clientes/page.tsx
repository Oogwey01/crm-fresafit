import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { traerTodo } from "@/lib/canales/paginacion";
import { conColumnasOpcionales } from "@/lib/supabase/columnas-opcionales";
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

  const [clientes, statsRes] = await Promise.all([
    /* Paginado: sin esto PostgREST cortaba en 1000 filas SIN avisar y la
       pantalla mostraba 1000 de 2539 clientes, con los totales calculados
       solo sobre esa parte. Se piden además las 7 columnas que usa el módulo,
       no las 12 de la tabla. */
    traerTodo<Customer>((desde, hasta) => {
      const consulta = (columnas: string) =>
        supabase
          .from("customers")
          .select(columnas)
          .order("nombre")
          .range(desde, hasta) as unknown as PromiseLike<{
          data: Customer[] | null;
          error: { message: string } | null;
        }>;
      /* ciudad/estado/cp son de una migración reciente: si aún no se aplicó, la
         lista carga sin ubicación en vez de quedarse vacía. */
      const BASE =
        "id, nombre, correo, telefono, canal, notas," +
        " tiendanube_customer_id, mercadolibre_buyer_id, tiktok_buyer_id";
      return conColumnasOpcionales<Customer>(
        () => consulta(`${BASE}, ciudad, estado, cp`),
        () => consulta(BASE),
        "clientes",
      );
    }),
    /* Estadísticas por cliente calculadas en Postgres: antes se bajaban hasta
       10.000 ventas con join solo para sumarlas aquí (y se serializaban
       íntegras al navegador; el historial ahora se carga al abrir la ficha). */
    supabase.rpc("stats_por_cliente"),
  ]);

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
