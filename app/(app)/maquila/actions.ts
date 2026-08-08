/* Barril de las acciones de Maquila México. Dos familias: el pedido (lo que se
   mueve a diario, incluido Eduardo) y la configuración (fichas, calendario,
   tarifas — el volante del módulo). NO lleva "use server": las acciones ya
   vienen marcadas desde su archivo de origen, y un módulo de acciones no
   admite `export *` (Turbopack). */

export * from "@/app/(app)/maquila/acciones/pedidos";
export * from "@/app/(app)/maquila/acciones/configuracion";
