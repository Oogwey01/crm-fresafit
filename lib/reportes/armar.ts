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
import { traerTodo } from "@/lib/canales/paginacion";

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

const redondear = (n: number) => Math.round(n * 100) / 100;

function sumarPor<T>(
  filas: T[],
  clave: (f: T) => string,
  monto: (f: T) => number,
  nombre: (c: string) => string,
): LineaCategoria[] {
  const m = new Map<string, { monto: number; cantidad: number }>();
  for (const f of filas) {
    const k = clave(f);
    const acc = m.get(k) ?? { monto: 0, cantidad: 0 };
    acc.monto += monto(f);
    acc.cantidad++;
    m.set(k, acc);
  }
  return [...m.entries()]
    .map(([clave, v]) => ({ clave, nombre: nombre(clave), monto: redondear(v.monto), cantidad: v.cantidad }))
    .sort((a, b) => b.monto - a.monto);
}

type Cliente = SupabaseClient;

/* Formas de las filas que se leen. Van aquí arriba porque las consultas
   paginadas las necesitan al construirse. */
type FilaVenta = {
  canal: string;
  monto: number;
  cantidad: number;
  origen: string;
  cliente_id: string | null;
  producto: { nombre: string; variante: string | null } | null;
};

type IngresoAg = {
  total: number;
  fondo_delegado: number;
  estado: string;
  pagado_at: string | null;
  periodo_hasta: string | null;
  created_at: string;
};

type Prod = {
  stock: number;
  stock_minimo: number;
  costo: number | null;
  activo: boolean;
  bajo_pedido: boolean;
  descontinuado: boolean;
};

/* Bruto de ventas de un rango, con la misma regla que Métricas: el total de la
   orden cuando el canal lo reporta, y la suma de renglones cuando no. */
function brutoDeVentas(
  ordenes: { canal: string; total: number }[],
  renglones: { canal: string; monto: number; origen: string }[],
): { total: number; porCanal: Map<string, number> } {
  const porCanal = new Map<string, number>();
  const conOrden = new Set<string>();
  for (const o of ordenes) {
    conOrden.add(o.canal);
    porCanal.set(o.canal, (porCanal.get(o.canal) ?? 0) + Number(o.total || 0));
  }
  for (const v of renglones) {
    if (v.origen === "api" && conOrden.has(v.canal)) continue;
    porCanal.set(v.canal, (porCanal.get(v.canal) ?? 0) + Number(v.monto || 0));
  }
  let total = 0;
  for (const v of porCanal.values()) total += v;
  return { total: redondear(total), porCanal };
}

