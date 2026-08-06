/* ============================================================================
   lib/permisos-dinero.ts — Quién ve el dinero del negocio
   ----------------------------------------------------------------------------
   Los módulos que PARECEN financieros —Finanzas, Nómina, Reportes, Agencia,
   Proveedores— ya tenían candado. El dinero se escapaba por las pantallas de
   operación, que no tenían ninguno: Métricas pintaba las ventas en pesos,
   Canales la comisión de cada plataforma, Inventario el costo por SKU (y con
   el precio al lado, el margen es una resta) y Clientes lo que gasta cada uno.

   Dos ámbitos, no tres:

     egresos   Lo que sale: gastos, nómina, costo de producto, valor de
               inventario. Dirección y administración —Diana los captura.
     ingresos  Lo que entra: ventas, precio, comisiones, gasto por cliente.
               Solo dirección.

   El RESULTADO —utilidad, margen, saldo— no es un tercer ámbito: es la resta
   de los otros dos, así que se deriva (`veResultado`) en vez de declararse. Eso
   explica solo, sin una bandera más que decidir en cada pantalla nueva, por qué
   Reportes —que mezcla sueldos con ventas— acaba siendo de dirección.

   Los dos ámbitos tienen espejo exacto en la base: `ve_egresos()` sobre
   `es_administrativo()` y `ve_ingresos()` sobre `es_admin()`. Aquí es cortesía
   —no pintar lo que no toca—; el candado de verdad está allá.

   Este archivo es puro a propósito (sin Supabase, sin `server-only`): lo
   importan componentes de cliente. Quien necesite leer los permisos por canal
   de la base usa `vistaDinero()` de lib/supabase/vista-dinero.ts.
   ============================================================================ */

import type { CanalId } from "@/lib/types";

/* Lo que una persona puede ver de dinero, resuelto para toda la petición.
   `canales` son las excepciones puntuales: el encargado de una plataforma ve
   las cifras de la suya sin ver las del negocio. */
export type VistaDinero = {
  egresos: boolean;
  ingresos: boolean;
  canales: CanalId[];
};

/* Lo que da el rol por sí solo, antes de mirar permisos sueltos. */
export function vistaDineroDeRol(rol: string | null | undefined): {
  egresos: boolean;
  ingresos: boolean;
} {
  return {
    egresos: rol === "direccion" || rol === "administracion",
    ingresos: rol === "direccion",
  };
}

/* Vista sin nada: la que se usa como respaldo cuando no hay sesión o cuando una
   consulta falla. Ante la duda, no se enseña. */
export const SIN_DINERO: VistaDinero = { egresos: false, ingresos: false, canales: [] };

/* ¿Puede ver el dinero de ESTE canal?

   Con `canal = null` —el «Todas las plataformas» de Métricas— la respuesta es
   que no, salvo que vea los ingresos del negocio entero. Es la trampa de este
   módulo: si el nulo se colara como «todos», el permiso de un solo canal le
   abriría a su encargado la suma de los demás. */
export function veDineroDeCanal(v: VistaDinero, canal: CanalId | null | undefined): boolean {
  if (v.ingresos) return true;
  if (!canal) return false;
  return v.canales.includes(canal);
}

/* Utilidad, margen y saldo: la resta de lo que entra menos lo que sale, así que
   hace falta ver las dos mitades. Hoy eso es dirección y nadie más. */
export function veResultado(v: VistaDinero): boolean {
  return v.egresos && v.ingresos;
}
