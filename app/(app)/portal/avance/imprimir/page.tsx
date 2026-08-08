import { after } from "next/server";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { armarReportePeriodo, rangoDeParams } from "@/lib/avance/reporte";
import { registrarActividadEmpresa } from "@/lib/actividad";
import { ReportePeriodoImprimible } from "@/components/agencia-clientes/reporte-imprimible";
import { hoyISO } from "@/lib/fecha";
import type { AgenciaEmpresa } from "@/lib/types";

export const metadata = { title: "Reporte de periodo" };

/* El mismo reporte de periodo, abierto desde el portal. No recibe slug: un
   cliente imprime SU proyecto y nada más — la empresa sale de su perfil. El
   contenido llega ya recortado por la RLS de su sesión: lo interno no viaja, y
   por eso su PDF sale sin ello sin que este archivo filtre nada. */
export default async function ImprimirPeriodoPortalPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  await exigirModulo("portal-avance");
  const { supabase, user, perfil } = await usuarioActual();
  const empresaId = perfil?.empresa_id ?? "";

  const { data: empresaData } = await supabase
    .from("agencia_empresas")
    .select("id, nombre, slug, color, giro")
    .eq("id", empresaId)
    .maybeSingle();
  const empresa = (empresaData ?? {
    id: empresaId,
    nombre: "Tu proyecto",
    slug: "",
    color: "#e84393",
    giro: null,
  }) as Pick<AgenciaEmpresa, "id" | "nombre" | "slug" | "color" | "giro">;

  const rango = rangoDeParams(await searchParams, hoyISO());
  const reporte = await armarReportePeriodo(supabase, empresaId, rango);

  after(async () => {
    if (!user) return;
    await registrarActividadEmpresa(supabase, {
      empresaId,
      actorId: user.id,
      actorNombre: perfil?.nombre ?? null,
      accion: "reporte_exportado",
      entidad: "reporte",
      detalle: { desde: rango.desde, hasta: rango.hasta },
    });
  });

  return (
    <ReportePeriodoImprimible
      empresa={empresa}
      rango={rango}
      datos={reporte.datos}
      cerradas={reporte.cerradas}
      pendientes={reporte.pendientes}
      generadoPor={perfil?.nombre ?? "—"}
    />
  );
}
