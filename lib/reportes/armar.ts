/* ============================================================================
   lib/reportes/armar.ts — El reporte de Fresafit, calculado desde el CRM
   ----------------------------------------------------------------------------
   Todo lo que hace falta para cerrar un periodo ya está en la base repartido en
   seis módulos: ventas, gastos, nómina, cobros de la agencia, pedidos e
   inventario. Armarlo a mano significaba abrir seis pantallas y sumar aparte.

   Este módulo hace ese trabajo: recibe un rango de fechas y devuelve el reporte
   completo, con la comparación contra el periodo anterior de la misma duración.

   Dos decisiones que conviene tener presentes al leer los números:

   · Los ingresos de ventas salen de `sale_orders` (el bruto que reportan los
     paneles de los canales, con envío y descuentos) y caen a la suma de
     renglones para los canales que no tengan órdenes importadas. Es la misma
     regla que usa Métricas, para que los dos módulos nunca se contradigan.

   · La nómina cuenta lo PAGADO en el periodo, no lo devengado: es dinero que
     salió, que es lo que se compara contra el dinero que entró.

   Solo servidor.
   ============================================================================ */

import type { SupabaseClient } from "@supabase/supabase-js";
import { DIAS_ATRASO_PEDIDO } from "@/lib/fecha";

type Cliente = SupabaseClient;

export type Rango = { desde: string; hasta: string };

export type LineaCategoria = {
  clave: string;
  nombre: string;
  monto: number;
  cantidad: number;
};

export type ReporteFresafit = {
  rango: Rango;
  comparado: Rango;

  /* --- Dinero --- */
  ingresos: {
    ventas: number;
    ventasAnterior: number;
    porCanal: LineaCategoria[];
    /* Honorarios de la agencia efectivamente pagados en el periodo. Entran aquí
       porque es dinero que entró al mismo bolsillo, aunque venga del otro
       negocio; va desglosado para que no se confunda con venta de producto. */
    agencia: number;
    total: number;
  };
  egresos: {
    gastos: number;
    gastosAnterior: number;
    porCategoria: LineaCategoria[];
    nomina: number;
    total: number;
  };
  resultado: number;
  margen: number | null; // % sobre ingresos, null si no hubo ingresos

  /* --- Operación --- */
  ventas: {
    ordenes: number;
    piezas: number;
    ticket: number;
    productos: { nombre: string; piezas: number; monto: number }[];
  };
  pedidos: { nuevos: number; preparando: number; enviados: number; entregados: number; atrasados: number };
  clientes: { nuevos: number; conCompra: number };
  inventario: { productos: number; bajoMinimo: number; valorStock: number; sinStock: number };

  /* --- Agencia (contexto, no es de Fresafit) --- */
  agencia: { cobrado: number; porCobrar: number; sinFacturar: number };
};

/* Días que dura el rango, para poder construir el periodo anterior de la misma
   longitud (comparar julio contra un junio truncado no dice nada). */
function diasDe(r: Rango): number {
  const a = Date.parse(r.desde + "T00:00:00Z");
  const b = Date.parse(r.hasta + "T00:00:00Z");
  return Math.max(1, Math.round((b - a) / 86_400_000) + 1);
}

function correr(iso: string, dias: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function periodoAnterior(r: Rango): Rango {
  const n = diasDe(r);
  return { desde: correr(r.desde, -n), hasta: correr(r.desde, -1) };
}

/* Lo que devuelve la función `reporte_fresafit` de la base: el reporte entero
   menos las etiquetas legibles de canal y categoría, que se ponen aquí porque
   son cosa del catálogo de la aplicación y no de los datos. */
type ReporteCrudo = Omit<ReporteFresafit, "rango" | "comparado" | "ingresos" | "egresos"> & {
  ingresos: Omit<ReporteFresafit["ingresos"], "porCanal"> & {
    porCanal: Omit<LineaCategoria, "nombre">[];
  };
  egresos: Omit<ReporteFresafit["egresos"], "porCategoria"> & {
    porCategoria: Omit<LineaCategoria, "nombre">[];
  };
};

/* El corte de «pedido atrasado»: más de tres días desde la venta sin entregar,
   el mismo criterio que usa la pantalla de Pedidos.

   Se calcula aquí, y no dentro de la función de la base, para que el día de
   referencia sea uno solo y explícito en vez de quedar a merced de la zona
   horaria del servidor. Dicho eso: esta cuenta parte del día UTC, igual que la
   versión anterior de la que se copió, así que entre las 18:00 y la medianoche
   de México el corte va un día adelantado. Se conserva tal cual a propósito
   —cambiarlo movería la cifra de «atrasados» respecto a los reportes ya
   emitidos—, pero conviene saberlo: el arreglo, cuando toque, es usar `hoyISO()`
   de lib/fecha, que sí resuelve el día en hora de México. */
function limiteDeAtraso(): string {
  return correr(new Date().toISOString().slice(0, 10), -DIAS_ATRASO_PEDIDO);
}

export async function armarReporte(
  supabase: Cliente,
  rango: Rango,
  nombreCanal: (id: string) => string,
  nombreCategoria: (id: string) => string,
): Promise<ReporteFresafit> {
  const previo = periodoAnterior(rango);

  /* Una sola llamada. Antes eran diez lecturas paginadas contra seis tablas
     —incluido el catálogo entero, solo para multiplicar stock por costo— y una
     tanda de sumas en memoria. Los criterios no cambiaron: se mudaron a
     `20260827000000_reporte_fresafit.sql`, que los documenta uno por uno. */
  const { data, error } = await supabase.rpc("reporte_fresafit", {
    desde: rango.desde,
    hasta: rango.hasta,
    desde_prev: previo.desde,
    hasta_prev: previo.hasta,
    limite_atraso: limiteDeAtraso(),
  });
  if (error) throw new Error(error.message);

  const r = data as ReporteCrudo;

  return {
    ...r,
    rango,
    comparado: previo,
    ingresos: {
      ...r.ingresos,
      porCanal: r.ingresos.porCanal.map((l) => ({ ...l, nombre: nombreCanal(l.clave) })),
    },
    egresos: {
      ...r.egresos,
      porCategoria: r.egresos.porCategoria.map((l) => ({ ...l, nombre: nombreCategoria(l.clave) })),
    },
  };
}
