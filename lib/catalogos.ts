/* ============================================================================
   lib/catalogos.ts  —  Constantes del negocio (Fresafit CRM)
   ----------------------------------------------------------------------------
   Listas fijas que usa toda la app: estados del tablero, prioridades, áreas,
   roles, etiquetas y los módulos del menú. Única fuente de verdad para las
   uniones de tipos (ver lib/types.ts).

   El "equipo" son usuarios reales de Supabase Auth (tabla `profiles`).
   EQUIPO_SEED es la referencia para sembrarlos (ver scripts/seed.mjs).
   ============================================================================ */

import { SLUG_A_CANAL_VENTA } from "@/lib/canales/tipos";

/* --- Estados del tablero (las columnas del Kanban). El orden = orden de columnas.
   `color` se usa para la pastilla de estado en la vista de tabla y el calendario.

   `fueraDelTablero` marca los estados que existen pero NO son columna: cancelada
   es una decisión, no un paso del trabajo, y darle carril propio llenaría el
   tablero de cosas que ya nadie va a mover. Se elige desde el detalle y desde el
   selector de estado; para pintar columnas está ESTADOS_TABLERO. */
export const ESTADOS = [
  { id: "por_hacer", nombre: "Por hacer", color: "#94a3b8" },   // gris
  { id: "en_proceso", nombre: "En proceso", color: "#f59e0b" }, // ámbar
  { id: "atorado", nombre: "Atorado", color: "#f97316" },       // naranja: bloqueada, necesita algo de vuelta
  { id: "en_revision", nombre: "En revisión", color: "#8b5cf6" },// morado
  { id: "hecho", nombre: "Hecho", color: "#22c55e" },           // verde
  /* Se pidió con el módulo de empresas: las tareas del cliente NO se borran, se
     cancelan, y el registro permanece. Sirve igual para el tablero interno. */
  { id: "cancelada", nombre: "Cancelada", color: "#64748b", fueraDelTablero: true }, // pizarra
] as const;

/* Las columnas del Kanban: todo lo que no está marcado como fuera del tablero. */
export const ESTADOS_TABLERO = ESTADOS.filter(
  (e) => !("fueraDelTablero" in e && e.fueraDelTablero),
);

/* Una tarea deja de contar como pendiente cuando se terminó o se canceló. La
   lista vive aquí para que los contadores del menú, el cron de recordatorios y
   los resúmenes no se desincronicen cada vez que aparece un estado nuevo. */
export const ESTADOS_CERRADOS = ["hecho", "cancelada"] as const;

/* --- Prioridades (con color para verse de un vistazo).
   `urgente` la trajo el módulo de empresas: además de pintarse distinto, es la
   que avisa en el momento en vez de esperar al resumen diario. --- */
export const PRIORIDADES = [
  { id: "urgente", nombre: "Urgente", color: "#b91c1c" }, // rojo oscuro
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
  /* El maquilero (Eduardo) produce los cinturones bajo pedido. No es equipo de
     casa ni cliente del portal: es la tercera rama del árbol. Solo alcanza el
     tablero de Maquila México, y la RLS le abre exactamente eso (es_maquilero()
     en la BD, migración 20260919000000). */
  { id: "maquilero", nombre: "Maquilero", desc: "Produce bajo pedido: solo ve el tablero de Maquila México." },
] as const;

/* --- Módulo de empresas: el papel de cada persona DENTRO de la empresa cliente.
   Va aparte del rol porque son dos preguntas distintas: `rol` dice si alguien es
   de casa o de fuera, y esto dice qué puede hacer el de fuera. Espejo de
   public.es_externo_admin(). --- */
export const ROLES_PORTAL = [
  { id: "admin_cliente", nombre: "Administrador", desc: "Pide cosas a Fresafit, sube documentos y cierra lo que su empresa abrió." },
  { id: "colaborador", nombre: "Colaborador", desc: "Ve lo compartido, comenta y sube documentos. No abre pedidos nuevos ni cierra los nuestros." },
] as const;

/* --- El nivel de visibilidad que lleva CADA elemento del módulo de empresas
   (tareas, documentos, bitácora, incidencias).

   El default es `interno` en todas partes —columna, formularios y acciones— y no
   es un detalle: compartir tiene que ser deliberado. Es más fácil compartir
   después que arrepentirse de haber expuesto algo.

   Quien manda de verdad es la RLS: estas etiquetas solo pintan lo que la base ya
   decidió. --- */
