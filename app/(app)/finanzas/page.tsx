import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelFinanzas } from "@/components/finanzas/panel";
import type { ExpenseConComprobantes, RolId, Sale } from "@/lib/types";

export const metadata = { title: "Finanzas · Fresafit" };

/* Ventana de datos: cubre "mes pasado" y su comparativo (el antepasado). */
const DIAS_VENTANA = 120;

export default async function FinanzasPage() {
  /* Guarda de rol: solo Dirección. La BD ya lo impide con RLS (no vería una
     sola fila), pero se corta aquí para no mostrar un panel vacío y confuso.
     usuarioActual() está cacheado: no repite el getUser() ni el perfil que ya
     pidió el layout, así que la guarda ya no cuesta roundtrips extra. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;
  if (rol !== "direccion") redirect("/tareas");

  const desde = diasDesdeHoy(-DIAS_VENTANA);

  const [gastosRes, ventasRes] = await Promise.all([
    supabase
      .from("expenses")
      .select("*, comprobantes:expense_receipts(*)")
      .gte("fecha", desde)
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false }),
    /* Entradas = ventas (Fase 2). No hay tabla de ingresos: se derivan. */
    supabase
      .from("sales")
      .select("fecha, monto")
      .gte("fecha", desde)
      .or("estado.is.null,estado.neq.cancelado") // los cancelados no son ingreso
      .limit(5000),
  ]);

  const gastos = (gastosRes.data ?? []) as unknown as ExpenseConComprobantes[];
  const ventas = (ventasRes.data ?? []) as Pick<Sale, "fecha" | "monto">[];

  return <PanelFinanzas gastos={gastos} ventas={ventas} />;
}
