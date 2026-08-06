/* Lecturas chicas y casi estáticas que media app repetía a mano: el picker de
   equipo estaba copiado idéntico en diez páginas, los proveedores en tres y
   las empresas de la agencia en otras tres. Una sola definición evita que las
   copias deriven (columnas, orden) y deja UN punto donde colgar el caché.

   Todas van con React cache(): dentro de un mismo request (página + layout +
   generateMetadata) la consulta viaja una sola vez. El caché entre requests
   llega en la capa de lib/supabase/cache.ts, por encima de estas funciones.

   Los nombres son verbos-sustantivo largos a propósito: las páginas suelen
   destructurar el resultado como `equipo` o `proveedores`, y si el helper se
   llamara igual, el initializer del destructure lo resolvería a la binding
   todavía en TDZ y tronaría en runtime. */

import { cache } from "react";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { traerTodo } from "@/lib/canales/paginacion";
import type { AgenciaEmpresa, Profile, ProductoParaVenta, Supplier } from "@/lib/types";

/* El equipo completo, con lo que pintan los pickers y avatares. */
export const equipoCompleto = cache(async (): Promise<Profile[]> => {
  const { supabase } = await usuarioActual();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, nombre, rol, area, color")
    .order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
});

/* Los proveedores, ordenados como los muestran inventario y compras. */
export const catalogoProveedores = cache(async (): Promise<Supplier[]> => {
  const { supabase } = await usuarioActual();
  const { data, error } = await supabase.from("suppliers").select("*").order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as Supplier[];
});

/* Las cuentas VIVAS de la agencia (la página de empresas, que también lista
   las inactivas, tiene su propia consulta). */
export const empresasAgenciaActivas = cache(async (): Promise<AgenciaEmpresa[]> => {
  const { supabase } = await usuarioActual();
  const { data, error } = await supabase
    .from("agencia_empresas")
    .select("*")
    .eq("activa", true)
    .order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as AgenciaEmpresa[];
});

/* El catálogo activo, paginado (ronda el corte de ~1000 de PostgREST). El
   `precio` solo viaja cuando el caller ya comprobó que quien pregunta ve los
   ingresos: es la lista de precios completa, no un dato decorativo. */
export const catalogoProductosActivo = cache(
  async (conPrecio = false): Promise<ProductoParaVenta[]> => {
    const { supabase } = await usuarioActual();
    return traerTodo<ProductoParaVenta>((desde, hasta) =>
      supabase
        .from("products")
        .select(`id, nombre, variante, sku, activo${conPrecio ? ", precio" : ""}`)
        .eq("activo", true)
        .order("nombre")
        .order("id")
        .range(desde, hasta) as unknown as PromiseLike<{
        data: ProductoParaVenta[] | null;
        error: { message: string } | null;
      }>,
    );
  },
);
