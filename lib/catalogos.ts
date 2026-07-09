/* ============================================================================
   lib/catalogos.ts  —  Constantes del negocio (Fresafit CRM)
   ----------------------------------------------------------------------------
   Listas fijas que usa toda la app: estados del tablero, prioridades, áreas,
   roles, etiquetas y los módulos del menú. Única fuente de verdad para las
   uniones de tipos (ver lib/types.ts).

   El "equipo" son usuarios reales de Supabase Auth (tabla `profiles`).
   EQUIPO_SEED es la referencia para sembrarlos (ver scripts/seed.mjs).
   ============================================================================ */

/* --- Estados del tablero (las 4 columnas del Kanban). El orden = orden de columnas.
   `color` se usa para la pastilla de estado en la vista de tabla y el calendario. */
export const ESTADOS = [
  { id: "por_hacer", nombre: "Por hacer", color: "#94a3b8" },   // gris
  { id: "en_proceso", nombre: "En proceso", color: "#f59e0b" }, // ámbar
  { id: "en_revision", nombre: "En revisión", color: "#8b5cf6" },// morado
  { id: "hecho", nombre: "Hecho", color: "#22c55e" },           // verde
] as const;

/* --- Prioridades (con color para verse de un vistazo). --- */
export const PRIORIDADES = [
  { id: "alta", nombre: "Alta", color: "#d63031" },  // rojo
  { id: "media", nombre: "Media", color: "#f59e0b" },// ámbar
  { id: "baja", nombre: "Baja", color: "#94a3b8" },  // gris
] as const;

/* --- Áreas del negocio (para agrupar y filtrar tareas). --- */
export const AREAS = [
  { id: "direccion", nombre: "Dirección", color: "#e84393" },
  { id: "operaciones", nombre: "Operaciones", color: "#0984e3" },
  { id: "diseno", nombre: "Diseño", color: "#6c5ce7" },
  { id: "contenido", nombre: "Contenido", color: "#00b894" },
  { id: "logistica", nombre: "Logística", color: "#e17055" },
  { id: "tech", nombre: "Tech", color: "#636e72" },
] as const;

/* --- Roles de usuario (definen qué ve y hace cada quien; se refuerza con RLS). --- */
export const ROLES = [
  { id: "direccion", nombre: "Dirección", desc: "Ve y edita todo." },
  { id: "coordinador", nombre: "Coordinador", desc: "Ve todas las tareas del equipo; crea, asigna y edita." },
  { id: "miembro", nombre: "Miembro", desc: "Ve su área y sus tareas; mueve el estado de las suyas, comenta y adjunta." },
  { id: "externo", nombre: "Externo", desc: "Solo ve lo que se le comparte." },
] as const;

/* --- Etiquetas sugeridas (varias por tarea; se guardan en tasks.etiquetas). --- */
export const ETIQUETAS = [
  { id: "urgente", nombre: "Urgente", color: "#d63031" },
  { id: "video", nombre: "Video", color: "#e84393" },
  { id: "grafico", nombre: "Gráfico", color: "#6c5ce7" },
  { id: "tiktok", nombre: "TikTok Shop", color: "#2d3436" },
  { id: "reunion", nombre: "Reunión", color: "#0984e3" },
  { id: "bloqueado", nombre: "Bloqueado", color: "#e17055" },
  { id: "idea", nombre: "Idea", color: "#00b894" },
] as const;

/* --- Menú lateral: los 6 módulos del CRM. "activo: true" = construido. --- */
export const MODULOS = [
  { id: "tareas", nombre: "Tareas", icono: "✅", href: "/tareas", activo: true },
  { id: "clientes", nombre: "Clientes y ventas", icono: "🧑", href: "/clientes", activo: false },
  { id: "pedidos", nombre: "Pedidos y envíos", icono: "📦", href: "/pedidos", activo: false },
  { id: "inventario", nombre: "Inventario", icono: "🏷️", href: "/inventario", activo: false },
  { id: "metricas", nombre: "Métricas", icono: "📊", href: "/metricas", activo: false },
  { id: "finanzas", nombre: "Finanzas y gastos", icono: "💰", href: "/finanzas", activo: false },
] as const;

/* --- Referencia para sembrar los perfiles iniciales del equipo (scripts/seed.mjs).
   El equipo real de Fresafit con sus correos, roles y áreas. --- */
export const EQUIPO_SEED = [
  // Dirección (ve y edita todo)
  { slug: "armando", email: "armando@fresafit.com.mx", nombre: "Diego Armando Duarte Palacios", rol: "direccion", area: "direccion", color: "#e84393" },
  { slug: "rene", email: "rene@fresafit.com.mx", nombre: "René Duarte Palacios", rol: "direccion", area: "operaciones", color: "#0984e3" },
  // Coordinadores (ven todo el equipo; crean, asignan y editan)
  { slug: "manuel", email: "manuel@fresafit.com.mx", nombre: "Manuel Enrique Barrera Rodríguez", rol: "coordinador", area: "diseno", color: "#8e44ad" },
  { slug: "julio", email: "juliozea10@gmail.com", nombre: "Julio Enrique Zea Silva", rol: "coordinador", area: "contenido", color: "#16a085" },
  // Miembros (ven su área + sus tareas; mueven el estado de las suyas)
  { slug: "juanpablo", email: "juanpverdugolopez@gmail.com", nombre: "Juan Pablo Verdugo López", rol: "miembro", area: "diseno", color: "#9b59b6" },
  { slug: "ulises", email: "ulises@fresafit.com.mx", nombre: "Miguel Ulises Zayas Hernández", rol: "miembro", area: "diseno", color: "#a29bfe" },
  { slug: "luna", email: "lunanava93189@gmail.com", nombre: "Luna Mayela Parra Nava", rol: "miembro", area: "contenido", color: "#00b894" },
  { slug: "argelia", email: "adv_16@hotmail.com", nombre: "Argelia Duarte Villa", rol: "miembro", area: "contenido", color: "#55efc4" },
  { slug: "german", email: "germansegura02@hotmail.com", nombre: "Germán Segura García", rol: "miembro", area: "logistica", color: "#e17055" },
  { slug: "emiliano", email: "emiliano@fresafit.com.mx", nombre: "Omar Emiliano Rendón Martínez", rol: "miembro", area: "logistica", color: "#fab1a0" },
  // Externo (solo lo que se le comparta)
  { slug: "aaron", email: "aaron@fresafit.com.mx", nombre: "Aaron Oviedo", rol: "externo", area: "tech", color: "#636e72" },
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
export function obtenerRol(id: string) {
  return ROLES.find((r) => r.id === id) ?? null;
}
export function obtenerEtiqueta(id: string) {
  return ETIQUETAS.find((e) => e.id === id) ?? null;
}

/* --- Ayudantes de rol --- */
export function esGestor(rol: string | null | undefined) {
  return rol === "direccion" || rol === "coordinador";
}
