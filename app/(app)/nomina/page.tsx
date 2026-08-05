import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { puedeAdministrar } from "@/lib/catalogos";
import { PanelNomina } from "@/components/nomina/panel";
import type {
  AgenciaEmpresa,
  NominaEmpleadoConEmpresa,
  NominaPagoConEmpleado,
  Profile,
} from "@/lib/types";

export const metadata = { title: "Nómina · Fresafit" };

/* La nómina de Fresafit: quien trabaja para la marca. Los que atienden a los
   clientes de la agencia van en /agencia/nomina, porque salen de otra bolsa.
   La misma tabla guarda a los dos (`empresa_id` null = Fresafit).

   Solo dirección: son sueldos. La RLS ya lo impide, pero sin este corte el resto
   vería una pantalla vacía sin entender por qué. */
export default async function NominaFresafitPage() {
  const { supabase, rol } = await usuarioActual();
  if (!puedeAdministrar(rol)) redirect("/tareas");

  const [empleadosRes, equipoRes] = await Promise.all([
    supabase
      .from("nomina_empleados")
      .select("*, empresa:agencia_empresas!empresa_id(id, nombre, color)")
      .is("empresa_id", null)
      .order("activo", { ascending: false })
      .order("monto", { ascending: false }),
    supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
  ]);

  const empleados = (empleadosRes.data ?? []) as unknown as NominaEmpleadoConEmpresa[];

  /* Los pagos se piden solo de esta gente: traerlos todos y filtrar en el
     navegador mandaría los sueldos de la agencia a una pantalla que no los pinta. */
  const ids = empleados.map((e) => e.id);
  const pagosRes = ids.length
    ? await supabase
        .from("nomina_pagos")
        .select("*, empleado:nomina_empleados!empleado_id(id, nombre, puesto)")
        .in("empleado_id", ids)
        .order("periodo_hasta", { ascending: false, nullsFirst: false })
        .order("created_at", { ascending: false })
        .limit(400)
    : { data: [] };

  return (
    <PanelNomina
      ambito="fresafit"
      empleados={empleados}
      pagos={(pagosRes.data ?? []) as unknown as NominaPagoConEmpleado[]}
      empresas={[] as AgenciaEmpresa[]}
      equipo={(equipoRes.data ?? []) as Profile[]}
    />
  );
}
