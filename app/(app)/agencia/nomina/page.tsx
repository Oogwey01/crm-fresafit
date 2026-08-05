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

export const metadata = { title: "Nómina de la Agencia · Fresafit" };

/* Lo que cuesta atender a los clientes de la agencia: solo quien tiene una
   empresa asignada. La nómina de la marca vive en /nomina. */
export default async function NominaAgenciaPage() {
  const { supabase, rol } = await usuarioActual();
  if (!puedeAdministrar(rol)) redirect("/tareas");

  const [empleadosRes, empresasRes, equipoRes] = await Promise.all([
    supabase
      .from("nomina_empleados")
      .select("*, empresa:agencia_empresas!empresa_id(id, nombre, color)")
      .not("empresa_id", "is", null)
      .order("activo", { ascending: false })
      .order("nombre"),
    supabase.from("agencia_empresas").select("*").eq("activa", true).order("nombre"),
    supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
  ]);

  const empleados = (empleadosRes.data ?? []) as unknown as NominaEmpleadoConEmpresa[];

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
      ambito="agencia"
      empleados={empleados}
      pagos={(pagosRes.data ?? []) as unknown as NominaPagoConEmpleado[]}
      empresas={(empresasRes.data ?? []) as AgenciaEmpresa[]}
      equipo={(equipoRes.data ?? []) as Profile[]}
    />
  );
}
