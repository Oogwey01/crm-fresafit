"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { textoONulo } from "@/lib/validacion";
import { importarVentasTN } from "@/lib/tiendanube/ventas";
import { COLUMNAS_VENTA_METRICAS, VENTAS_POR_PAGINA } from "@/lib/metricas";
import type {
  CanalId,
  Customer,
  Product,
  ResumenMetricas,
  VentaMetricas,
} from "@/lib/types";

export type VentaInput = {
  fecha: string;
  canal: CanalId;
  producto_id: string | null;
  descripcion: string; // para ventas de productos fuera del catálogo
  cantidad: number;
  monto: number;
  cliente_id: string | null;
  notas: string;
};

const RUTAS_VENTAS = ["/metricas", "/clientes"];

function validarVenta(input: VentaInput): string | null {
  if (!input.fecha) return "Falta la fecha de la venta.";
  if (!input.producto_id && !input.descripcion.trim())
    return "Elige un producto o describe qué se vendió.";
  if (!Number.isInteger(input.cantidad) || input.cantidad <= 0)
    return "La cantidad debe ser un entero mayor a cero.";
  if (!Number.isFinite(input.monto) || input.monto < 0) return "El monto no puede ser negativo.";
  return null;
}

/* Columnas comunes del insert (registrar) y el update (editar) de una venta;
   cada action añade lo suyo (origen/created_by). */
function filaDeVenta(input: VentaInput) {
  return {
    fecha: input.fecha,
    canal: input.canal,
    producto_id: input.producto_id,
    descripcion: textoONulo(input.descripcion),
    cantidad: input.cantidad,
    monto: input.monto,
    cliente_id: input.cliente_id,
    notas: textoONulo(input.notas),
  };
}

export async function registrarVenta(input: VentaInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede registrar ventas.");
  if ("error" in cx) return cx;

  const invalido = validarVenta(input);
  if (invalido) return { error: invalido };

  const { error } = await cx.supabase.from("sales").insert({
    ...filaDeVenta(input),
    origen: "manual",
    created_by: cx.user.id,
  });
  if (error) return { error: error.message };
  RUTAS_VENTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}

export async function editarVenta(id: string, input: VentaInput): Promise<Resultado> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede editar ventas.");
  if ("error" in cx) return cx;

  const invalido = validarVenta(input);
  if (invalido) return { error: invalido };

  /* Las ventas traídas de un canal las gobierna la plataforma. Editar su precio
     o su cantidad aquí descuadraba el CRM contra el canal de forma permanente:
     la re-sincronización no reescribe renglones ya existentes, así que el cambio
     no se revertía nunca y nadie se enteraba. Se permiten solo los campos que sí
     son del equipo (cliente y notas); del resto manda el canal.
     La RLS refuerza lo mismo, esto es la defensa en profundidad de siempre. */
  const { data: actual, error: errLeer } = await cx.supabase
    .from("sales")
    .select("origen")
    .eq("id", id)
    .single();
  if (errLeer) return { error: errLeer.message };

  const esImportada = actual?.origen === "api";
  const cambios =
    esImportada && cx.rol !== "direccion"
      ? { cliente_id: input.cliente_id, notas: textoONulo(input.notas) }
      : filaDeVenta(input);

  const { error } = await cx.supabase.from("sales").update(cambios).eq("id", id);
  if (error) return { error: error.message };
  RUTAS_VENTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}

export async function borrarVenta(id: string): Promise<Resultado> {
  const cx = await exigirRol("gestor", "Solo dirección o coordinación puede borrar ventas.");
  if ("error" in cx) return cx;

  const { error } = await cx.supabase.from("sales").delete().eq("id", id);
  if (error) return { error: error.message };
  RUTAS_VENTAS.forEach((r) => revalidatePath(r));
  return { ok: true };
}

/* --- Lectura del panel -----------------------------------------------------
   El panel ya no recibe las ventas del año para sumarlas en el navegador: pide
   las cifras ya hechas cada vez que cambian el periodo o la plataforma. Son dos
   llamadas: `metricas_resumen` para todo lo agregado y `listarVentas` para la
   tabla de renglones, que se pagina.                                         */

export type DatosMetricas = {
  actual: ResumenMetricas;
  /* Solo se usa para los comparativos («vs. mes pasado»). */
  anterior: ResumenMetricas;
  /* Los últimos 14 días de la gráfica, que son fijos y no siguen al periodo
     elegido — pero sí a la plataforma. */
  dias: ResumenMetricas["por_dia"];
};

