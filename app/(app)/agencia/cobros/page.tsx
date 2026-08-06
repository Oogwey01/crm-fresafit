import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { empresasAgenciaActivas } from "@/lib/supabase/consultas";
import { puedeAdministrar } from "@/lib/catalogos";
import { PanelCobros } from "@/components/agencia/panel-cobros";
import type { AgenciaContrato, AgenciaIngresoConEmpresa } from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Cobros · Agencia Fresafit" };

/* Lo que la agencia factura: cortes de contrato, migraciones y comisiones por
   referidos, con su ciclo calculado → cobrado → pagado. */
export default async function CobrosPage() {
  await exigirModulo("agencia-cobros");
  const { supabase, rol } = await usuarioActual();
  if (!puedeAdministrar(rol)) redirect("/tareas");

  const [ingresosRes, empresas, contratosRes] = await Promise.all([
    supabase
      .from("agencia_ingresos")
      .select("*, empresa:agencia_empresas!empresa_id(id, nombre, color)")
      /* Por periodo cuando lo hay y si no por captura: un cobro suelto sin
         periodo no debe hundirse al final de la lista. */
      .order("periodo_hasta", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .limit(500),
    empresasAgenciaActivas(),
    supabase.from("agencia_contratos").select("*").eq("activo", true),
  ]);

  return (
    <PanelCobros
      ingresos={(ingresosRes.data ?? []) as unknown as AgenciaIngresoConEmpresa[]}
      empresas={empresas}
      contratos={(contratosRes.data ?? []) as AgenciaContrato[]}
    />
  );
}
