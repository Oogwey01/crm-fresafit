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
  { id: "atorado", nombre: "Atorado", color: "#f97316" },       // naranja: bloqueada, necesita algo de vuelta
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
  { id: "miembro", nombre: "Miembro", desc: "Ve solo sus tareas (asignadas o creadas); mueve el estado de las suyas, comenta y adjunta." },
  { id: "externo", nombre: "Externo", desc: "Solo ve lo que se le comparte." },
] as const;

/* --- Etiquetas sugeridas (varias por tarea; se guardan en tasks.etiquetas).
   `area` acota a qué tipo de trabajo pertenece cada una: al crear o editar una
   tarea se muestran primero las de SU área y el resto queda bajo "otras". Las
   que no llevan área son transversales (urgente, reunión…) y salen siempre.
   Sin `area` la lista era una sola bolsa de 7 etiquetas genéricas, que es lo
   que Armando señaló ("si la etiqueta está hecha para diseño, que tenga
   etiquetas de diseño"). --- */
export const ETIQUETAS = [
  /* Transversales: valen para cualquier área. */
  { id: "urgente", nombre: "Urgente", color: "#d63031" },
  { id: "bloqueado", nombre: "Bloqueado", color: "#e17055" },
  { id: "idea", nombre: "Idea", color: "#00b894" },
  { id: "reunion", nombre: "Reunión", color: "#0984e3" },
  { id: "cliente", nombre: "Cliente", color: "#fdcb6e" },
  { id: "recurrente", nombre: "Recurrente", color: "#b2bec3" },

  /* Diseño */
  { id: "grafico", nombre: "Gráfico", area: "diseno", color: "#6c5ce7" },
  { id: "empaque", nombre: "Empaque", area: "diseno", color: "#a29bfe" },
  { id: "fotografia", nombre: "Fotografía", area: "diseno", color: "#8e7cf0" },
  { id: "fondo_blanco", nombre: "Fondo blanco", area: "diseno", color: "#7d6ce0" },
  { id: "mockup", nombre: "Mockup", area: "diseno", color: "#9b8bf5" },

  /* Contenido */
  { id: "video", nombre: "Video", area: "contenido", color: "#e84393" },
  { id: "tiktok", nombre: "TikTok Shop", area: "contenido", color: "#2d3436" },
  { id: "live", nombre: "Live", area: "contenido", color: "#ff7675" },
  { id: "guion", nombre: "Guion", area: "contenido", color: "#fd79a8" },
  { id: "publicidad", nombre: "Publicidad", area: "contenido", color: "#e056a0" },

  /* Tech */
  { id: "bug", nombre: "Bug", area: "tech", color: "#d63031" },
  { id: "mejora", nombre: "Mejora", area: "tech", color: "#636e72" },
  { id: "integracion", nombre: "Integración", area: "tech", color: "#0984e3" },
  { id: "rendimiento", nombre: "Rendimiento", area: "tech", color: "#00cec9" },

  /* Logística */
  { id: "envio", nombre: "Envío", area: "logistica", color: "#e17055" },
  { id: "proveedor", nombre: "Proveedor", area: "logistica", color: "#d35400" },
  { id: "aduana", nombre: "Aduana", area: "logistica", color: "#c0682f" },
  { id: "inventario", nombre: "Inventario", area: "logistica", color: "#e8874f" },

  /* Operaciones */
  { id: "pedido", nombre: "Pedido", area: "operaciones", color: "#0984e3" },
  { id: "devolucion", nombre: "Devolución", area: "operaciones", color: "#74b9ff" },
  { id: "atencion", nombre: "Atención a cliente", area: "operaciones", color: "#4a9de0" },

  /* Dirección */
  { id: "finanzas", nombre: "Finanzas", area: "direccion", color: "#00b894" },
  { id: "contratacion", nombre: "Contratación", area: "direccion", color: "#e84393" },
  { id: "estrategia", nombre: "Estrategia", area: "direccion", color: "#6c5ce7" },
] as const;

/* Etiquetas ordenadas para un área: primero las suyas, luego las transversales
   y al final las del resto (que siguen disponibles, solo que no estorban). */
export function etiquetasPorArea(area: string): {
  propias: typeof ETIQUETAS[number][];
  generales: typeof ETIQUETAS[number][];
  otras: typeof ETIQUETAS[number][];
} {
  const propias: typeof ETIQUETAS[number][] = [];
  const generales: typeof ETIQUETAS[number][] = [];
  const otras: typeof ETIQUETAS[number][] = [];
  for (const e of ETIQUETAS) {
    const suArea = "area" in e ? e.area : null;
    if (!suArea) generales.push(e);
    else if (suArea === area) propias.push(e);
    else otras.push(e);
  }
  return { propias, generales, otras };
}

