/* Barril de las acciones de la Agencia. El archivo tenía 596 líneas y servía a
   TRES módulos de UI distintos: agencia, nómina y reportes. Nómina y reportes
   se mudaron a sus propias rutas —existen en los dos espacios— y lo de la
   agencia se repartió por familia bajo `acciones/`.

   Se queda aquí para no tocar los imports de los componentes de agencia. NO
   lleva "use server": las acciones ya vienen marcadas desde su archivo de
   origen, y un módulo de acciones no admite `export *`. */

export * from "@/app/(app)/agencia/acciones/empresas";
export * from "@/app/(app)/agencia/acciones/contratos";
export * from "@/app/(app)/agencia/acciones/cobros";
/* Re-exportadas por compatibilidad: su casa es /nomina y /reportes. */
export * from "@/app/(app)/nomina/actions";
export * from "@/app/(app)/reportes/actions";