/* Un canal vacío significa «todas las plataformas»: el RPC recibe null. */
function canalONulo(canal: string | null | undefined): string | null {
  return !canal || canal === "todas" ? null : canal;
}

export async function obtenerMetricas(
  rango: { desde: string; hasta: string },
  anterior: { desde: string; hasta: string },
  ventana: { desde: string; hasta: string },
  canal: string,
): Promise<{ ok: true; datos: DatosMetricas } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede ver las métricas.");
  if ("error" in cx) return cx;

  const c = canalONulo(canal);
  const [act, ant, ven] = await Promise.all([
    cx.supabase.rpc("metricas_resumen", { desde: rango.desde, hasta: rango.hasta, canal_f: c }),
    cx.supabase.rpc("metricas_resumen", { desde: anterior.desde, hasta: anterior.hasta, canal_f: c }),
    cx.supabase.rpc("metricas_resumen", { desde: ventana.desde, hasta: ventana.hasta, canal_f: c }),
  ]);

  const fallo = act.error ?? ant.error ?? ven.error;
  if (fallo) return { error: fallo.message };

  return {
    ok: true,
    datos: {
      actual: act.data as ResumenMetricas,
      anterior: ant.data as ResumenMetricas,
      dias: (ven.data as ResumenMetricas).por_dia,
    },
  };
}

/* Una página de renglones del periodo, en el mismo orden que tenía la tabla. */
export async function listarVentas(
  rango: { desde: string; hasta: string },
  canal: string,
  desplazamiento: number,
): Promise<{ ok: true; ventas: VentaMetricas[] } | { error: string }> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede ver las métricas.");
  if ("error" in cx) return cx;

  let q = cx.supabase
    .from("sales")
    .select(COLUMNAS_VENTA_METRICAS)
    .gte("fecha", rango.desde)
    .lte("fecha", rango.hasta)
    .or("estado.is.null,estado.neq.cancelado"); // igual que el resumen

  const c = canalONulo(canal);
  if (c) q = q.eq("canal", c);

  const { data, error } = await q
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range(desplazamiento, desplazamiento + VENTAS_POR_PAGINA - 1);

  if (error) return { error: error.message };
  return { ok: true, ventas: (data ?? []) as unknown as VentaMetricas[] };
}

/* Catálogo y clientes para los dos buscadores del diálogo de venta.

   Viajaban con la página: dos mil productos y dos mil y pico de clientes que se
   serializaban en CADA carga de Métricas para alimentar dos campos que casi
   nadie abre, y que además solo buscan a partir de dos letras. Ahora se piden al
   abrir el diálogo, que es cuando de verdad hacen falta. */
export async function catalogoVenta(): Promise<
  | {
      ok: true;
      productos: Pick<Product, "id" | "nombre" | "variante" | "sku" | "precio" | "activo">[];
      clientes: Pick<Customer, "id" | "nombre" | "correo" | "telefono">[];
    }
  | { error: string }
> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede registrar ventas.");
  if ("error" in cx) return cx;

  const [productosRes, clientesRes] = await Promise.all([
    cx.supabase
      .from("products")
      .select("id, nombre, variante, sku, precio, activo")
      .eq("activo", true)
      .order("nombre"),
    cx.supabase.from("customers").select("id, nombre, correo, telefono").order("nombre"),
  ]);

  const error = productosRes.error?.message ?? clientesRes.error?.message;
  if (error) return { error };

  return {
    ok: true,
    productos: (productosRes.data ?? []) as Pick<
      Product,
      "id" | "nombre" | "variante" | "sku" | "precio" | "activo"
    >[],
    clientes: (clientesRes.data ?? []) as Pick<
      Customer,
      "id" | "nombre" | "correo" | "telefono"
    >[],
  };
}

/* Importación manual de ventas desde Tienda Nube (botón del panel). La
   automática corre por webhook order/paid y por el cron diario. */
export async function importarVentasTiendanube(): Promise<
  { ok: true; detalle: string } | { error: string }
> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede importar ventas.");
  if ("error" in cx) return cx;

  try {
    const r = await importarVentasTN();
    RUTAS_VENTAS.forEach((ruta) => revalidatePath(ruta));
    return {
      ok: true,
      detalle: `Tienda Nube: ${r.insertadas} ventas nuevas de ${r.ordenes} órdenes revisadas${r.clientes ? `; ${r.clientes} clientes al día` : ""}${r.retiradas ? `; ${r.retiradas} retiradas por cancelación` : ""}.`,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falló la importación de ventas." };
  }
}
