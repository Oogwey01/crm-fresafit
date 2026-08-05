import { redirect } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { traerTodo } from "@/lib/canales/paginacion";
import { puedeAdministrar } from "@/lib/catalogos";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelFinanzas } from "@/components/finanzas/panel";
import { construirSugerencias, type GastoPrevio } from "@/lib/finanzas/sugerencias";
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
  if (!puedeAdministrar(rol)) redirect("/tareas");

  const desde = diasDesdeHoy(-DIAS_VENTANA);

  const [gastos, ventasRes, previosRes] = await Promise.all([
    /* Paginado con traerTodo aunque la ventana esté acotada a 120 días. Con un
       `select` a secas PostgREST cortaba en 1000 filas sin avisar y el panel
       habría sumado un total incompleto presentándolo como el del periodo —el
       peor error posible en finanzas—. Hoy los gastos de cuatro meses no llegan
       a mil, así que esto sigue siendo UNA sola consulta (traerTodo para en
       cuanto una tanda devuelve menos de 1000); la diferencia es que el día que
       una importación en lote los pase de mil, el total seguirá cuadrando en
       vez de mentir en silencio.
       El orden lleva `id` de desempate porque paginar por rangos necesita un
       criterio único y varios gastos comparten fecha y hasta instante de alta. */
    traerTodo<ExpenseConComprobantes>((desdeFila, hastaFila) =>
      supabase
        .from("expenses")
        .select("*, comprobantes:expense_receipts(*)")
        .gte("fecha", desde)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(desdeFila, hastaFila) as unknown as PromiseLike<{
        data: ExpenseConComprobantes[] | null;
        error: { message: string } | null;
      }>,
    ),
    /* Entradas = ventas (Fase 2). No hay tabla de ingresos: se derivan. */
    supabase
      .from("sales")
      .select("fecha, monto")
      .gte("fecha", desde)
      .or("estado.is.null,estado.neq.cancelado") // los cancelados no son ingreso
      .limit(5000),
    /* Todo el historial, no solo la ventana: las sugerencias del alta viven de
       cuántas veces se ha capturado cada concepto. Son cinco columnas cortas,
       así que el payload es mínimo; el limit es explícito porque PostgREST
       corta en 1000 sin avisar y, ordenando por fecha desc, ese corte deja
       justo lo más reciente, que es lo que conviene sugerir. */
    supabase
      .from("expenses")
      .select("fecha, concepto, categoria, proveedor, metodo_pago")
      .order("fecha", { ascending: false })
      .limit(1000),
  ]);

  const ventas = (ventasRes.data ?? []) as Pick<Sale, "fecha" | "monto">[];
  const sugerencias = construirSugerencias((previosRes.data ?? []) as GastoPrevio[]);

  return <PanelFinanzas gastos={gastos} ventas={ventas} sugerencias={sugerencias} />;
}
