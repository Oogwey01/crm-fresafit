import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { armarReporte, type ReporteFresafit } from "@/lib/reportes/armar";
import { obtenerCanal, obtenerCategoriaGasto, puedeAdministrar } from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import { PanelReporteFresafit } from "@/components/reportes/panel-fresafit";

export const metadata = { title: "Reportes · Fresafit" };

/* El reporte del negocio, calculado por el CRM.

   A diferencia de los de la Agencia —que son un registro de qué se le entregó a
   cada cliente—, este se ARMA: ventas, gastos, nómina, cobros, pedidos e
   inventario del rango que se pida. El rango viaja en la URL para que el cálculo
   ocurra en el servidor (son ocho consultas agregadas) y para que un reporte
   concreto se pueda compartir con un enlace.

   Solo dirección: mezcla sueldos y márgenes. */
export default async function ReportesFresafitPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string }>;
}) {
  const { supabase, rol } = await usuarioActual();
  if (!puedeAdministrar(rol)) redirect("/tareas");

  const params = await searchParams;
  const hoy = hoyISO();
  /* Por defecto, el mes en curso: es el periodo por el que se pregunta el 90% de
     las veces. */
  const esFecha = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const desde = esFecha(params.desde) ? params.desde : hoy.slice(0, 8) + "01";
  const hasta = esFecha(params.hasta) ? params.hasta : hoy;
  const rango = desde <= hasta ? { desde, hasta } : { desde: hasta, hasta: desde };

  /* No se guarda nada: el reporte se recalcula cada vez que se pide. Quien
     quiera conservarlo se lleva el PDF o el CSV, que es lo que de verdad se
     comparte; una copia dentro del CRM solo sería una lista más que mantener. */
  const reporte = await armarReporte(
    supabase,
    rango,
    (id) => obtenerCanal(id)?.nombre ?? id,
    (id) => obtenerCategoriaGasto(id)?.nombre ?? id,
  );

  return <PanelReporteFresafit reporte={reporte as ReporteFresafit} />;
}
