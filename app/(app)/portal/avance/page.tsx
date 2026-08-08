import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { traerTodo } from "@/lib/canales/paginacion";
import { COLUMNAS_TAREA_CON_RESPONSABLE } from "@/lib/tareas/consulta";
import { avanceDeEmpresa, pendientesPorLado } from "@/lib/avance/consulta";
import { PanelAvance } from "@/components/avance/panel-avance";
import { hoyISO } from "@/lib/fecha";
import type { AgenciaEmpresa, TaskConResponsable } from "@/lib/types";

export const metadata = { title: "Avance · Tu espacio con Fresafit" };

/* El avance, del lado del cliente. Mismo componente que la pestaña del equipo;
   la RLS ya recortó todo a lo compartido de su empresa, así que aquí no hay ni
   un filtro de visibilidad. */
export default async function PortalAvancePage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  await exigirModulo("portal-avance");
  const { supabase, perfil } = await usuarioActual();
  const empresaId = perfil?.empresa_id ?? "";

  /* El rango por defecto: los últimos 30 días. La bitácora completa de un
     proyecto de un año no es lo que alguien entra a leer. */
  const params = await searchParams;
  const hoy = hoyISO();
  const hace30 = new Date(Date.parse(`${hoy}T12:00:00Z`) - 30 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const rango = { desde: params.desde ?? hace30, hasta: params.hasta ?? hoy };

  const [datos, tareas, empresaRes, companerosRes] = await Promise.all([
    avanceDeEmpresa(supabase, empresaId, rango),
    traerTodo<TaskConResponsable>((desde, hasta) =>
      supabase
        .from("tasks")
        .select(COLUMNAS_TAREA_CON_RESPONSABLE)
        .eq("espacio", "agencia")
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .order("id")
        .range(desde, hasta),
    ),
    supabase.from("agencia_empresas").select("id, nombre").eq("id", empresaId).maybeSingle(),
    supabase.from("profiles").select("id").eq("empresa_id", empresaId),
  ]);

  const empresa = (empresaRes.data ?? null) as Pick<AgenciaEmpresa, "id" | "nombre"> | null;
  const idsDelCliente = new Set((companerosRes.data ?? []).map((p) => p.id));

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-[19px] font-bold">Avance del proyecto</h1>
        <p className="text-[13.5px] text-muted-foreground">
          En qué vamos, qué viene y qué está frenando — sin tener que preguntar.
        </p>
      </header>

      <PanelAvance
        empresaId={empresaId}
        empresaNombre={empresa?.nombre ?? "tu empresa"}
        datos={datos}
        pendientes={pendientesPorLado(tareas, idsDelCliente)}
        puedeEditar={false}
        rango={rango}
      />
    </div>
  );
}