export const VISIBILIDADES = [
  { id: "privado", nombre: "Privado", desc: "Solo dirección.", color: "#7f1d1d", icono: "🔒" },
  { id: "interno", nombre: "Interno", desc: "Solo el equipo de Fresafit.", color: "#475569", icono: "🏠" },
  { id: "compartido", nombre: "Compartido", desc: "El equipo y la empresa cliente.", color: "#0e7490", icono: "🤝" },
] as const;

/* --- Categorías del archivo de documentos de una empresa cliente.

   `caduca` marca las que suelen traer fecha de vigencia: al elegirlas, el
   formulario pide la fecha en vez de esconderla. Es lo que hace que la alerta de
   vencimiento sirva de algo — una constancia sin fecha capturada no avisa nunca,
   y es justo la que hay que renovar. --- */
export const CATEGORIAS_DOCUMENTO = [
  { id: "fiscal", nombre: "Fiscal", desc: "Constancia de situación fiscal, RFC, régimen.", color: "#00b894", caduca: true },
  { id: "legal", nombre: "Legal", desc: "Contratos, anexos, convenios, poderes, INE.", color: "#2d3436", caduca: true },
  { id: "facturas_pagos", nombre: "Facturas y pagos", desc: "CFDI emitidos y recibidos, comprobantes.", color: "#00cec9" },
  { id: "sanitario", nombre: "Sanitario", desc: "Registros COFEPRIS, permisos, etiquetado aprobado.", color: "#e17055", caduca: true },
  { id: "marca", nombre: "Marca", desc: "Brandbook, logos, tipografías, fotos de producto.", color: "#e84393" },
  { id: "producto", nombre: "Producto", desc: "Fichas técnicas, certificados de análisis, listas de precios.", color: "#0984e3" },
  { id: "operacion", nombre: "Operación", desc: "Reportes, capturas, evidencias.", color: "#6c5ce7" },
  { id: "otros", nombre: "Otros", desc: "Lo que no cae en las anteriores.", color: "#94a3b8" },
] as const;

/* --- Incidencias del avance: en qué va cada bloqueo, y de qué lado está la
   pelota. `desbloquea` no es un estado sino un dueño, y por eso va aparte: son
   las dos preguntas que se hacen a la vez ante algo frenado —«¿cómo va?» y «¿a
   quién le toca?»— y mezclarlas dejaba una sin respuesta. --- */
export const ESTADOS_INCIDENCIA = [
  { id: "abierta", nombre: "Abierta", color: "#d63031" },
  { id: "en_resolucion", nombre: "En resolución", color: "#f59e0b" },
  { id: "resuelta", nombre: "Resuelta", color: "#22c55e" },
] as const;

export const LADOS_INCIDENCIA = [
  { id: "fresafit", nombre: "Fresafit", desc: "Nos toca a nosotros destrabarlo." },
  { id: "cliente", nombre: "El cliente", desc: "Está en su cancha." },
] as const;

/* Cuánto antes se avisa de que un documento pierde vigencia. Treinta días es lo
   que tarda en la práctica renovar una constancia o un permiso: avisar el mismo
   día solo sirve para enterarse de que ya es tarde. */
export const DIAS_AVISO_VENCIMIENTO = 30;

/* --- Categorías de las tareas con una empresa cliente.

   `exigeAdjunto` / `exigeComentario`: qué hace falta para poder darlas por
   cerradas. Una tarea de «Documentos» sin archivo no está resuelta —el archivo
   ES el resultado—, y una de «Pago» sin una línea que diga cuándo y por cuánto
   deja la conversación abierta. Se valida en la acción de cambio de estado.

   Vive como constante y no como tabla de configuración a propósito: son ocho
   categorías que se acordaron una vez, y una pantalla para editarlas costaría
   más que el problema que resuelve. Si algún día se quieren cambiar sin
   desplegar, esto se vuelve tabla y la acción la lee. --- */
