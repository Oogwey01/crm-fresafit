import type { TipoProductoId } from "@/lib/types";

/* Clasificación por palabras clave del nombre; compartida por las
   importaciones de Tienda Nube y Mercado Libre. Solo se usa al CREAR el
   renglón (si luego lo reclasifican a mano, las syncs no lo pisan). */
export function tipoDesdeNombre(nombre: string): TipoProductoId {
  const n = nombre.toLowerCase();
  if (n.includes("cintur")) return "cinturones";
  if (n.includes("strap")) return "straps";
  if (n.includes("muñequ") || n.includes("munequ")) return "munequeras";
  if (n.includes("mochila") || n.includes("backpack")) return "mochilas";
  if (/playera|camiseta|sudadera|hoodie|short|legging|jogger|gorra|calceta|top\b/.test(n)) return "ropa";
  return "otro";
}
