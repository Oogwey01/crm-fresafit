import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { PanelEmpresas } from "@/components/agencia/panel-empresas";
import type {
  AgenciaAsignacionConPersona,
  AgenciaContrato,
  AgenciaEmpresa,
  AgenciaIngreso,
  Profile,
} from "@/lib/types";

export const metadata = { title: "Empresas · Agencia Fresafit" };

/* Los negocios que atiende la agencia, con su contrato y su equipo.
   Solo dirección: la RLS ya lo impide, pero sin este corte el resto vería una
   pantalla vacía sin entender por qué. */
export default async function EmpresasPage() {
  const { supabase, rol } = await usuarioActual();
  if (rol !== "direccion") redirect("/tareas");

  const [empresasRes, contratosRes, asignacionesRes, equipoRes, ingresosRes] = await Promise.all([
    supabase.from("agencia_empresas").select("*").order("activa", { ascending: false }).order("nombre"),
    supabase.from("agencia_contratos").select("*").order("activo", { ascending: false }),
    supabase
      .from("agencia_asignaciones")
      .select("*, persona:profiles!profile_id(id, nombre, color)")
      .eq("activo", true),
    supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
    /* Solo lo cobrado y pagado del año, para la columna de "cuánto lleva
       dejando" de cada empresa. Se agrega en el cliente: son decenas de filas. */
    supabase
      .from("agencia_ingresos")
      .select("empresa_id, total, fondo_delegado, estado, periodo_hasta, created_at")
      .neq("estado", "cancelado"),
  ]);

  return (
    <PanelEmpresas
      empresas={(empresasRes.data ?? []) as AgenciaEmpresa[]}
      contratos={(contratosRes.data ?? []) as AgenciaContrato[]}
      asignaciones={(asignacionesRes.data ?? []) as unknown as AgenciaAsignacionConPersona[]}
      equipo={(equipoRes.data ?? []) as Profile[]}
      ingresos={(ingresosRes.data ?? []) as Pick<
        AgenciaIngreso,
        "empresa_id" | "total" | "fondo_delegado" | "estado" | "periodo_hasta" | "created_at"
      >[]}
    />
  );
}
