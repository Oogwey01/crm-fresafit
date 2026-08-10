/* Barril de las acciones de Maquila México. Familias: el pedido (lo que se
   mueve a diario, incluido Eduardo), las guías que logística le surte, y la
   configuración (fichas, calendario, tarifas — el volante del módulo). NO
   lleva "use server": las acciones ya vienen marcadas desde su archivo de
   origen, y un módulo de acciones no admite `export *` (Turbopack). */

export * from "@/app/(app)/maquila/acciones/pedidos";
export * from "@/app/(app)/maquila/acciones/guias";
export * from "@/app/(app)/maquila/acciones/insumos";
export * from "@/app/(app)/maquila/acciones/dinero";
export * from "@/app/(app)/maquila/acciones/disenos";
export * from "@/app/(app)/maquila/acciones/incidencias";
export * from "@/app/(app)/maquila/acciones/configuracion";
