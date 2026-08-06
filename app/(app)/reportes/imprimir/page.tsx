import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { armarReporte } from "@/lib/reportes/armar";
import { esDireccion, obtenerCanal, obtenerCategoriaGasto } from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import { ReporteImprimible } from "@/components/reportes/imprimible";

export const metadata = { title: "Reporte · Fresafit" };

/* Vista de impresión del reporte: la misma información que la pantalla, pero
   maquetada para papel (A4) y con los colores de la marca.

   Es una ruta aparte y no un `@media print` sobre el panel porque el papel pide
   otra cosa: sin menú, sin botones, con encabezado propio y bloques que no se
   parten a la mitad entre página y página. El PDF sale del propio navegador
   ("Guardar como PDF"), así que el texto queda seleccionable y el archivo pesa
   kilobytes — un PDF rasterizado con html2canvas pesaría megas y se vería
   borroso al hacer zoom. */
export default async function ImprimirReportePage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const { supabase, rol, perfil } = await usuarioActual();
  if (!esDireccion(rol)) redirect("/tareas");

  const params = await searchParams;
  const hoy = hoyISO();
  const esFecha = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const desde = esFecha(params.desde) ? params.desde : hoy.slice(0, 8) + "01";
  const hasta = esFecha(params.hasta) ? params.hasta : hoy;
  const rango = desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };

  const reporte = await armarReporte(
    supabase,
    rango,
    (id) => obtenerCanal(id)?.nombre ?? id,
    (id) => obtenerCategoriaGasto(id)?.nombre ?? id,
  );

  return <ReporteImprimible reporte={reporte} generadoPor={perfil?.nombre ?? ""} />;
}
