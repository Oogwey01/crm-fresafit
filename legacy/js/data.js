/* ============================================================================
   data.js  —  Constantes del negocio (Fresafit CRM)
   ----------------------------------------------------------------------------
   Aquí viven las listas fijas que usa toda la app: el equipo, los estados del
   tablero, las prioridades y las áreas. Están en un solo lugar para que, si algo
   cambia (por ejemplo entra alguien nuevo al equipo), se edite SOLO aquí y se
   actualice en todos lados.

   Cuando en la Fase 2 se sumen más módulos (clientes, pedidos, etc.), también
   pondrán aquí sus listas fijas.
   ============================================================================ */

/* --- El equipo de Fresafit ---
   Cada persona tiene un "id" (interno, no cambia) y un "nombre" (lo que se ve).
   El "color" se usa para pintar su etiqueta en las tarjetas.                  */
const EQUIPO = [
  { id: "armando",  nombre: "Armando",  rol: "Fundador / Dirección",   color: "#e84393" },
  { id: "rene",     nombre: "René",     rol: "Operaciones",            color: "#0984e3" },
  { id: "emiliano", nombre: "Emiliano", rol: "Operaciones / Marketing",color: "#00b894" },
  { id: "aaron",    nombre: "Aaron",    rol: "Marketing",              color: "#fdcb6e" },
];

/* --- Estados del tablero (las 4 columnas del Kanban) ---
   El "id" es el valor interno que se guarda; el "nombre" es el título de la
   columna. El orden de este arreglo define el orden de las columnas.          */
const ESTADOS = [
  { id: "por_hacer",   nombre: "Por hacer" },
  { id: "en_progreso", nombre: "En progreso" },
  { id: "en_revision", nombre: "En revisión" },
  { id: "hecho",       nombre: "Hecho" },
];

/* --- Prioridades ---
   Cada una tiene un color para verse de un vistazo en la tarjeta.             */
const PRIORIDADES = [
  { id: "baja",    nombre: "Baja",    color: "#00b894" },
  { id: "media",   nombre: "Media",   color: "#fdcb6e" },
  { id: "alta",    nombre: "Alta",    color: "#e17055" },
  { id: "urgente", nombre: "Urgente", color: "#d63031" },
];

/* --- Áreas del negocio ---
   Sirven para clasificar y filtrar tareas. Coinciden con las áreas que serán
   módulos completos más adelante (más "General" para lo que no encaja).       */
const AREAS = [
  { id: "operaciones", nombre: "Operaciones" },
  { id: "marketing",   nombre: "Marketing" },
  { id: "ventas",      nombre: "Ventas" },
  { id: "inventario",  nombre: "Inventario" },
  { id: "finanzas",    nombre: "Finanzas" },
  { id: "general",     nombre: "General" },
];

/* --- Menú lateral: las 6 áreas del CRM ---
   "activo: true" significa que ya está construido y se puede usar.
   Los que tienen "activo: false" salen como "Próximamente" (deshabilitados).
   Cuando en la Fase 2 se construya un módulo nuevo, solo se cambia su "activo"
   a true y se registra su vista en app.js. Nada más.                          */
const MODULOS = [
  { id: "tareas",     nombre: "Tareas",              icono: "✅", activo: true  },
  { id: "clientes",   nombre: "Clientes y ventas",   icono: "🧑", activo: false },
  { id: "pedidos",    nombre: "Pedidos y envíos",    icono: "📦", activo: false },
  { id: "inventario", nombre: "Inventario",          icono: "🏷️", activo: false },
  { id: "metricas",   nombre: "Métricas",            icono: "📊", activo: false },
  { id: "finanzas",   nombre: "Finanzas y gastos",   icono: "💰", activo: false },
];

/* --- Ayudantes para buscar un elemento por su id ---
   Se usan en toda la app para convertir un id (ej. "rene") en su objeto
   completo (ej. { nombre: "René", color: ... }).                             */
function buscarEnLista(lista, id) {
  return lista.find(function (item) { return item.id === id; }) || null;
}
const obtenerPersona    = function (id) { return buscarEnLista(EQUIPO, id); };
const obtenerEstado     = function (id) { return buscarEnLista(ESTADOS, id); };
const obtenerPrioridad  = function (id) { return buscarEnLista(PRIORIDADES, id); };
const obtenerArea       = function (id) { return buscarEnLista(AREAS, id); };
