"use server";

import { revalidatePath } from "next/cache";
import type { Resultado } from "@/lib/acciones";
import { exigirRol } from "@/lib/supabase/guardia";
import { catalogoProductosActivo } from "@/lib/supabase/consultas";
import { traerTodo } from "@/lib/canales/paginacion";
import { textoONulo } from "@/lib/validacion";
import { importarVentasTN } from "@/lib/tiendanube/ventas";
import { COLUMNAS_VENTA_METRICAS, VENTAS_POR_PAGINA } from "@/lib/metricas";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { adjuntarMontos } from "@/lib/supabase/montos";
import { veDineroDeCanal } from "@/lib/permisos-dinero";
import type {
  CanalId,
  Customer,
  ProductoParaVenta,
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

  /* Quien no ve los ingresos tampoco recibió el monto al abrir la venta, así que
     el formulario lo manda vacío: dejarlo pasar la pondría en cero sin que nadie
     lo pidiera. Se conserva el que ya tenía. Registrar una venta nueva sí lleva
     monto —eso es capturar, no revelar—; lo que no puede es reescribir a ciegas
     uno que no ha visto. Mismo mecanismo que la regla de arriba. */
  const fila: Partial<ReturnType<typeof filaDeVenta>> = filaDeVenta(input);
  if (!(await vistaDinero()).ingresos) delete fila.monto;

  const cambios =
    esImportada && cx.rol !== "direccion"
      ? { cliente_id: input.cliente_id, notas: textoONulo(input.notas) }
      : fila;

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

/* Un canal vacío significa «todas las plataformas». Se OMITE el argumento en
   vez de mandar null: `canal_f` está declarado `default null` en la función y
   su cuerpo pregunta `canal_f is null`, así que omitirlo es exactamente lo
   mismo — y es lo que espera la firma generada de la RPC. */
function canalONulo(canal: string | null | undefined): string | undefined {
  return !canal || canal === "todas" ? undefined : canal;
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

  const c = canalONulo(canal);
  /* El MISMO booleano que calcula la página en su primera carga: si las dos
     páginas de la tabla no coinciden en si traen monto, la tabla cambia de forma
     a mitad del scroll. */
  const conMonto = veDineroDeCanal(await vistaDinero(), c as CanalId | null);

  let q = cx.supabase
    .from("sales")
    .select(COLUMNAS_VENTA_METRICAS)
    .gte("fecha", rango.desde)
    .lte("fecha", rango.hasta)
    .or("estado.is.null,estado.neq.cancelado"); // igual que el resumen

  if (c) q = q.eq("canal", c);

  const { data, error } = await q
    .order("fecha", { ascending: false })
    .order("created_at", { ascending: false })
    .order("id")
    .range(desplazamiento, desplazamiento + VENTAS_POR_PAGINA - 1);

  if (error) return { error: error.message };
  const ventas = await adjuntarMontos(
    cx.supabase,
    (data ?? []) as unknown as VentaMetricas[],
    conMonto,
  );
  return { ok: true, ventas };
}

/* Catálogo y clientes para los dos buscadores del diálogo de venta.

   Viajaban con la página: dos mil productos y dos mil y pico de clientes que se
   serializaban en CADA carga de Métricas para alimentar dos campos que casi
   nadie abre, y que además solo buscan a partir de dos letras. Ahora se piden al
   abrir el diálogo, que es cuando de verdad hacen falta. */
export async function catalogoVenta(): Promise<
  | {
      ok: true;
      productos: ProductoParaVenta[];
      clientes: Pick<Customer, "id" | "nombre" | "correo" | "telefono">[];
    }
  | { error: string }
> {
  const cx = await exigirRol("interno", "Solo el equipo interno puede registrar ventas.");
  if ("error" in cx) return cx;

  /* El `precio` viaja solo para quien ve los ingresos: es la lista de precios
     del catálogo entero servida por una action de nivel `interno`, o sea la
     puerta de atrás más ancha del módulo. Sin él el diálogo deja de
     autorrellenar el importe y se teclea, que es lo que ya se hace con las
     ventas de productos fuera de catálogo. */
  const conPrecio = (await vistaDinero()).ingresos;

  /* Paginado: el catálogo pasa de mil fichas y los clientes de dos mil
     quinientos, y PostgREST corta en ~1000 filas SIN error. Sin esto, el
     buscador del diálogo «no encontraba» a la mitad de los clientes —los que
     caían después del corte alfabético— sin ninguna señal de que faltaban. */
  type ClienteLigero = Pick<Customer, "id" | "nombre" | "correo" | "telefono">;
  try {
    const [productos, clientes] = await Promise.all([
      catalogoProductosActivo(conPrecio),
      traerTodo<ClienteLigero>((desde, hasta) =>
        cx.supabase
          .from("customers")
          .select("id, nombre, correo, telefono")
          .order("nombre")
          .order("id")
          .range(desde, hasta),
      ),
    ]);
    return { ok: true, productos, clientes };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "No se pudo cargar el catálogo de venta." };
  }
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
