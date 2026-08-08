import { notFound } from "next/navigation";
import { after } from "next/server";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { armarReportePeriodo, rangoDeParams } from "@/lib/avance/reporte";
import { registrarActividadEmpresa } from "@/lib/actividad";
import { ReportePeriodoImprimible } from "@/components/agencia-clientes/reporte-imprimible";
import { hoyISO } from "@/lib/fecha";
import type { AgenciaEmpresa } from "@/lib/types";

export const metadata = { title: "Reporte de periodo · Fresafit" };

/* El reporte de periodo, del lado del equipo. La versión del cliente vive en
   /portal/avance/imprimir (el layout de /agencia lo expulsa de esta ruta) y
   ambas llaman a `armarReportePeriodo`: mismo reporte, cada sesión con su RLS.

   Mismo oficio que /reportes/imprimir: A4 + window.print(), el PDF lo hace el
   navegador. */
export default async function ImprimirPeriodoPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  await exigirModulo("agencia-clientes");
  const { supabase, user, perfil } = await usuarioActual();

  const { slug } = await params;
  const { data: empresaData } = await supabase
    .from("agencia_empresas")
    .select("id, nombre, slug, color, giro")
    .eq("slug", slug)
    .maybeSingle();
  if (!empresaData) notFound();
  const empresa = empresaData as Pick<AgenciaEmpresa, "id" | "nombre" | "slug" | "color" | "giro">;

  const rango = rangoDeParams(await searchParams, hoyISO());
  const reporte = await armarReportePeriodo(supabase, empresa.id, rango);

  /* Exportar el reporte queda en el expediente: es el documento que se cita en
     juntas, y conviene saber qué versión vio quién y cuándo. */
  after(async () => {
    if (!user) return;
    await registrarActividadEmpresa(supabase, {
      empresaId: empresa.id,
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
