/* Barril de las acciones de Bodega. El archivo tenía 900 líneas con cinco
   sub-dominios sin relación —recepción, conjuntos, envíos full, cajas,
   insumos— y cada uno vive ahora en su propio archivo bajo `acciones/`.

   Se queda aquí para no tocar los imports de una decena de componentes. NO
   lleva "use server": las acciones ya vienen marcadas desde su archivo de
   origen, y un módulo de acciones no admite `export *` (Turbopack: «Only async
   functions are allowed to be exported in a "use server" file»).

   Al agregar una acción nueva, va en el archivo de su familia y se re-exporta
   desde aquí. */

export * from "@/app/(app)/bodega/acciones/recepcion";
export * from "@/app/(app)/bodega/acciones/conjuntos";
export * from "@/app/(app)/bodega/acciones/full";
export * from "@/app/(app)/bodega/acciones/insumos";
export * from "@/app/(app)/bodega/acciones/conteos";