/* --- Tipos de producto del catálogo (Fase 1: Inventario).
   Son las líneas que el negocio compra y repone POR SEPARADO, no categorías
   genéricas: powerlift (SKU SBD…) y hebilla (PRM…) se piden distinto, y el
   modelo nuevo "Pro" (STR###/MQR###) convive con el viejo "OG" (…OG) al mismo
   tiempo. Ver lib/inventario/tipo-producto.ts para la clasificación automática. */
export const TIPOS_PRODUCTO = [
  { id: "cinturon_powerlift", nombre: "Cinturón powerlift", color: "#e84393" },
  { id: "cinturon_hebilla", nombre: "Cinturones hebilla", color: "#fd79a8" },
  { id: "straps_pro", nombre: "Straps pro", color: "#0984e3" },
  { id: "munequeras_pro", nombre: "Muñequeras pro", color: "#6c5ce7" },
  { id: "straps_viejos", nombre: "Straps viejos", color: "#74b9ff" },
  { id: "munequeras_viejos", nombre: "Muñequeras viejos", color: "#a29bfe" },
  { id: "mochilas", nombre: "Mochila", color: "#e17055" },
  { id: "ropa", nombre: "Ropa", color: "#00b894" },
  { id: "otro", nombre: "Otro", color: "#94a3b8" },
] as const;

/* --- Estados de un pedido a proveedor (incluye aduana). Orden = avance. --- */
export const ESTADOS_PEDIDO_PROVEEDOR = [
  { id: "pedido", nombre: "Pedido", color: "#94a3b8" },
  { id: "en_transito", nombre: "En tránsito", color: "#0984e3" },
  { id: "en_aduana", nombre: "En aduana", color: "#f59e0b" },
  { id: "recibido", nombre: "Recibido", color: "#22c55e" },
  { id: "cancelado", nombre: "Cancelado", color: "#d63031" },
] as const;

/* --- Estados de un pedido/envío (Fase 5). El orden = avance del flujo. --- */
export const ESTADOS_PEDIDO = [
  { id: "nuevo", nombre: "Nuevo", color: "#0984e3" },
  { id: "preparando", nombre: "Preparando", color: "#f59e0b" },
  { id: "enviado", nombre: "Enviado", color: "#6c5ce7" },
  { id: "entregado", nombre: "Entregado", color: "#22c55e" },
  { id: "cancelado", nombre: "Cancelado", color: "#d63031" },
] as const;

/* Los estados que cuentan como "pendiente" (aún dan trabajo). */
export const ESTADOS_PEDIDO_PENDIENTES = ["nuevo", "preparando", "enviado"] as const;

/* Paqueterías sugeridas (datalist; no es un catálogo cerrado). */
export const PAQUETERIAS = ["Estafeta", "DHL", "FedEx", "Paquetexpress", "J&T", "99minutos", "Correos de México"] as const;

/* --- Canales de venta (Fase 2: se reutilizan en Finanzas, Clientes y Pedidos). --- */
export const CANALES = [
  { id: "tienda_nube", nombre: "Tienda Nube", color: "#0984e3" },
  { id: "mercado_libre", nombre: "Mercado Libre", color: "#f39c12" },
  { id: "tiktok_shop", nombre: "TikTok Shop", color: "#2d3436" },
  { id: "punto_fisico", nombre: "Punto físico", color: "#e84393" },
  { id: "otro", nombre: "Otro", color: "#94a3b8" },
] as const;

/* --- Paneles por plataforma (módulo Canales).
   Métricas contesta "cuánto se vendió" sumando los canales; esto contesta cómo
   nos está yendo DENTRO de cada plataforma —su termómetro, sus plazos, sus
   preguntas—, que es información que solo existe allá y que se mira una
   plataforma a la vez. Por eso hay una página por canal y no una sola pantalla
   con todo revuelto.

   `activo: false` = la pestaña se ve pero no navega, para que el orden del plan
   esté a la vista en lugar de aparecer de sorpresa. --- */
export const PANELES_CANAL = [
  { id: "mercadolibre", nombre: "Mercado Libre", href: "/canales/mercadolibre", canal: "mercado_libre", activo: true },
  { id: "tiendanube", nombre: "Tienda Nube", href: "/canales/tiendanube", canal: "tienda_nube", activo: true },
  { id: "tiktok", nombre: "TikTok Shop", href: "/canales/tiktok", canal: "tiktok_shop", activo: true },
] as const;

/* --- Categorías de gasto (Fase 3: Finanzas). --- */
export const CATEGORIAS_GASTO = [
  { id: "marketing", nombre: "Marketing", color: "#e84393" },
  { id: "producto", nombre: "Producto", color: "#0984e3" },
  { id: "operacion", nombre: "Operación", color: "#6c5ce7" },
  { id: "logistica", nombre: "Logística", color: "#e17055" },
  { id: "nomina", nombre: "Nómina", color: "#00b894" },
  { id: "otro", nombre: "Otro", color: "#94a3b8" },
] as const;

