import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { traerTodo } from "@/lib/canales/paginacion";
import { diasDesdeHoy } from "@/lib/fecha";
import { PanelFinanzas } from "@/components/finanzas/panel";
import { construirSugerencias, type GastoPrevio } from "@/lib/finanzas/sugerencias";
import { COLUMNAS_GASTO } from "@/lib/finanzas/consulta";
import type { ExpenseConComprobantes } from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Finanzas · Fresafit" };

/* Ventana de datos: cubre "mes pasado" y su comparativo (el antepasado). */
const DIAS_VENTANA = 120;

export default async function FinanzasPage() {
  /* La puerta del módulo (soloAdmin en el catálogo) ya corta a quien no lleva
     la administración; la RLS lo impide de fondo. usuarioActual() está cacheado:
     no repite el getUser() ni el perfil que ya pidió el layout. */
  await exigirModulo("finanzas");
  const { supabase } = await usuarioActual();

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
        .select(COLUMNAS_GASTO)
        .gte("fecha", desde)
        .order("fecha", { ascending: false })
        .order("created_at", { ascending: false })
        .order("id")
        .range(desdeFila, hastaFila) as unknown as PromiseLike<{
        data: ExpenseConComprobantes[] | null;
        error: { message: string } | null;
      }>,
    ),
    /* Entradas = ventas (Fase 2). No hay tabla de ingresos: se derivan.
       Ya sumadas por día en la base: `sales.monto` está fuera del alcance del
       token (ver 20260902000000) y, de paso, cuatro meses de ventas eran hasta
       5.000 filas viajando para hacer aquí una suma.

       Este módulo es de EGRESOS. Las ventas están aquí solo para poner las
       salidas en contexto, y ese contexto es medio cierre: quien captura los
       gastos no necesita saber contra cuánto se comparan. Para quien no ve
       los ingresos la consulta ni se hace — y el permiso encadena aquí dentro
       en vez de frenar en serie a las otras dos consultas. */
    vistaDinero().then((dinero) =>
      dinero.ingresos ? supabase.rpc("ingresos_por_dia", { desde }) : null,
    ),
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

  /* `null` —y no un array vacío— para que el panel distinga «no puedes verlas»
     de «no hubo ventas»: con cero ventas el saldo sí es un dato. */
  /* Si la función falla —lo más probable, que la migración aún no se haya
     pegado— también se pasa `null`: un array vacío pintaría «Entradas $0» y un
     saldo en rojo, que se leen como datos y no lo son. */
  const ventas =
    ventasRes && !ventasRes.error
      ? ((ventasRes.data ?? []) as { fecha: string; total: number }[]).map((d) => ({
          fecha: d.fecha,
          monto: Number(d.total),
        }))
      : null;
  if (ventasRes?.error) {
    console.warn("[finanzas] ingresos_por_dia no disponible:", ventasRes.error.message);
  }
  const sugerencias = construirSugerencias((previosRes.data ?? []) as GastoPrevio[]);

  return <PanelFinanzas gastos={gastos} ventas={ventas} sugerencias={sugerencias} />;
}
