import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { puedeAdministrar } from "@/lib/catalogos";
import { PanelReportes } from "@/components/reportes/panel";
import type { AgenciaEmpresa, AgenciaReporteConEmpresa } from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Reportes · Agencia Fresafit" };

/* Lo que se le entrega a cada cliente. Los números salen de Meta y Shopify a
   mano —automatizar esa extracción es otro trabajo—; lo que hacía falta ya era
   el registro de qué se entregó y cuándo, que es lo que se discute cuando un
   cliente pregunta por su reporte. Los reportes propios de la marca están en
   /reportes. */
export default async function ReportesAgenciaPage() {
  await exigirModulo("agencia-reportes");
  const { supabase, rol } = await usuarioActual();
  if (!puedeAdministrar(rol)) redirect("/tareas");

  const [reportesRes, empresasRes] = await Promise.all([
    supabase
      .from("reportes")
      .select("*, empresa:agencia_empresas!empresa_id(id, nombre, color)")
      .not("empresa_id", "is", null)
      .order("periodo_hasta", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(300),
    supabase.from("agencia_empresas").select("*").eq("activa", true).order("nombre"),
  ]);

  return (
    <PanelReportes
      reportes={(reportesRes.data ?? []) as unknown as AgenciaReporteConEmpresa[]}
      empresas={(empresasRes.data ?? []) as AgenciaEmpresa[]}
    />
  );
}
