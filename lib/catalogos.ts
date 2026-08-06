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
  { id: "administracion", nombre: "Administración", color: "#00cec9" },
  { id: "operaciones", nombre: "Operaciones", color: "#0984e3" },
  { id: "diseno", nombre: "Diseño", color: "#6c5ce7" },
  { id: "contenido", nombre: "Contenido", color: "#00b894" },
  { id: "logistica", nombre: "Logística", color: "#e17055" },
  { id: "tech", nombre: "Tech", color: "#636e72" },
] as const;

/* --- Roles de usuario (definen qué ve y hace cada quien; se refuerza con RLS). --- */
export const ROLES = [
  { id: "direccion", nombre: "Dirección", desc: "Ve y edita todo, incluidos los roles del equipo." },
  /* Lleva los papeles y el dinero que SALE: gastos, nómina y los cobros de la
     agencia, más el tablero completo de tareas. No ve lo que entra —ventas,
     precios, comisiones— ni el cierre que las resta, porque quien captura los
     gastos no necesita saber contra cuánto se comparan. Tampoco cambia roles ni
     corrige a mano las ventas que bajan por API. */
  { id: "administracion", nombre: "Administración", desc: "Gastos, nómina y cobros de la agencia; ve y asigna todas las tareas. No ve ingresos ni el cierre, ni cambia roles del equipo." },
  { id: "coordinador", nombre: "Coordinador", desc: "Ve todas las tareas del equipo; crea, asigna y edita." },
  /* Crear tareas dejó de ser privilegio de gestor: cualquiera del equipo abre
     las suyas y se las asigna a quien toque, y manda sobre lo que él creó
     (corregirlo, reasignarlo, mandarlo a la papelera). Lo que sigue siendo de
     gestor es meterse en las tareas AJENAS. */
  { id: "miembro", nombre: "Miembro", desc: "Crea tareas y ve las suyas (asignadas o creadas); manda en las que él creó, y de las demás mueve el estado, comenta y adjunta." },
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
  /* Trabajo de "Los Locos" (el equipo de la agencia): lo pidió Armando en la
     junta del 03/08/2026 para marcar lo que se hace en conjunto. */
  { id: "locos", nombre: "Los Locos", color: "#f0932b" },

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
  /* Las tareas del Sheet de bodega («Devolución de ML», «Revisar poco stock»…)
     entran al tablero de siempre con esta etiqueta, en vez de mantener un
     segundo sistema de pendientes dentro de Bodega. */
  { id: "bodega", nombre: "Bodega", area: "logistica", color: "#d9822b" },

  /* Operaciones */
  { id: "pedido", nombre: "Pedido", area: "operaciones", color: "#0984e3" },
  { id: "devolucion", nombre: "Devolución", area: "operaciones", color: "#74b9ff" },
  { id: "atencion", nombre: "Atención a cliente", area: "operaciones", color: "#4a9de0" },

  /* Dirección */
  { id: "finanzas", nombre: "Finanzas", area: "direccion", color: "#00b894" },
  { id: "contratacion", nombre: "Contratación", area: "direccion", color: "#e84393" },
  { id: "estrategia", nombre: "Estrategia", area: "direccion", color: "#6c5ce7" },

  /* Administración */
  { id: "facturacion", nombre: "Facturación", area: "administracion", color: "#00cec9" },
  { id: "cobranza", nombre: "Cobranza", area: "administracion", color: "#0abde3" },
  { id: "pago", nombre: "Pago pendiente", area: "administracion", color: "#22a6b3" },
  { id: "tramite", nombre: "Trámite", area: "administracion", color: "#7ed6df" },
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

/* --- Bodega ---------------------------------------------------------------
   Estados por los que pasa cada renglón de una carga de mercancía. En el Sheet
   eran los números de la leyenda «VALORES EN CHEQUEO: TRAER, CARGADO=1,
   CHECADO=2, DESCONTADO=3»; aquí son botones con nombre. --- */
export const ESTADOS_RECEPCION = [
  { id: "traer", nombre: "Traer", color: "#94a3b8" },
  { id: "cargado", nombre: "Cargado", color: "#f59e0b" },
  { id: "checado", nombre: "Checado", color: "#0984e3" },
  { id: "descontado", nombre: "Descontado", color: "#22c55e" },
] as const;

/* Cómo va un cinturón personalizado: el recorrido tal cual lo pinta la hoja
   «Personalizados FRESA FIT» con sus colores. `produccion` arranca cuando el
   cliente aprobó el diseño y se mandó al proveedor: es la fecha que hoy nadie
   encuentra. `eduardo` es el paso de bordado, que lleva él. */
export const ESTADOS_PERSONALIZADO = [
  { id: "recibido", nombre: "Recibido", color: "#94a3b8" },
  { id: "diseno", nombre: "En diseño", color: "#f6c445" },
  { id: "eduardo", nombre: "Con Eduardo", color: "#e8730c" },
  { id: "produccion", nombre: "En producción", color: "#6c5ce7" },
  { id: "listo", nombre: "Listo", color: "#16a34a" },
  { id: "enviado", nombre: "Enviado", color: "#22c55e" },
] as const;

/* Los estados en los que el pedido sigue en manos del equipo (los que se
   cuentan como "en proceso" y los que vigilan la fecha límite). */
export const ESTADOS_PERSONALIZADO_ABIERTOS = [
  "recibido",
  "diseno",
  "eduardo",
  "produccion",
] as const;

export const TIPOS_PERSONALIZADO = [
  { id: "bordado", nombre: "Bordado" },
  { id: "sublimado", nombre: "Sublimado" },
  { id: "otro", nombre: "Otro" },
] as const;

/* «TIPO DE CINTO» en la hoja: Powerlift o de Hebilla. */
export const MODELOS_PERSONALIZADO = [
  { id: "powerlift", nombre: "Powerlift" },
  { id: "hebilla", nombre: "Hebilla" },
  { id: "sevilla", nombre: "Sevilla" },
  { id: "otro", nombre: "Otro" },
] as const;

/* --- Insumos ---------------------------------------------------------------
   Las secciones de la hoja «Recursos FRESA FIT», con el color con el que están
   pintadas ahí: el equipo ya reconoce cada bloque por su color y perderlo al
   pasar al CRM habría sido perder la mitad de la lectura. --- */
/* Los bloques de colores de la hoja «Recursos FRESA FIT»: en el piso se busca
   por color antes que por nombre («el bloque rosa de las cintas»). Van saturados
   a propósito —la fila entera se tiñe con esto— y respetando el color que tiene
   cada sección en la hoja, incluido el ámbar de VARIOS, que aquí se llama Otro. */
export const CATEGORIAS_INSUMO = [
  { id: "bolsas", nombre: "Bolsas para paquetería", color: "#6c5ce7" },
  { id: "etiquetas", nombre: "Etiquetas", color: "#8b5cf6" },
  { id: "sobres", nombre: "Sobres", color: "#16a34a" },
  { id: "cintas", nombre: "Cintas", color: "#ec4899" },
  { id: "cajas", nombre: "Cajas", color: "#ef4444" },
  { id: "otro", nombre: "Otro", color: "#f59e0b" },
] as const;

/* Si ya llegó el papel de un gasto. «Aun no» de la hoja de facturas = pendiente:
   se pagó, pero el comprobante no ha llegado. */
export const ESTADOS_COMPROBANTE = [
  { id: "si", nombre: "Sí", color: "#22c55e" },
  { id: "pendiente", nombre: "Aún no", color: "#f59e0b" },
  { id: "no", nombre: "No", color: "#d63031" },
] as const;

/* Envíos "full": el stock se manda al centro de la plataforma. Amazon todavía
   no es un canal de venta del CRM, pero las cajas ya se arman con su ASIN. */
export const DESTINOS_FULL = [
  { id: "amazon", nombre: "Amazon", color: "#f39c12" },
  { id: "mercado_libre", nombre: "Mercado Libre", color: "#f39c12" },
] as const;

/* Cómo viaja la caja al centro. Sugerencias de un datalist, no un enum: la
   paquetería cotiza con los nombres que se le ocurren. */
export const TIPOS_ENVIO_FULL = ["Terrestre", "Aéreo", "Marítimo"] as const;

export const ESTADOS_ENVIO_FULL = [
  { id: "preparando", nombre: "Preparando", color: "#f59e0b" },
  { id: "enviado", nombre: "Enviado", color: "#22c55e" },
  { id: "cancelado", nombre: "Cancelado", color: "#d63031" },
] as const;

/* Qué papel juega cada componente dentro de un conjunto. */
export const ROLES_COMPONENTE = [
  { id: "cinturon", nombre: "Cinturón" },
  { id: "munequeras", nombre: "Muñequeras" },
  { id: "straps", nombre: "Straps" },
  { id: "otro", nombre: "Otro" },
] as const;

/* --- Programa de influencers -----------------------------------------------
   Los cinco niveles del documento de specs del programa. Cada tier trae lo que
   se le ofrece: crédito mensual en producto, el descuento de su código, la
   comisión sobre lo que venda y los entregables que se le piden. Son los
   valores POR DEFECTO: la ficha de cada persona puede sobreescribirlos porque
   en la práctica se negocian caso por caso. --- */
export const TIERS_INFLUENCER = [
  {
    id: "nano",
    nombre: "Nano creador",
    seguidores: "3k – 10k",
    creditoMensual: 3000,
    descuentoPct: 10,
    comisionPct: 0,
    entregables: "4 videos al mes en colaboración + 2 stories por semana",
    color: "#94a3b8",
  },
  {
    id: "micro",
    nombre: "Micro creador",
    seguidores: "10k – 50k",
    creditoMensual: 4000,
    descuentoPct: 10,
    comisionPct: 5,
    entregables: "4–6 videos al mes + 2–3 stories por semana",
    color: "#0984e3",
  },
  {
    id: "mid",
    nombre: "Mid creador",
    seguidores: "50k – 100k",
    creditoMensual: 5000,
    descuentoPct: 10,
    comisionPct: 10,
    entregables: "4–6 videos al mes + co-creación de producto",
    color: "#6c5ce7",
  },
  {
    id: "macro",
    nombre: "Macro creador",
    seguidores: "100k – 500k",
    creditoMensual: 5000,
    descuentoPct: 15,
    comisionPct: 10,
    entregables: "Contrato anual; campañas y presencia en lanzamientos",
    color: "#e84393",
  },
  {
    id: "celebrity",
    nombre: "Celebrity",
    seguidores: "500k+",
    creditoMensual: null,
    descuentoPct: 15,
    comisionPct: 10,
    entregables: "Catálogo completo; rostro oficial de la marca",
    color: "#fdcb6e",
  },
] as const;

/* Etapas por las que pasa alguien en el programa. El orden es el avance real:
   llega por el formulario, se evalúa, entra activo, y puede pausarse o salir. */
export const ETAPAS_INFLUENCER = [
  { id: "prospecto", nombre: "Prospecto", color: "#94a3b8" },
  { id: "evaluacion", nombre: "En evaluación", color: "#f59e0b" },
  { id: "activo", nombre: "Activo", color: "#22c55e" },
  { id: "pausado", nombre: "Pausado", color: "#e17055" },
  { id: "rechazado", nombre: "Rechazado", color: "#d63031" },
  { id: "baja", nombre: "Baja", color: "#636e72" },
] as const;

/* Los dos meses de prueba del programa: cuándo termina el periodo. */
export const MESES_PRUEBA_INFLUENCER = 2;

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
   "activo: true" = construido. "soloAdmin" = solo para quien lleva la
   administración (dirección y administración); oculto para los demás roles. --- */
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
  /* Bodega era una subruta de Inventario y salió a su propio botón: es el
     trabajo del piso —recibir, armar conjuntos, preparar los full, gastar
     insumos— y se hace desde el celular, no desde el catálogo. Va pegada a
     Inventario porque es la otra mitad de la misma mercancía. */
  { id: "bodega", nombre: "Bodega", icono: "📥", href: "/bodega", activo: true, espacio: "fresafit" },
  /* A quién se le compra y qué se le pidió. Salió de Inventario porque son dos
     preguntas distintas —cuánto tengo / a quién le compro— y juntas hacían una
     pantalla de seis pestañas. `soloDireccion` porque lleva costos de compra y
     condiciones de proveedor: es el escalón de arriba, ni siquiera
     administración entra. */
  { id: "proveedores", nombre: "Proveedores", icono: "🏭", href: "/proveedores", activo: true, soloDireccion: true, espacio: "fresafit" },
  { id: "metricas", nombre: "Métricas", icono: "📊", href: "/metricas", activo: true, espacio: "fresafit" },
  /* Va pegado a Métricas porque contesta la otra mitad de la misma pregunta: no
     cuánto vendimos, sino cómo nos está tratando cada plataforma. */
  { id: "canales", nombre: "Canales", icono: "🛒", href: "/canales", activo: true, espacio: "fresafit" },
  { id: "finanzas", nombre: "Finanzas y gastos", icono: "💰", href: "/finanzas", activo: true, soloAdmin: true, espacio: "fresafit" },
  /* Influencers no es una entrada del menú: vive como pestaña dentro de este
     módulo (solo la ven gestores). Son gente que trae ventas, igual que los
     clientes, y separarlos en un módulo aparte los dejaba en el olvido. */
  { id: "clientes", nombre: "Clientes y ventas", icono: "🧑", href: "/clientes", activo: true, espacio: "fresafit" },
  /* Los cinturones personalizados son su propio negocio dentro del negocio: los
     capturan y los mueven los diseñadores, que no entran a bodega. */
  { id: "personalizados", nombre: "Personalizados", icono: "🎨", href: "/personalizados", activo: true, espacio: "fresafit" },
  { id: "pedidos", nombre: "Pedidos y envíos", icono: "📦", href: "/pedidos", activo: true, espacio: "fresafit" },
  /* Nómina y reportes existen en los dos negocios: son las mismas tablas
     filtradas por empresa (null = Fresafit). Sueldos internos, así que Nómina va
     restringida a administración igual que Finanzas.
     Reportes es el escalón de arriba y no por celo: el cierre resta los egresos
     de los ingresos, así que enseñarlo es enseñar las dos mitades a la vez. Quien
     captura los gastos no tiene por qué ver contra cuánto se comparan. */
  { id: "nomina", nombre: "Nómina", icono: "👥", href: "/nomina", activo: true, soloAdmin: true, espacio: "fresafit" },
  { id: "reportes", nombre: "Reportes", icono: "📈", href: "/reportes", activo: true, soloDireccion: true, espacio: "fresafit" },
  /* Quién es quién y qué alcanza cada quien. Es la pantalla desde la que
     dirección reparte el acceso —rol, área y quién entra a la Agencia— sin
     tener que pedir SQL. Solo dirección: es el módulo que reparte el poder. */
  { id: "equipo", nombre: "Equipo", icono: "🪪", href: "/equipo", activo: true, soloDireccion: true, espacio: "fresafit" },
  /* Agencia. El espacio entero está detrás de `profiles.ve_agencia`: es un
     permiso por persona, porque quienes la llevan no forman un rol (hay dos
     direcciones dentro y una fuera). Dentro, lo administrativo —contratos
     ajenos y sueldos— sigue pidiendo además `soloAdmin`, y la RLS lo refuerza.
     Las TAREAS no piden nada más: las trabaja quien atiende a cada cliente. */
  { id: "agencia-tareas", nombre: "Tareas", icono: "✅", href: "/agencia/tareas", activo: true, espacio: "agencia" },
  { id: "agencia-empresas", nombre: "Empresas", icono: "🏢", href: "/agencia/empresas", activo: true, soloAdmin: true, espacio: "agencia" },
  { id: "agencia-cobros", nombre: "Cobros", icono: "🧾", href: "/agencia/cobros", activo: true, soloAdmin: true, espacio: "agencia" },
  { id: "agencia-nomina", nombre: "Nómina", icono: "👥", href: "/agencia/nomina", activo: true, soloAdmin: true, espacio: "agencia" },
  { id: "agencia-reportes", nombre: "Reportes", icono: "📈", href: "/agencia/reportes", activo: true, soloAdmin: true, espacio: "agencia" },
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
  // Administración (gastos, nómina, reportes y cobros de la agencia)
  { slug: "diana", email: "diana@fresafit.com.mx", nombre: "Diana", rol: "administracion", area: "administracion", color: "#00cec9" },
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
export function obtenerEstadoRecepcion(id: string) {
  return ESTADOS_RECEPCION.find((e) => e.id === id) ?? null;
}
export function obtenerEstadoPersonalizado(id: string) {
  return ESTADOS_PERSONALIZADO.find((e) => e.id === id) ?? null;
}
export function obtenerCategoriaInsumo(id: string | null | undefined) {
  return CATEGORIAS_INSUMO.find((c) => c.id === id) ?? null;
}
export function obtenerEstadoComprobante(id: string | null | undefined) {
  return ESTADOS_COMPROBANTE.find((e) => e.id === id) ?? null;
}
export function obtenerEstadoEnvioFull(id: string) {
  return ESTADOS_ENVIO_FULL.find((e) => e.id === id) ?? null;
}
export function obtenerTierInfluencer(id: string | null | undefined) {
  return TIERS_INFLUENCER.find((t) => t.id === id) ?? null;
}
export function obtenerEtapaInfluencer(id: string | null | undefined) {
  return ETAPAS_INFLUENCER.find((e) => e.id === id) ?? null;
}

/* --- Ayudantes de rol ---
   Tres niveles, de mayor a menor alcance, espejo de los helpers de la BD:

     rol === "direccion"      → es_admin(uid): manda. Cambia roles del equipo y
                                corrige ventas importadas por API.
     puedeAdministrar(rol)    → es_administrativo(): lleva la administración
                                (gastos, nómina, reportes, agencia).
     esGestor(rol)            → es_gestor(): manda en el tablero de tareas. */

export function esGestor(rol: string | null | undefined) {
  return rol === "direccion" || rol === "administracion" || rol === "coordinador";
}

/* ¿Es del equipo de casa? (todo menos `externo`). Espejo de public.es_interno().
   Vive aquí —y no solo en lib/supabase/usuario-actual.ts, que es de servidor—
   porque los componentes de cliente también lo preguntan: crear tareas dejó de
   ser privilegio de gestor y lo puede hacer cualquiera del equipo. */
export function esInterno(rol: string | null | undefined) {
  return esGestor(rol) || rol === "miembro";
}

/* ¿Puede entrar a los módulos administrativos (dinero y papeles)? */
export function puedeAdministrar(rol: string | null | undefined) {
  return rol === "direccion" || rol === "administracion";
}

/* El escalón de arriba. Existe como función —y no como `rol === "direccion"`
   suelto por ahí— porque ya son varios sitios los que lo preguntan. */
export function esDireccion(rol: string | null | undefined) {
  return rol === "direccion";
}

/* ¿Entra al espacio Agencia? NO se deduce del rol a propósito: la Agencia la
   llevan cuatro personas, y entre ellas hay dos direcciones pero no las dos que
   existen (René es dirección y no entra), ni la administración (Diana). Es un
   permiso por persona —`profiles.ve_agencia`— que dirección cambia desde
   /equipo. Espejo de lo que aplican el layout de /agencia y el menú. */
export function veAgencia(perfil: { ve_agencia?: boolean | null } | null | undefined) {
  return !!perfil?.ve_agencia;
}

/* Lo que una persona alcanza del menú. Es la regla ÚNICA de visibilidad de
   módulos: la usa el menú para pintarse y la pantalla de Equipo para contar qué
   ve cada quien. Que sea la misma función es el punto — una lista de permisos
   escrita a mano al lado del filtro real envejece y acaba mintiendo.

     soloAdmin     → dinero y papeles (dirección + administración).
     soloDireccion → el escalón de arriba (costos de compra, repartir accesos).
     espacio agencia → permiso por persona, ver veAgencia(). */
export type PerfilPermisos =
  | { rol?: string | null; ve_agencia?: boolean | null; modulos_ocultos?: string[] | null }
  | null
  | undefined;

/* La portada del CRM. No se puede restringir: es a donde va a parar quien entra
   a una sección que no le toca, así que cerrarla sería un rebote infinito. Y de
   todas formas las tareas propias las tiene cualquiera. */
export const MODULO_PORTADA = "tareas";

export function puedeVerModulo(m: (typeof MODULOS)[number], perfil: PerfilPermisos): boolean {
  return (
    (!("soloAdmin" in m && m.soloAdmin) || puedeAdministrar(perfil?.rol)) &&
    (!("soloDireccion" in m && m.soloDireccion) || esDireccion(perfil?.rol)) &&
    (m.espacio !== "agencia" || veAgencia(perfil)) &&
    /* Restricciones sueltas puestas desde /equipo. Lista NEGRA: solo resta.
       Nunca podría sumar, porque el dinero lo cierra la RLS y no esta línea. */
    !(perfil?.modulos_ocultos ?? []).includes(m.id)
  );
}

export function modulosVisibles(perfil: PerfilPermisos) {
  return MODULOS.filter((m) => m.activo && puedeVerModulo(m, perfil));
}

/* El TECHO: lo que el rol (y el permiso de Agencia) le permitirían ver a esta
   persona si no tuviera ninguna restricción suelta. Es lo que /equipo ofrece
   como interruptores —lo que se le puede quitar y devolver—, mientras que
   `modulosVisibles` es lo que de verdad ve hoy. */
export function modulosDelRol(perfil: PerfilPermisos) {
  const sinRestricciones = { ...(perfil ?? {}), modulos_ocultos: [] };
  return MODULOS.filter((m) => m.activo && puedeVerModulo(m, sinRestricciones));
}

export function obtenerModulo(id: string) {
  return MODULOS.find((m) => m.id === id) ?? null;
}

/* A dónde mandar a alguien que llegó a una sección que no le toca: lo primero
   que sí alcanza. Casi siempre es /tareas —que no se puede restringir—, pero se
   calcula por si un día la portada cambia o alguien queda sin nada. */
export function destinoSeguro(perfil: PerfilPermisos): string {
  return modulosVisibles(perfil)[0]?.href ?? "/tareas";
}
