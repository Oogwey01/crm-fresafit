import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { equipoCompleto } from "@/lib/supabase/consultas";
import { PanelEmpresas } from "@/components/agencia/panel-empresas";
import type {
  AgenciaAsignacionConPersona,
  AgenciaContrato,
  AgenciaEmpresa,
  AgenciaIngreso,
} from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Empresas · Agencia Fresafit" };

/* Los negocios que atiende la agencia, con su contrato y su equipo.
   Solo dirección: la RLS ya lo impide, pero sin este corte el resto vería una
   pantalla vacía sin entender por qué. */
export default async function EmpresasPage() {
  await exigirModulo("agencia-empresas");
  const { supabase } = await usuarioActual();

  const [empresasRes, contratosRes, asignacionesRes, equipo, ingresosRes] = await Promise.all([
    supabase.from("agencia_empresas").select("*").order("activa", { ascending: false }).order("nombre"),
    supabase.from("agencia_contratos").select("*").order("activo", { ascending: false }),
    supabase
      .from("agencia_asignaciones")
      .select("*, persona:profiles!profile_id(id, nombre, color)")
      .eq("activo", true),
    equipoCompleto(),
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
      equipo={equipo}
      ingresos={(ingresosRes.data ?? []) as Pick<
        AgenciaIngreso,
        "empresa_id" | "total" | "fondo_delegado" | "estado" | "periodo_hasta" | "created_at"
      >[]}
    />
  );
}
