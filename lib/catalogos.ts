/* ============================================================================
   lib/catalogos.ts  —  Constantes del negocio (Fresafit CRM)
   ----------------------------------------------------------------------------
   Portado de la Fase 1 (js/data.js). Aquí viven las listas fijas que usa toda
   la app: estados del tablero, prioridades, áreas y los módulos del menú.

   El "equipo" ya NO es una constante: ahora son usuarios reales de Supabase Auth
   (tabla `profiles`). EQUIPO_SEED se conserva solo como referencia para sembrar
   esos perfiles la primera vez (ver supabase/migrations).
   ============================================================================ */

/* --- Estados del tablero (las 4 columnas del Kanban) ---
   El orden define el orden de las columnas. */
export const ESTADOS = [
  { id: "por_hacer", nombre: "Por hacer" },
  { id: "en_progreso", nombre: "En progreso" },
  { id: "en_revision", nombre: "En revisión" },
  { id: "hecho", nombre: "Hecho" },
] as const;

/* --- Prioridades (con color para verse de un vistazo en la tarjeta) --- */
export const PRIORIDADES = [
  { id: "baja", nombre: "Baja", color: "#00b894" },
  { id: "media", nombre: "Media", color: "#fdcb6e" },
  { id: "alta", nombre: "Alta", color: "#e17055" },
  { id: "urgente", nombre: "Urgente", color: "#d63031" },
] as const;

/* --- Áreas del negocio (para clasificar y filtrar tareas) --- */
export const AREAS = [
  { id: "operaciones", nombre: "Operaciones" },
  { id: "marketing", nombre: "Marketing" },
  { id: "ventas", nombre: "Ventas" },
  { id: "inventario", nombre: "Inventario" },
  { id: "finanzas", nombre: "Finanzas" },
  { id: "general", nombre: "General" },
] as const;

/* --- Roles de usuario --- */
export const ROLES = [
  { id: "admin", nombre: "Administrador" },
  { id: "miembro", nombre: "Miembro" },
] as const;

/* --- Menú lateral: las 6 áreas del CRM ---
   "activo: true" = módulo construido. Los demás son placeholders ("Pronto"). */
export const MODULOS = [
  { id: "tareas", nombre: "Tareas", icono: "✅", href: "/tareas", activo: true },
  { id: "clientes", nombre: "Clientes y ventas", icono: "🧑", href: "/clientes", activo: false },
  { id: "pedidos", nombre: "Pedidos y envíos", icono: "📦", href: "/pedidos", activo: false },
  { id: "inventario", nombre: "Inventario", icono: "🏷️", href: "/inventario", activo: false },
  { id: "metricas", nombre: "Métricas", icono: "📊", href: "/metricas", activo: false },
  { id: "finanzas", nombre: "Finanzas y gastos", icono: "💰", href: "/finanzas", activo: false },
] as const;

/* --- Referencia para sembrar los perfiles iniciales del equipo ---
   Se usa en la migración SQL. La app siempre lee el equipo desde `profiles`. */
export const EQUIPO_SEED = [
  { slug: "armando", nombre: "Armando", rol: "admin", area: "general", color: "#e84393" },
  { slug: "rene", nombre: "René", rol: "miembro", area: "operaciones", color: "#0984e3" },
  { slug: "emiliano", nombre: "Emiliano", rol: "miembro", area: "marketing", color: "#00b894" },
  { slug: "aaron", nombre: "Aaron", rol: "miembro", area: "marketing", color: "#fdcb6e" },
] as const;

/* --- Ayudantes para convertir un id en su objeto completo --- */
export function obtenerEstado(id: string) {
  return ESTADOS.find((e) => e.id === id) ?? null;
}
export function obtenerPrioridad(id: string) {
  return PRIORIDADES.find((p) => p.id === id) ?? null;
}
export function obtenerArea(id: string) {
  return AREAS.find((a) => a.id === id) ?? null;
}