export const CATEGORIAS_TAREA = [
  { id: "documentos", nombre: "Documentos", color: "#0984e3", exigeAdjunto: true, exigeComentario: false },
  { id: "accesos", nombre: "Accesos", color: "#6c5ce7", exigeAdjunto: false, exigeComentario: true },
  { id: "producto", nombre: "Producto", color: "#00b894", exigeAdjunto: false, exigeComentario: false },
  { id: "inventario", nombre: "Inventario", color: "#e17055", exigeAdjunto: false, exigeComentario: false },
  { id: "pago", nombre: "Pago", color: "#00cec9", exigeAdjunto: false, exigeComentario: true },
  { id: "contenido", nombre: "Contenido", color: "#e84393", exigeAdjunto: false, exigeComentario: false },
  { id: "legal", nombre: "Legal", color: "#2d3436", exigeAdjunto: true, exigeComentario: false },
  { id: "otro", nombre: "Otro", color: "#94a3b8", exigeAdjunto: false, exigeComentario: false },
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

/* --- Cómo viaja un pedido a proveedor (junta 13/08): el aéreo llega en días,
   el marítimo express en semanas y el normal en meses. Informa la ETA y el
   costo, pero no los calcula: eso sigue siendo manual a propósito. --- */
export const TIPOS_ENVIO_PROVEEDOR = [
  { id: "aereo", nombre: "Aéreo", color: "#0984e3" },
  { id: "maritimo_express", nombre: "Marítimo express", color: "#00b894" },
  { id: "maritimo_normal", nombre: "Marítimo normal", color: "#6c5ce7" },
] as const;

export function obtenerTipoEnvioProveedor(id: string | null) {
  return TIPOS_ENVIO_PROVEEDOR.find((t) => t.id === id) ?? null;
}

/* --- Qué es cada archivo colgado a un pedido a proveedor. --- */
export const TIPOS_ARCHIVO_PEDIDO = [
  { id: "factura", nombre: "Factura del proveedor" },
  { id: "pago_internacional", nombre: "Pago internacional" },
  { id: "foto_proveedor", nombre: "Foto del proveedor" },
  { id: "otro", nombre: "Otro" },
] as const;

export function obtenerTipoArchivoPedido(id: string) {
  return TIPOS_ARCHIVO_PEDIDO.find((t) => t.id === id) ?? null;
}

/* --- Estados de un pedido/envío (Fase 5). El orden = avance del flujo. --- */
export const ESTADOS_PEDIDO = [
  { id: "nuevo", nombre: "Nuevo", color: "#0984e3" },
  { id: "preparando", nombre: "Preparando", color: "#f59e0b" },
  { id: "enviado", nombre: "Enviado", color: "#6c5ce7" },
  { id: "entregado", nombre: "Entregado", color: "#22c55e" },
  /* El paquete se regresó al remitente. Existe porque una devolución se veía
     igual que un envío en camino —"Enviado" para siempre— y no había forma de
     contarlas ni de sacarlas de la bandeja. Lo detectan el rastreo de la guía
     (lib/envia/rastreo.ts) y el `substatus` de Mercado Libre. NO reingresa
     stock: la mercancía vuelve cuando bodega la recibe y la captura. */
  { id: "devuelto", nombre: "Devuelto", color: "#e17055" },
  { id: "cancelado", nombre: "Cancelado", color: "#d63031" },
] as const;

/* Los estados que cuentan como "pendiente" (aún dan trabajo). */
export const ESTADOS_PEDIDO_PENDIENTES = ["nuevo", "preparando", "enviado"] as const;

/* --- Las cuatro etapas FÍSICAS de la mesa de empaque (tablero de /pedidos) ---

   No son estados del pedido y no sustituyen a ESTADOS_PEDIDO: aquéllos dicen
   dónde va el pedido de cara al canal, éstas dicen dónde está la caja. Los dos
   son ciertos a la vez —un paquete puede llevar veinte minutos en "Revisión de
   calidad" y para Mercado Libre seguir siendo, correctamente, "preparando"—.

   Salen de un "Rastreador de paquetes" que bodega usaba fuera del CRM: el
   vocabulario es el suyo, no uno inventado aquí, y por eso "Sellado y esperando
   recolección" va con ese nombre largo en vez de un "Sellado" más cómodo.

   El orden ES el avance del flujo: el tablero pinta las columnas en este orden y
   los botones ◀ ▶ de la tarjeta se mueven por el índice. Se guarda en
   `sales.etapa_empaque` (migración 20261024000000). */
export const ETAPAS_EMPAQUE = [
  { id: "preparado", nombre: "Preparado", color: "#f59e0b" },
  { id: "calidad", nombre: "Revisión de calidad", color: "#0984e3" },
  { id: "sellado", nombre: "Sellado y esperando recolección", color: "#6c5ce7" },
  { id: "recolectado", nombre: "Recolectado", color: "#22c55e" },
] as const;


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
  { id: "mercadolibre", nombre: "Mercado Libre", href: "/canales/mercadolibre", canal: SLUG_A_CANAL_VENTA.mercadolibre, activo: true },
  { id: "tiendanube", nombre: "Tienda Nube", href: "/canales/tiendanube", canal: SLUG_A_CANAL_VENTA.tiendanube, activo: true },
  { id: "tiktok", nombre: "TikTok Shop", href: "/canales/tiktok", canal: SLUG_A_CANAL_VENTA.tiktok, activo: true },
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
/* Los cuatro primeros y el último son EXACTAMENTE los colores con los que el
   equipo pinta las celdas en la hoja «Personalizados FRESA FIT» (gris recibido,
   amarillo diseño, naranja Eduardo, verde enviado): así el tablero se lee igual
   aquí que allá. «En producción» y «Listo» no existen en la hoja —son del CRM—
   y por eso son los dos que no salen de ese muestrario. */
export const ESTADOS_PERSONALIZADO = [
  { id: "recibido", nombre: "Recibido", color: "#9e9e9e" },
  { id: "diseno", nombre: "En diseño", color: "#f5b301" },
  { id: "eduardo", nombre: "Con Eduardo", color: "#f4600d" },
  { id: "produccion", nombre: "En producción", color: "#6c5ce7" },
  { id: "listo", nombre: "Listo", color: "#0e9f6e" },
  { id: "enviado", nombre: "Enviado", color: "#00c46a" },
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

/* --- Maquila México --------------------------------------------------------
   Producción bajo pedido con Eduardo. El vocabulario espeja los CHECKs de
   `maquila_pedidos` (20260924000000): si aquí se agrega un id, la BD tiene que
   enterarse por migración. El comportamiento (rutas, fechas hábiles, semáforo)
   NO vive aquí sino en lib/maquila/reglas.ts, siguiendo el reparto de
   lib/tareas/reglas.ts: esto son nombres y colores, aquello son reglas. --- */

/* El recorrido del pedido. El orden = avance real; `esperando_pago` existe pero
   no es producción (para Eduardo ni siquiera existe: su RLS lo excluye), y
   cancelado/devuelto son decisiones, no pasos. */
export const ESTADOS_MAQUILA = [
  { id: "esperando_pago", nombre: "Esperando pago", color: "#94a3b8" },
  { id: "recibido", nombre: "Recibido", color: "#0984e3" },
  { id: "pendiente_produccion", nombre: "Pendiente de producción", color: "#f59e0b" },
  { id: "en_produccion", nombre: "En producción", color: "#e17055" },
  { id: "terminado", nombre: "Terminado", color: "#6c5ce7" },
  { id: "enviado", nombre: "Enviado", color: "#16a34a" },
  { id: "entregado", nombre: "Entregado", color: "#22c55e" },
  { id: "cancelado", nombre: "Cancelado", color: "#d63031" },
  { id: "devuelto", nombre: "Devuelto", color: "#64748b" },
] as const;

/* Los estados en los que la pieza sigue en manos de Eduardo: los que vigilan la
   fecha prometida y cuentan como atrasados si se pasa. */
export const ESTADOS_MAQUILA_ACTIVOS = [
  "recibido",
  "pendiente_produccion",
  "en_produccion",
  "terminado",
] as const;

/* Sub-estados de la producción por lote (sublimado/bordado): la trazabilidad
   del TERCERO —bordador/impresor—, que es el riesgo #1 del proyecto. Solo
   existen dentro de `en_produccion` y la BD lo exige con un CHECK. */
export const SUBESTADOS_MAQUILA = [
  { id: "entregado_a_tercero", nombre: "Con el tercero", color: "#e84393" },
  { id: "recogido_de_tercero", nombre: "Recogido del tercero", color: "#0984e3" },
  { id: "en_confeccion", nombre: "En confección", color: "#f59e0b" },
  { id: "listo_para_envio", nombre: "Listo para envío", color: "#22c55e" },
] as const;

/* `llevaPalanca` es la regla "un Powerlift requiere palanca" hecha dato: la
   ingesta y el formulario la leen de aquí en vez de repetir el if. */
export const MODELOS_MAQUILA = [
  { id: "powerlift", nombre: "Powerlift", llevaPalanca: true },
  { id: "hebilla", nombre: "Hebilla", llevaPalanca: false },
] as const;

/* El acabado decide la ruta de producción (ver rutaDeAcabado en
   lib/maquila/reglas.ts): prensado sale directo, el resto va por corte. */
export const ACABADOS_MAQUILA = [
  { id: "prensado", nombre: "Prensado", color: "#0984e3" },
  { id: "sublimado", nombre: "Sublimado", color: "#e84393" },
  { id: "bordado", nombre: "Bordado", color: "#6c5ce7" },
  { id: "bordado_gamuza", nombre: "Bordado + Gamuza", color: "#8b5cf6" },
] as const;

export const COMBOS_MAQUILA = [
  { id: "ninguno", nombre: "Sin combo" },
  { id: "munequeras", nombre: "Muñequeras" },
  { id: "straps", nombre: "Straps" },
  { id: "ambos", nombre: "Muñequeras + Straps" },
] as const;

/* El color se etiqueta con sticker en el taller y es donde más se equivoca el
   armado: por eso es un catálogo y no texto libre, y por eso la ficha
   imprimible lo grita en grande. */
export const COLORES_PALANCA = [
  { id: "plateada", nombre: "Plateada", color: "#94a3b8" },
  { id: "negra", nombre: "Negra", color: "#2d3436" },
] as const;

/* El pendiente de logística sobre un paquete terminado: «favor de entregar
   guía». Es una tabla aparte y NO un estado del pedido porque no depende de
   Eduardo — él no puede avanzar a algo que se destraba cuando alguien más
   sube un archivo (ver 20260926000100_maquila_guias.sql). */
export const ESTADOS_GUIA_MAQUILA = [
  { id: "solicitada", nombre: "Falta guía", color: "#f59e0b" },
  { id: "cargada", nombre: "Guía lista", color: "#0984e3" },
  { id: "entregada", nombre: "Ya salió", color: "#22c55e" },
  { id: "cancelada", nombre: "Cancelada", color: "#64748b" },
] as const;

/* Los movimientos del material que Fresa Fit le tiene a Eduardo en
   consignación (palancas, muñequeras, straps). `consumo` lo escribe un
   trigger cuando la pieza sale; los otros tres, una persona. */
export const TIPOS_MOV_CONSIGNACION = [
  { id: "envio", nombre: "Se le mandó", color: "#22c55e" },
  { id: "consumo", nombre: "Se gastó", color: "#e17055" },
  { id: "devolucion", nombre: "Regresó", color: "#0984e3" },
  { id: "ajuste", nombre: "Ajuste de conteo", color: "#f59e0b" },
] as const;

/* El corte quincenal de pago a Eduardo. `borrador` se puede recalcular;
   `cerrado` ya congeló anticipos y total; `pagado` es el final. Cancelar anula
   los renglones y libera los pedidos para otro corte — nunca borra. */
export const ESTADOS_CORTE_MAQUILA = [
  { id: "borrador", nombre: "Borrador", color: "#94a3b8" },
  { id: "cerrado", nombre: "Cerrado", color: "#f59e0b" },
  { id: "pagado", nombre: "Pagado", color: "#22c55e" },
  { id: "cancelado", nombre: "Cancelado", color: "#d63031" },
] as const;

/* Cómo se le adelantó el dinero. `especie` es «tiene a favor 20 gamuzas»: se
   guarda el valor acordado, que es lo que el corte resta. */
export const TIPOS_ANTICIPO_MAQUILA = [
  { id: "transferencia", nombre: "Transferencia" },
  { id: "efectivo", nombre: "Efectivo" },
  { id: "especie", nombre: "En especie (material)" },
  { id: "otro", nombre: "Otro" },
] as const;

/* Lo que se reporta de un pedido de maquila, en los dos sentidos: el equipo
   avisa que una pieza salió mal, Eduardo avisa que le falta material o que su
   imprenta lo dejó colgado. Eso último es la evidencia con la que después se
   discute de quién fue el retraso. */
export const TIPOS_INCIDENCIA_MAQUILA = [
  { id: "calidad", nombre: "Calidad", color: "#d63031" },
  { id: "retraso", nombre: "Retraso", color: "#f59e0b" },
  { id: "faltante", nombre: "Falta material", color: "#e17055" },
  { id: "diseno", nombre: "Problema con el diseño", color: "#6c5ce7" },
  { id: "otro", nombre: "Otro", color: "#64748b" },
] as const;

/* A quién le toca resolver la incidencia. No da permisos: es para saber de
   quién es el pendiente. */
export const DESTINOS_INCIDENCIA_MAQUILA = [
  { id: "equipo", nombre: "Fresa Fit" },
  { id: "maquilero", nombre: "Eduardo" },
  { id: "diseno", nombre: "Diseño" },
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

/* --- Finanzas personales: lo que paga cada quien de su bolsa, dentro del mismo
   módulo pero en otra tabla y con otro candado (ver la migración
   20261009000000). Las categorías son las de una CASA y por eso no reusan
   CATEGORIAS_GASTO, que habla de marketing y de logística. --- */
export const CATEGORIAS_PERSONALES = [
  { id: "hogar", nombre: "Casa", color: "#e17055" },
  { id: "servicios", nombre: "Servicios", color: "#0984e3" },
  { id: "conectividad", nombre: "Internet y celular", color: "#6c5ce7" },
  { id: "suscripciones", nombre: "Suscripciones", color: "#e84393" },
  { id: "transporte", nombre: "Transporte", color: "#00b894" },
  { id: "salud", nombre: "Salud", color: "#00cec9" },
  { id: "creditos", nombre: "Créditos y seguros", color: "#d63031" },
  { id: "otro", nombre: "Otro", color: "#94a3b8" },
] as const;

/* Cada cuánto llega el cobro. `pagosAlAno` es EL dato del catálogo: con él se
   contesta cuánto cuesta el mes (monto × pagos ÷ 12) con una sola división al
   final —igual de estable que el viejo `mesesQueCubre`, pero además le cabe lo
   SEMANAL (52 pagos al año no son "0.23 meses")—. `unico` es el pago de una
   sola vez que pidió Armando: 0 pagos al año = no suma al mensualizado, y su
   fecha exacta vive en `fecha_unica`. */
export const PERIODICIDADES_PERSONALES = [
  { id: "unico", nombre: "Una sola vez", color: "#94a3b8", pagosAlAno: 0 },
  { id: "semanal", nombre: "Semanal", color: "#00cec9", pagosAlAno: 52 },
  { id: "mensual", nombre: "Mensual", color: "#0984e3", pagosAlAno: 12 },
  /* La luz en México llega cada dos meses: es el caso que obliga a normalizar. */
  { id: "bimestral", nombre: "Bimestral", color: "#6c5ce7", pagosAlAno: 6 },
  { id: "trimestral", nombre: "Trimestral", color: "#00b894", pagosAlAno: 4 },
  { id: "semestral", nombre: "Semestral", color: "#fdcb6e", pagosAlAno: 2 },
  { id: "anual", nombre: "Anual", color: "#e17055", pagosAlAno: 1 },
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
  /* El tercer espacio no es del equipo: es el de la gente de la empresa cliente
     cuando entra al CRM. No aparece en el selector —quien lo tiene no tiene
     ningún otro— y es el ÚNICO que alcanza; ver puedeVerModulo(). */
  { id: "portal", nombre: "Portal", desc: "Lo que la empresa cliente ve de su proyecto." },
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
  /* Producción bajo pedido con Eduardo. Para el equipo es un módulo normal de
     Fresafit; para el rol `maquilero` es EL ÚNICO que existe (paraMaquilero +
     la rama de puedeVerModulo). No lleva soloAdmin: operaciones y plataformas
     lo consultan a diario, y el dinero de venta ni siquiera viaja en sus
     tablas — el corte financiero lo hace el esquema, no el menú. */
  { id: "maquila", nombre: "Maquila México", icono: "🧵", href: "/maquila", activo: true, espacio: "fresafit", paraMaquilero: true },
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
  /* El espacio de trabajo compartido con cada cliente: lo que nos pedimos, los
     documentos que nos pasamos y en qué va el proyecto. Es la otra cara del
     portal —lo mismo, visto desde aquí, más lo interno—.
     Sin `soloAdmin` a propósito: /agencia/empresas es lo COMERCIAL (contratos y
     lo que se cobra) y esto es el trabajo del día, que lo lleva quien atiende al
     cliente, no quien le factura. */
  { id: "agencia-clientes", nombre: "Clientes", icono: "🤝", href: "/agencia/clientes", activo: true, espacio: "agencia" },
  { id: "agencia-empresas", nombre: "Empresas", icono: "🏢", href: "/agencia/empresas", activo: true, soloAdmin: true, espacio: "agencia" },
  { id: "agencia-cobros", nombre: "Cobros", icono: "🧾", href: "/agencia/cobros", activo: true, soloAdmin: true, espacio: "agencia" },
  { id: "agencia-nomina", nombre: "Nómina", icono: "👥", href: "/agencia/nomina", activo: true, soloAdmin: true, espacio: "agencia" },
  { id: "agencia-reportes", nombre: "Reportes", icono: "📈", href: "/agencia/reportes", activo: true, soloAdmin: true, espacio: "agencia" },
  /* Portal: lo que ve la empresa cliente. Estas tres entradas son las ÚNICAS que
     alcanza un rol `externo`, y a la vez son invisibles para el equipo de casa
     (ver puedeVerModulo): el portal enseña los datos ya cortados por la RLS, así
     que un interno que entrara ahí vería su propia pantalla a medias. */
  { id: "portal-tareas", nombre: "Tareas", icono: "✅", href: "/portal/tareas", activo: true, espacio: "portal" },
  { id: "portal-documentos", nombre: "Documentos", icono: "📄", href: "/portal/documentos", activo: true, espacio: "portal" },
  { id: "portal-avance", nombre: "Avance", icono: "📈", href: "/portal/avance", activo: true, espacio: "portal" },
] as const;

/* A qué espacio pertenece una ruta. Todo lo que cuelga de /agencia es de la
   agencia y lo de /portal es del cliente; el resto es Fresafit. */
export function espacioDeRuta(pathname: string): EspacioId {
  if (pathname.startsWith("/agencia")) return "agencia";
  if (pathname.startsWith("/portal")) return "portal";
  return "fresafit";
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
export function obtenerCategoriaPersonal(id: string | null | undefined) {
  return CATEGORIAS_PERSONALES.find((c) => c.id === id) ?? null;
}
export function obtenerPeriodicidadPersonal(id: string | null | undefined) {
  return PERIODICIDADES_PERSONALES.find((p) => p.id === id) ?? null;
}
export function obtenerEstadoPedido(id: string) {
  return ESTADOS_PEDIDO.find((e) => e.id === id) ?? null;
}
export function obtenerEtapaEmpaque(id: string | null | undefined) {
  return ETAPAS_EMPAQUE.find((e) => e.id === id) ?? null;
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
export function obtenerVisibilidad(id: string | null | undefined) {
  return VISIBILIDADES.find((v) => v.id === id) ?? null;
}
export function obtenerCategoriaTarea(id: string | null | undefined) {
  return CATEGORIAS_TAREA.find((c) => c.id === id) ?? null;
}
export function obtenerRolPortal(id: string | null | undefined) {
  return ROLES_PORTAL.find((r) => r.id === id) ?? null;
}
export function obtenerCategoriaDocumento(id: string | null | undefined) {
  return CATEGORIAS_DOCUMENTO.find((c) => c.id === id) ?? null;
}
export function obtenerEstadoIncidencia(id: string | null | undefined) {
  return ESTADOS_INCIDENCIA.find((e) => e.id === id) ?? null;
}
export function obtenerEstadoMaquila(id: string | null | undefined) {
  return ESTADOS_MAQUILA.find((e) => e.id === id) ?? null;
}
export function obtenerSubestadoMaquila(id: string | null | undefined) {
  return SUBESTADOS_MAQUILA.find((s) => s.id === id) ?? null;
}
export function obtenerModeloMaquila(id: string | null | undefined) {
  return MODELOS_MAQUILA.find((m) => m.id === id) ?? null;
}
export function obtenerAcabadoMaquila(id: string | null | undefined) {
  return ACABADOS_MAQUILA.find((a) => a.id === id) ?? null;
}
export function obtenerComboMaquila(id: string | null | undefined) {
  return COMBOS_MAQUILA.find((c) => c.id === id) ?? null;
}
export function obtenerColorPalanca(id: string | null | undefined) {
  return COLORES_PALANCA.find((c) => c.id === id) ?? null;
}
export function obtenerEstadoGuiaMaquila(id: string | null | undefined) {
  return ESTADOS_GUIA_MAQUILA.find((e) => e.id === id) ?? null;
}
export function obtenerTipoMovConsignacion(id: string | null | undefined) {
  return TIPOS_MOV_CONSIGNACION.find((t) => t.id === id) ?? null;
}
export function obtenerEstadoCorteMaquila(id: string | null | undefined) {
  return ESTADOS_CORTE_MAQUILA.find((e) => e.id === id) ?? null;
}
export function obtenerTipoAnticipoMaquila(id: string | null | undefined) {
  return TIPOS_ANTICIPO_MAQUILA.find((t) => t.id === id) ?? null;
}
export function obtenerTipoIncidenciaMaquila(id: string | null | undefined) {
  return TIPOS_INCIDENCIA_MAQUILA.find((t) => t.id === id) ?? null;
}
export function obtenerDestinoIncidenciaMaquila(id: string | null | undefined) {
  return DESTINOS_INCIDENCIA_MAQUILA.find((d) => d.id === id) ?? null;
}
export function obtenerLadoIncidencia(id: string | null | undefined) {
  return LADOS_INCIDENCIA.find((l) => l.id === id) ?? null;
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

/* ¿Es gente de la empresa cliente? Espejo de public.es_externo().
   Se escribe como función y no como `rol === "externo"` suelto porque es la
   pregunta que separa los dos lados del CRM, y aparece en el menú, en las
   guardias y en los formularios. */
export function esExterno(rol: string | null | undefined) {
  return rol === "externo";
}

/* ¿Es el maquilero? Espejo de public.es_maquilero(). La tercera rama del
   árbol: ni equipo de casa ni cliente del portal. Produce los pedidos de
   Maquila México y no alcanza nada más. */
export function esMaquilero(rol: string | null | undefined) {
  return rol === "maquilero";
}

/* ¿Es el administrador de su empresa? Espejo de public.es_externo_admin().
   El colaborador ve lo mismo, comenta y sube archivos; lo que NO hace es abrir
   pedidos nuevos ni cerrar los que abrió Fresafit. La RLS lo impone; esto solo
   evita pintarle botones que le van a rebotar. */
export function esExternoAdmin(
  perfil: { rol?: string | null; rol_portal?: string | null } | null | undefined,
) {
  return esExterno(perfil?.rol) && perfil?.rol_portal === "admin_cliente";
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
  /* El maquilero va primero y en corte absoluto, igual que el portal para los
     externos: Eduardo solo alcanza Maquila México, y nadie más que él entra por
     esta rama — para el equipo de casa `paraMaquilero` no abre ni cierra nada
     (el módulo de maquila es de espacio fresafit y pasa por las reglas de
     siempre). */
  if (esMaquilero(perfil?.rol)) {
    return "paraMaquilero" in m && !!m.paraMaquilero;
  }
  return (
    (!("soloAdmin" in m && m.soloAdmin) || puedeAdministrar(perfil?.rol)) &&
    (!("soloDireccion" in m && m.soloDireccion) || esDireccion(perfil?.rol)) &&
    (m.espacio !== "agencia" || veAgencia(perfil)) &&
    /* El corte entre la casa y el cliente, y va en los DOS sentidos: quien es de
       fuera solo alcanza el portal, y quien es de casa no lo pisa. Esta línea es
       lo que expulsa a un externo de Inventario o de /agencia/tareas — sin ella,
       cualquier módulo sin banderas le quedaría abierto, porque hasta hoy el rol
       `externo` nunca había entrado al CRM. La puerta de cada página es
       exigirModulo(), que pregunta justo aquí. */
    (m.espacio === "portal") === esExterno(perfil?.rol) &&
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
