import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { puedeAdministrar } from "@/lib/catalogos";
import { PanelCobros } from "@/components/agencia/panel-cobros";
import type { AgenciaContrato, AgenciaEmpresa, AgenciaIngresoConEmpresa } from "@/lib/types";

export const metadata = { title: "Cobros · Agencia Fresafit" };

/* Lo que la agencia factura: cortes de contrato, migraciones y comisiones por
   referidos, con su ciclo calculado → cobrado → pagado. */
export default async function CobrosPage() {
  const { supabase, rol } = await usuarioActual();
  if (!puedeAdministrar(rol)) redirect("/tareas");

  const [ingresosRes, empresasRes, contratosRes] = await Promise.all([
    supabase
      .from("agencia_ingresos")
      .select("*, empresa:agencia_empresas!empresa_id(id, nombre, color)")
      /* Por periodo cuando lo hay y si no por captura: un cobro suelto sin
         periodo no debe hundirse al final de la lista. */
      .order("periodo_hasta", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500),
    supabase.from("agencia_empresas").select("*").eq("activa", true).order("nombre"),
    supabase.from("agencia_contratos").select("*").eq("activo", true),
  ]);

  return (
    <PanelCobros
      ingresos={(ingresosRes.data ?? []) as unknown as AgenciaIngresoConEmpresa[]}
      empresas={(empresasRes.data ?? []) as AgenciaEmpresa[]}
      contratos={(contratosRes.data ?? []) as AgenciaContrato[]}
    />
  );
}