/* --- Menú lateral: los 6 módulos del CRM, en el orden de prioridad de Armando.
   "activo: true" = construido. "soloDireccion" = oculto para los demás roles. --- */
/* Los módulos se agrupan en ESPACIOS: Fresafit es la marca (lo que se vende) y
   Agencia es el otro negocio (lo que se le cobra a otros por atenderlos). Son
   dos operaciones distintas que comparten equipo, y mezclarlas en un solo menú
   obligaba a leer once entradas para encontrar la que toca.

   El espacio se deduce de la ruta (todo lo de la agencia cuelga de /agencia),
   así que el selector solo navega: no hay estado que sincronizar ni que se
   quede pegado entre pestañas. */
export const ESPACIOS = [
  { id: "fresafit", nombre: "Fresafit", desc: "La marca: inventario, ventas y pedidos." },
  { id: "agencia", nombre: "Agencia", desc: "Los negocios que atendemos y lo que nos pagan." },
] as const;

export type EspacioId = (typeof ESPACIOS)[number]["id"];

export const MODULOS = [
  { id: "tareas", nombre: "Tareas", icono: "✅", href: "/tareas", activo: true, espacio: "fresafit" },
  { id: "inventario", nombre: "Inventario", icono: "🏷️", href: "/inventario", activo: true, espacio: "fresafit" },
  { id: "metricas", nombre: "Métricas", icono: "📊", href: "/metricas", activo: true, espacio: "fresafit" },
  /* Va pegado a Métricas porque contesta la otra mitad de la misma pregunta: no
     cuánto vendimos, sino cómo nos está tratando cada plataforma. */
  { id: "canales", nombre: "Canales", icono: "🛒", href: "/canales", activo: true, espacio: "fresafit" },
  { id: "finanzas", nombre: "Finanzas y gastos", icono: "💰", href: "/finanzas", activo: true, soloDireccion: true, espacio: "fresafit" },
  { id: "clientes", nombre: "Clientes y ventas", icono: "🧑", href: "/clientes", activo: true, espacio: "fresafit" },
  { id: "pedidos", nombre: "Pedidos y envíos", icono: "📦", href: "/pedidos", activo: true, espacio: "fresafit" },
  /* Nómina y reportes existen en los dos negocios: son las mismas tablas
     filtradas por empresa (null = Fresafit). Sueldos y cierres internos, así que
     van restringidos a dirección igual que Finanzas. */
  { id: "nomina", nombre: "Nómina", icono: "👥", href: "/nomina", activo: true, soloDireccion: true, espacio: "fresafit" },
  { id: "reportes", nombre: "Reportes", icono: "📈", href: "/reportes", activo: true, soloDireccion: true, espacio: "fresafit" },
  /* Agencia: información de contratos ajenos y de sueldos, así que va entera
     restringida a dirección igual que Finanzas (la RLS lo refuerza). */
  { id: "agencia-empresas", nombre: "Empresas", icono: "🏢", href: "/agencia/empresas", activo: true, soloDireccion: true, espacio: "agencia" },
  { id: "agencia-cobros", nombre: "Cobros", icono: "🧾", href: "/agencia/cobros", activo: true, soloDireccion: true, espacio: "agencia" },
  { id: "agencia-nomina", nombre: "Nómina", icono: "👥", href: "/agencia/nomina", activo: true, soloDireccion: true, espacio: "agencia" },
  { id: "agencia-reportes", nombre: "Reportes", icono: "📈", href: "/agencia/reportes", activo: true, soloDireccion: true, espacio: "agencia" },
] as const;

/* A qué espacio pertenece una ruta. Todo lo que cuelga de /agencia es de la
   agencia; el resto es Fresafit. */
export function espacioDeRuta(pathname: string): EspacioId {
  return pathname.startsWith("/agencia") ? "agencia" : "fresafit";
}

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
  // Programador (acceso total para desarrollo y soporte)
  { slug: "aaron", email: "aaron@fresafit.com.mx", nombre: "Aaron Oviedo", rol: "direccion", area: "tech", color: "#636e72" },
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
export function obtenerTipoProducto(id: string) {
  return TIPOS_PRODUCTO.find((t) => t.id === id) ?? null;
}
export function obtenerEstadoPedidoProv(id: string) {
  return ESTADOS_PEDIDO_PROVEEDOR.find((e) => e.id === id) ?? null;
}
export function obtenerCanal(id: string) {
  return CANALES.find((c) => c.id === id) ?? null;
}
export function obtenerCategoriaGasto(id: string) {
  return CATEGORIAS_GASTO.find((c) => c.id === id) ?? null;
}
export function obtenerEstadoPedido(id: string) {
  return ESTADOS_PEDIDO.find((e) => e.id === id) ?? null;
}

/* --- Ayudantes de rol --- */
export function esGestor(rol: string | null | undefined) {
  return rol === "direccion" || rol === "coordinador";
}