export async function armarReporte(
  supabase: Cliente,
  rango: Rango,
  nombreCanal: (id: string) => string,
  nombreCategoria: (id: string) => string,
): Promise<ReporteFresafit> {
  const previo = periodoAnterior(rango);

  /* Todo en paralelo: son consultas independientes contra tablas distintas y en
     serie la página tardaría la suma de todas. */
  const [
    ventasRes,
    ventasPrevRes,
    ordenesRes,
    ordenesPrevRes,
    gastosRes,
    gastosPrevRes,
    nominaRes,
    ingresosAgRes,
    pedidosRes,
    clientesRes,
    productosRes,
  ] = await Promise.all([
    /* Paginado: PostgREST corta en 1000 filas SIN avisar, y un mes bueno pasa de
       mil renglones. Sin esto el reporte salía corto y nadie se enteraba. */
    traerTodo<FilaVenta>((d, h) =>
      supabase
        .from("sales")
        .select("canal, monto, cantidad, origen, cliente_id, producto:products!producto_id(nombre, variante)")
        .gte("fecha", rango.desde)
        .lte("fecha", rango.hasta)
        .or("estado.is.null,estado.neq.cancelado")
        .range(d, h) as unknown as PromiseLike<{ data: FilaVenta[] | null; error: { message: string } | null }>,
    ),
    traerTodo<{ canal: string; monto: number; origen: string }>((d, h) =>
      supabase
        .from("sales")
        .select("canal, monto, origen")
        .gte("fecha", previo.desde)
        .lte("fecha", previo.hasta)
        .or("estado.is.null,estado.neq.cancelado")
        .range(d, h),
    ),
    traerTodo<{ canal: string; total: number }>((d, h) =>
      supabase
        .from("sale_orders")
        .select("canal, total")
        .gte("fecha", rango.desde)
        .lte("fecha", rango.hasta)
        .neq("estado", "cancelled")
        .range(d, h),
    ),
    traerTodo<{ canal: string; total: number }>((d, h) =>
      supabase
        .from("sale_orders")
        .select("canal, total")
        .gte("fecha", previo.desde)
        .lte("fecha", previo.hasta)
        .neq("estado", "cancelled")
        .range(d, h),
    ),
    traerTodo<{ categoria: string; monto: number }>((d, h) =>
      supabase
        .from("expenses")
        .select("categoria, monto")
        .gte("fecha", rango.desde)
        .lte("fecha", rango.hasta)
        .range(d, h),
    ),
    traerTodo<{ monto: number }>((d, h) =>
      supabase
        .from("expenses")
        .select("monto")
        .gte("fecha", previo.desde)
        .lte("fecha", previo.hasta)
        .range(d, h),
    ),
    /* Nómina PAGADA en el periodo: dinero que efectivamente salió. */
    traerTodo<{ monto: number }>((d, h) =>
      supabase
        .from("nomina_pagos")
        .select("monto")
        .eq("estado", "pagado")
        .gte("fecha_pago", rango.desde)
        .lte("fecha_pago", rango.hasta)
        .range(d, h),
    ),
    traerTodo<IngresoAg>((d, h) =>
      supabase
        .from("agencia_ingresos")
        .select("total, fondo_delegado, estado, pagado_at, periodo_hasta, created_at")
        .neq("estado", "cancelado")
        .range(d, h),
    ),
    traerTodo<{ estado: string; fecha: string }>((d, h) =>
      supabase
        .from("sales")
        .select("estado, fecha")
        .not("estado", "is", null)
        .gte("fecha", rango.desde)
        .lte("fecha", rango.hasta)
        .range(d, h),
    ),
    /* Solo hace falta CUÁNTOS son: pedir las filas devolvía 1000 como tope y el
       reporte informaba "1000 clientes nuevos" cuando eran 2 447. */
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .gte("created_at", rango.desde)
      .lte("created_at", rango.hasta + "T23:59:59"),
    traerTodo<Prod>((d, h) =>
      supabase
        .from("products")
        .select("stock, stock_minimo, costo, activo, bajo_pedido, descontinuado")
        .range(d, h),
    ),
  ]);

  const ventas = ventasRes;
  const ventasPrev = ventasPrevRes;
  const ordenes = ordenesRes;
  const ordenesPrev = ordenesPrevRes;

  const bruto = brutoDeVentas(ordenes, ventas);
  const brutoPrev = brutoDeVentas(ordenesPrev, ventasPrev.map((v) => ({ ...v, cantidad: 0 })));

  /* --- Gastos --- */
  const gastos = gastosRes;
  const totalGastos = redondear(gastos.reduce((a, g) => a + Number(g.monto || 0), 0));
  const totalGastosPrev = redondear(gastosPrevRes.reduce((a, g) => a + Number(g.monto || 0), 0));

  /* --- Nómina --- */
  const nomina = redondear(nominaRes.reduce((a, p) => a + Number(p.monto || 0), 0));

  /* --- Agencia --- */
  const ingresosAg = ingresosAgRes;
  const honorarios = (i: IngresoAg) => Math.max(0, Number(i.total || 0) - Number(i.fondo_delegado || 0));
  /* Un cobro cuenta en el periodo en que ENTRÓ el dinero; los que aún no se
     pagan se miran aparte, no se mezclan con lo cobrado. */
  const enRangoFecha = (f: string | null) => !!f && f.slice(0, 10) >= rango.desde && f.slice(0, 10) <= rango.hasta;
  const agenciaCobrado = redondear(
    ingresosAg.filter((i) => i.estado === "pagado" && enRangoFecha(i.pagado_at)).reduce((a, i) => a + honorarios(i), 0),
  );
  const agenciaPorCobrar = redondear(
    ingresosAg.filter((i) => i.estado === "cobrado").reduce((a, i) => a + honorarios(i), 0),
  );
  const agenciaSinFacturar = redondear(
    ingresosAg.filter((i) => i.estado === "calculado").reduce((a, i) => a + honorarios(i), 0),
  );

  /* --- Ventas: piezas, ticket y productos --- */
  const piezas = ventas.reduce((a, v) => a + (v.cantidad || 0), 0);
  const ordenesCuenta = ordenes.length > 0 ? ordenes.length : ventas.length;
  const productos = sumarPor(
    ventas.filter((v) => v.producto),
    (v) => `${v.producto!.nombre}${v.producto!.variante ? ` · ${v.producto!.variante}` : ""}`,
    (v) => Number(v.monto || 0),
    (c) => c,
  ).slice(0, 8);
  const piezasPorProducto = new Map<string, number>();
  for (const v of ventas) {
    if (!v.producto) continue;
    const k = `${v.producto.nombre}${v.producto.variante ? ` · ${v.producto.variante}` : ""}`;
    piezasPorProducto.set(k, (piezasPorProducto.get(k) ?? 0) + (v.cantidad || 0));
  }

  /* --- Pedidos --- */
  const pedidosFilas = pedidosRes;
  const cuenta = (e: string) => pedidosFilas.filter((p) => p.estado === e).length;
  /* Atrasado = sigue sin entregarse y ya pasaron más de 3 días desde la venta,
     el mismo criterio que usa la pantalla de Pedidos. */
  const limiteAtraso = correr(new Date().toISOString().slice(0, 10), -3);
  const atrasados = pedidosFilas.filter(
    (p) => p.estado !== "entregado" && p.estado !== "cancelado" && p.fecha < limiteAtraso,
  ).length;

  /* --- Inventario (foto de HOY, no del periodo: el stock no tiene historia) --- */
  const prods = productosRes.filter((p) => p.activo && !p.bajo_pedido && !p.descontinuado);
  const valorStock = redondear(prods.reduce((a, p) => a + (p.stock || 0) * Number(p.costo || 0), 0));

  const ingresosTotal = redondear(bruto.total + agenciaCobrado);
  const egresosTotal = redondear(totalGastos + nomina);
  const resultado = redondear(ingresosTotal - egresosTotal);

  return {
    rango,
    comparado: previo,
    ingresos: {
      ventas: bruto.total,
      ventasAnterior: brutoPrev.total,
      porCanal: [...bruto.porCanal.entries()]
        .map(([clave, monto]) => ({
          clave,
          nombre: nombreCanal(clave),
          monto: redondear(monto),
          cantidad: ventas.filter((v) => v.canal === clave).length,
        }))
        .sort((a, b) => b.monto - a.monto),
      agencia: agenciaCobrado,
      total: ingresosTotal,
    },
    egresos: {
      gastos: totalGastos,
      gastosAnterior: totalGastosPrev,
      porCategoria: sumarPor(gastos, (g) => g.categoria, (g) => Number(g.monto || 0), nombreCategoria),
      nomina,
      total: egresosTotal,
    },
    resultado,
    margen: ingresosTotal > 0 ? redondear((resultado / ingresosTotal) * 100) : null,
    ventas: {
      ordenes: ordenesCuenta,
      piezas,
      ticket: ordenesCuenta > 0 ? redondear(bruto.total / ordenesCuenta) : 0,
      productos: productos.map((p) => ({
        nombre: p.nombre,
        piezas: piezasPorProducto.get(p.clave) ?? 0,
        monto: p.monto,
      })),
    },
    pedidos: {
      nuevos: cuenta("nuevo"),
      preparando: cuenta("preparando"),
      enviados: cuenta("enviado"),
      entregados: cuenta("entregado"),
      atrasados,
    },
    clientes: {
      nuevos: clientesRes.count ?? 0,
      conCompra: new Set(ventas.map((v) => v.cliente_id).filter(Boolean)).size,
    },
    inventario: {
      productos: prods.length,
      bajoMinimo: prods.filter((p) => p.stock <= p.stock_minimo).length,
      sinStock: prods.filter((p) => p.stock <= 0).length,
      valorStock,
    },
    agencia: {
      cobrado: agenciaCobrado,
      porCobrar: agenciaPorCobrar,
      sinFacturar: agenciaSinFacturar,
    },
  };
}
