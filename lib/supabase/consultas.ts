/* Lecturas chicas y casi estáticas que media app repetía a mano: el picker de
   equipo estaba copiado idéntico en diez páginas, los proveedores en tres y
   las empresas de la agencia en otras tres. Una sola definición evita que las
   copias deriven (columnas, orden) y da un punto único donde colgar el caché.

   Cada una tiene dos capas:
   - React cache(): dentro de un mismo request (página + layout) la consulta
     viaja una sola vez.
   - consultaCacheada(): entre requests, con su etiqueta para invalidar. Las
     tres tablas tienen SELECT abierto a `es_interno()` en la RLS, así que la
     respuesta es idéntica para todo el equipo — que es la condición para poder
     cachearla (ver la regla de seguridad en lib/supabase/cache.ts). El corte de
     rol se hace AQUÍ, fuera del scope cacheado, y devuelve lo mismo que
     devolvería la RLS a quien no es del equipo: nada.

   Los nombres son verbos-sustantivo largos a propósito: las páginas suelen
   destructurar el resultado como `equipo` o `proveedores`, y si el helper se
   llamara igual, el initializer del destructure lo resolvería a la binding
   todavía en TDZ y tronaría en runtime. */

import { cache } from "react";
import { esInterno, usuarioActual } from "@/lib/supabase/usuario-actual";
import { consultaCacheada, TAGS } from "@/lib/supabase/cache";
import { traerTodo } from "@/lib/canales/paginacion";
import type { AgenciaEmpresa, Profile, ProductoParaVenta, Supplier } from "@/lib/types";

/* ¿Quien pregunta es del equipo? Fuera del scope cacheado, siempre. */
async function esDelEquipo(): Promise<boolean> {
  const { user, rol } = await usuarioActual();
  return !!user && esInterno(rol);
}

const equipoCacheado = consultaCacheada(TAGS.equipo, [TAGS.equipo], async (admin) => {
  const { data, error } = await admin
    .from("profiles")
    .select("id, nombre, rol, area, color")
    .order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as Profile[];
});

/* El equipo completo, con lo que pintan los pickers y avatares. */
export const equipoCompleto = cache(async (): Promise<Profile[]> =>
  (await esDelEquipo()) ? equipoCacheado() : [],
);

const proveedoresCacheados = consultaCacheada(
  TAGS.proveedores,
  [TAGS.proveedores],
  async (admin) => {
    const { data, error } = await admin.from("suppliers").select("*").order("nombre");
    if (error) throw new Error(error.message);
    return (data ?? []) as Supplier[];
  },
);

/* Los proveedores, ordenados como los muestran inventario y compras. */
export const catalogoProveedores = cache(async (): Promise<Supplier[]> =>
  (await esDelEquipo()) ? proveedoresCacheados() : [],
);

const empresasCacheadas = consultaCacheada(TAGS.agencia, [TAGS.agencia], async (admin) => {
  const { data, error } = await admin
    .from("agencia_empresas")
    .select("*")
    .eq("activa", true)
    .order("nombre");
  if (error) throw new Error(error.message);
  return (data ?? []) as AgenciaEmpresa[];
});

/* Las cuentas VIVAS de la agencia (la página de empresas, que también lista
   las inactivas, tiene su propia consulta). */
export const empresasAgenciaActivas = cache(async (): Promise<AgenciaEmpresa[]> =>
  (await esDelEquipo()) ? empresasCacheadas() : [],
);

/* El catálogo activo, paginado (ronda el corte de ~1000 de PostgREST). SIN
   caché entre requests a propósito: el stock y el precio se mueven todo el día
   —cada venta importada los toca— y servir una foto de hace una hora en el
   diálogo de venta sería peor que el viaje que ahorra. El `precio` solo viaja
   cuando el caller ya comprobó que quien pregunta ve los ingresos: es la lista
   de precios completa, no un dato decorativo. */
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
        .range(desde, hasta),
    );
  },
);
