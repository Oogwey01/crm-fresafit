/* ============================================================================
   lib/types.ts  —  Tipos del dominio (Fresafit CRM)
   ============================================================================ */

import type {
  ESTADOS,
  PRIORIDADES,
  AREAS,
  ROLES,
  ETIQUETAS,
  TIPOS_PRODUCTO,
  ESTADOS_PEDIDO_PROVEEDOR,
  ESTADOS_PEDIDO,
  CANALES,
  CATEGORIAS_GASTO,
} from "@/lib/catalogos";
import type { DireccionEnvio } from "@/lib/canales/direccion";
import type {
  BaseCalculoId,
  EsquemaPagoId,
  EstadoIngresoId,
  EstadoPagoNominaId,
  PeriodicidadPagoId,
  PlataformaAgenciaId,
  SituacionLaboralId,
  TipoIngresoId,
} from "@/lib/agencia";

export type { DireccionEnvio };
/* Los ids de los catálogos de la Agencia se re-exportan aquí para que el resto
   del código pida todos los tipos del dominio a un solo sitio, como ya pasa con
   los de tareas o inventario. */
export type {
  BaseCalculoId,
  EsquemaPagoId,
  EstadoIngresoId,
  EstadoPagoNominaId,
  PeriodicidadPagoId,
  PlataformaAgenciaId,
  SituacionLaboralId,
  TipoIngresoId,
};

/* Uniones de literales derivadas de los catálogos (p. ej. "por_hacer" | ...). */
export type EstadoId = (typeof ESTADOS)[number]["id"];
export type PrioridadId = (typeof PRIORIDADES)[number]["id"];
export type AreaId = (typeof AREAS)[number]["id"];
export type RolId = (typeof ROLES)[number]["id"];
export type EtiquetaId = (typeof ETIQUETAS)[number]["id"];
export type TipoProductoId = (typeof TIPOS_PRODUCTO)[number]["id"];
export type EstadoPedidoProvId = (typeof ESTADOS_PEDIDO_PROVEEDOR)[number]["id"];
export type CanalId = (typeof CANALES)[number]["id"];
export type CategoriaGastoId = (typeof CATEGORIAS_GASTO)[number]["id"];
export type EstadoPedidoId = (typeof ESTADOS_PEDIDO)[number]["id"];

/* Perfil de usuario (tabla `profiles`, 1:1 con auth.users). */
export type Profile = {
  id: string;
  nombre: string;
  rol: RolId;
  area: AreaId | null;
  color: string;
};
/* Tarea (tabla `tasks`). Los nombres de columna son snake_case en Postgres. */
export type Task = {
  id: string;
  titulo: string;
  descripcion: string | null;
  responsable_id: string | null;
  area: AreaId;
  prioridad: PrioridadId;
  estado: EstadoId;
  fecha_limite: string | null; // "AAAA-MM-DD"
  /* Fecha en que arrancó la tarea (por defecto el día en que se creó). */
  fecha_inicio: string | null; // "AAAA-MM-DD"
  /* Por qué está atorada (obligatorio al pasar a "atorado"): qué recurso se
     necesita de vuelta de quien la delegó. null cuando no está atorada. */
  motivo_atorado: string | null;
  etiquetas: string[];
  orden: number;
  /* Recordatorio opcional: momento (fecha+hora) en que avisar al responsable.
     Distinto de `fecha_limite` (solo fecha). El cron lo consume y marca enviado. */
  recordatorio_at: string | null;
  recordatorio_enviado: boolean;
  /* Papelera: si tiene fecha, la tarea está borrada (borrado suave). null = activa. */
  deleted_at: string | null;
  /* Última vez que la tarea se movió, INCLUIDOS comentarios e historial.
     `updated_at` no sirve para esto: un comentario no toca la fila de `tasks`. */
  ultima_actividad_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

/* Tarea con el perfil del responsable ya resuelto (para pintar la tarjeta).
   `leido_at` es la marca de lectura DE QUIEN MIRA (tabla task_reads): si es
   anterior a `ultima_actividad_at`, la tarea trae algo nuevo para esa persona.
   `coasignados` son las DEMÁS personas que trabajan la tarea (tabla
   task_assignees), sin incluir al responsable principal. */
export type TaskConResponsable = Task & {
  responsable: Pick<Profile, "id" | "nombre" | "color"> | null;
  coasignados: Pick<Profile, "id" | "nombre" | "color">[];
  leido_at?: string | null;
};

/* Todas las personas que trabajan una tarea: la principal primero y luego los
   coasignados. Es lo que se pinta en las tarjetas y lo que decide si la tarea
   es "mía". Devuelve lista vacía si no hay nadie asignado. */
export function equipoDeTarea(
  t: Pick<TaskConResponsable, "responsable" | "coasignados">,
): Pick<Profile, "id" | "nombre" | "color">[] {
  const equipo = t.responsable ? [t.responsable] : [];
  for (const c of t.coasignados ?? []) {
    if (c && c.id !== t.responsable?.id) equipo.push(c);
  }
  return equipo;
}

/* ¿Esta persona trabaja la tarea? (principal o coasignada). */
export function trabajaLaTarea(
  t: Pick<TaskConResponsable, "responsable_id" | "coasignados">,
  userId: string | null,
): boolean {
  if (!userId) return false;
  return t.responsable_id === userId || (t.coasignados ?? []).some((c) => c.id === userId);
}

/* ¿Esta tarea tiene novedades para mí? Sin marca de lectura, se considera vista:
   así las tareas viejas no aparecen todas con punto el primer día. */
export function tieneNovedades(t: Pick<TaskConResponsable, "ultima_actividad_at" | "leido_at">): boolean {
  if (!t.ultima_actividad_at || !t.leido_at) return false;
  return t.ultima_actividad_at > t.leido_at;
}

/* --- Tablas satélite del módulo Tareas --- */
export type TaskComment = {
  id: string;
  task_id: string;
  autor: string | null;
  texto: string;
  created_at: string;
};

export type TaskChecklistItem = {
  id: string;
  task_id: string;
  texto: string;
  hecho: boolean;
  orden: number;
  created_at: string;
};

export type TaskLink = {
  id: string;
  task_id: string;
  titulo: string | null;
  url: string;
  created_at: string;
};

export type TaskAttachment = {
  id: string;
  task_id: string;
  autor: string | null;
  nombre: string;
  storage_path: string;
  tipo: string | null;
  created_at: string;
};

export type TaskActivity = {
  id: string;
  task_id: string;
  autor: string | null;
  texto: string;
  created_at: string;
};

/* Notificación in-app (tabla `notifications`). Destinatario = user_id. */
export type Notificacion = {
  id: string;
  user_id: string;
  task_id: string | null;
  tipo: "asignacion" | "recordatorio" | "atorado" | "comentario";
  texto: string;
  leida: boolean;
  created_at: string;
};

/* Paquete con el detalle completo de una tarea (para el diálogo de detalle). */
export type TaskDetalle = {
  comentarios: TaskComment[];
  checklist: TaskChecklistItem[];
  enlaces: TaskLink[];
  adjuntos: TaskAttachment[];
  actividad: TaskActivity[];
};

/* --- Módulo Inventario (Fase 1) --- */

/* Proveedor (tabla `suppliers`). */
export type Supplier = {
  id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  /* País de origen (China / México / …) para separar la lista. */
  pais: string | null;
  /* Contacto directo: persona, WeChat, WhatsApp… */
  contacto: string | null;
  /* Días que tarda en llegar un pedido de este proveedor (incluye producción,
     tránsito y aduana). null = usar el default global del reabastecimiento. */
  dias_entrega: number | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

/* Producto (tabla `products`). Los campos tiendanube_* mapean el renglón a
   una variante de Tienda Nube (null = producto capturado a mano). */
export type Product = {
  id: string;
  nombre: string;
  tipo: TipoProductoId;
  variante: string | null;
  costo: number | null;
  precio: number | null;
  stock: number;
  stock_minimo: number;
  proveedor_id: string | null;
  activo: boolean;
  /* Se fabrica cuando alguien lo compra (personalizados): no lleva inventario,
     así que queda fuera del semáforo de stock y de «Qué pedir». */
  bajo_pedido: boolean;
  /* Línea que ya no se repone (p. ej. muñequeras OG). Conserva su histórico y su
     stock, pero queda fuera de «Qué pedir» y de los avisos de stock. */
  descontinuado: boolean;
  notas: string | null;
  imagen_url: string | null; // portada (miniatura); URL del CDN de Tienda Nube
  imagenes: string[]; // galería completa, ordenada
  sku: string | null;
  tiendanube_product_id: number | null;
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
  meli_variation_id: number | null;
  /* Modalidad de envío de la publicación de ML: "fulfillment" (Mercado Full,
     el stock vive en un centro de ML), "cross_docking", "drop_off"… */
  meli_logistic_type: string | null;
  /* Unidades en el centro de Mercado Full. Va APARTE de `stock` porque son dos
     almacenes distintos: `stock` es la bodega (la que gobierna Tienda Nube
     cuando el producto también vive allá) y esto es lo que Mercado Libre tiene
     guardado. null = la ficha no tiene publicación Full. */
  meli_stock_full: number | null;
  /* Mapeo a TikTok Shop. Un renglón con tiktok_product_id pero sin vínculo a
     Tienda Nube/Mercado Libre es inventario DELEGADO (p. ej. lo que un revendedor
     tiene aparte): se muestra en su propia columna y NO se suma a la bodega. */
  tiktok_product_id: string | null;
  tiktok_sku_id: string | null;
  /* Unidades que TikTok reporta para esa publicación. Va APARTE de `stock` en
     una ficha multicanal (`stock` ahí es la bodega); null = sin dato propio
     todavía, o sin publicación de TikTok. */
  tiktok_stock: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

/* Foto subida a mano desde el CRM (tabla `product_photos`, bucket público
   `fotos-productos`). Vive aparte de `Product.imagenes` porque esa columna la
   reescribe completa cada sincronización de Tienda Nube / Mercado Libre. */
export type ProductPhoto = {
  id: string;
  producto_id: string;
  nombre: string;
  storage_path: string;
  tipo: string | null;
  orden: number;
  created_at: string;
};

/* Producto tal como llega a la lista de inventario: TODO menos `imagenes`, la
   galería importada de los canales. Pesa ~950 KB sobre el catálogo entero y
   solo hace falta al abrir el diálogo de un producto, que la pide entonces
   (galeriaDeProducto en el módulo de acciones). */
export type ProductConProveedor = Omit<Product, "imagenes"> & {
  /* `dias_entrega` viaja aquí porque es la entrada del punto de reorden
     (lib/inventario/reabastecimiento.ts). */
  proveedor: Pick<Supplier, "id" | "nombre" | "dias_entrega"> | null;
  fotos_propias: ProductPhoto[];
};

/* Movimiento de stock (tabla `stock_log`): ledger append-only de cada escritura
   de inventario. `producto` se resuelve con un join (puede faltar si se borró). */
export type StockLog = {
  id: number;
  producto_id: string | null;
  canal: "crm" | "tienda_nube" | "mercado_libre" | "tiktok_shop";
  origen: string; // manual | tiendanube_sync | mercadolibre_sync | venta_ml | proveedor | ...
  stock_anterior: number | null; // null = empuje saliente (no se conoce el previo)
  stock_nuevo: number;
  creado_en: string;
  lote: string | null; // id de la operación que escribió este renglón junto a otros
  producto: Pick<Product, "nombre" | "variante"> | null;
};

/* Renglón de un pedido a proveedor (tabla `supplier_order_items`). */
export type SupplierOrderItem = {
  id: string;
  pedido_id: string;
  producto_id: string | null;
  descripcion: string | null;
  cantidad: number;
  costo_unitario: number | null;
};

/* Pedido a proveedor (tabla `supplier_orders`). */
export type SupplierOrder = {
  id: string;
  proveedor_id: string;
  fecha_pedido: string; // "AAAA-MM-DD"
  fecha_estimada: string | null;
  estado: EstadoPedidoProvId;
  costo_total: number | null;
  /* Rastreo del envío (una guía principal). */
  paqueteria: string | null;
  num_guia: string | null;
  url_rastreo: string | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type SupplierOrderConDetalle = SupplierOrder & {
  proveedor: Pick<Supplier, "id" | "nombre"> | null;
  items: (SupplierOrderItem & { producto: Pick<Product, "id" | "nombre" | "variante"> | null })[];
};

/* Pago de un pedido a proveedor (tabla `supplier_order_payments`). El
   comprobante (opcional) vive en el bucket privado `pedidos-proveedor`. */
export type SupplierOrderPayment = {
  id: string;
  pedido_id: string;
  fecha: string; // "AAAA-MM-DD"
  monto: number;
  nota: string | null;
  comprobante_path: string | null;
  comprobante_nombre: string | null;
  comprobante_tipo: string | null;
  created_by: string | null;
  created_at: string;
};

/* Incidencia de un pedido a proveedor (tabla `supplier_order_incidents`). */
export type SupplierOrderIncident = {
  id: string;
  pedido_id: string;
  fecha: string; // "AAAA-MM-DD"
  texto: string;
  resuelto: boolean;
  created_by: string | null;
  created_at: string;
};

/* Pagos + incidencias de un pedido (para el diálogo de pedido). */
export type PedidoProvDetalle = {
  pagos: SupplierOrderPayment[];
  incidencias: SupplierOrderIncident[];
};

/* Conteo físico de inventario (tabla `conteos_fisicos`): quién contó qué y quién
   lo corroboró. */
export type ConteoFisico = {
  id: string;
  producto_id: string | null;
  descripcion: string | null;
  cantidad: number;
  contado_por: string | null;
  corroborado_por: string | null;
  nota: string | null;
  fecha: string; // "AAAA-MM-DD"
  created_by: string | null;
  created_at: string;
};

export type ConteoConProducto = ConteoFisico & {
  producto: Pick<Product, "id" | "nombre" | "variante" | "sku" | "stock"> | null;
};

/* --- Módulo Métricas / Ventas (Fase 2) --- */

/* Venta (tabla `sales`): un renglón = un producto vendido. En la Fase 5 estas
   MISMAS filas ganan columnas de envío y se vuelven los "pedidos". */
export type Sale = {
  id: string;
  fecha: string; // "AAAA-MM-DD"
  canal: CanalId;
  producto_id: string | null;
  descripcion: string | null;
  cantidad: number;
  monto: number; // total del renglón
  cliente_id: string | null;
  origen: "manual" | "csv" | "api";
  referencia_externa: string | null;
  notas: string | null;
  /* Envío (Fase 5). null = venta directa sin flujo de envío. */
  estado: EstadoPedidoId | null;
  paqueteria: string | null;
  num_guia: string | null;
  /* Enlace de rastreo que dio el canal. null = derivarlo de la paquetería
     (ver lib/pedidos/rastreo.ts). */
  url_rastreo: string | null;
  /* Enlace al pedido en el panel del canal. Se guarda porque Mercado Libre abre
     el detalle por el id del carrito, que solo conoce su API. */
  url_orden: string | null;
  /* Dirección de entrega tal como la mandó el canal. Es del PEDIDO y no del
     cliente: si el cliente se muda, este envío siguió yendo a donde fue. */
  envio_direccion: DireccionEnvio | null;
  /* Hasta cuándo hay para entregarle el paquete al transportista, y cuándo salió
     de verdad. Hoy solo los reporta Mercado Libre, y son los dos lados de la
     métrica de demora que decide su exposición (lib/mercadolibre/desempeno.ts). */
  envio_limite_despacho: string | null;
  envio_despachado_en: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type SaleConProducto = Sale & {
  producto: Pick<Product, "id" | "nombre" | "variante" | "tipo"> | null;
};

/* Totales de una ORDEN del canal (tabla `sale_orders`).
   `sales` guarda un renglón por producto y su `monto` es solo precio×cantidad;
   los paneles de Tienda Nube / Mercado Libre / TikTok reportan el total de la
   orden, que además lleva envío, descuentos e impuestos. Por eso los totales
   viven aparte: meterlos en `sales` los duplicaría en cada renglón. */
export type SaleOrder = {
  id: string;
  canal: CanalId;
  referencia_orden: string;
  numero: string | null;
  fecha: string; // "AAAA-MM-DD" en hora de México
  total: number; // bruto, comparable con el panel del canal
  subtotal: number; // solo producto
  envio: number;
  descuento: number;
  impuesto: number;
  moneda: string;
  estado: string | null;
  cliente_id: string | null;
  /* Lo que se quedó el canal por vender, en positivo. Mercado Libre lo manda
     dentro de la orden; los demás canales todavía no, y ahí llega null. */
  comision: number | null;
  /* Lo que costó el flete al VENDEDOR. Ojo: `envio` de arriba es lo que pagó el
     COMPRADOR, y en Mercado Libre casi siempre es 0 aunque el envío sí nos
     cueste. Sumar comisión + esto es el costo real de vender por el canal. */
  costo_envio: number | null;
  /* Cómo se pagó y con qué cupón. Vienen dentro de la orden del canal (hoy solo
     Tienda Nube los manda) y son de la ORDEN, no del renglón: guardarlos en
     `sales` los repetiría por línea e inflaría cualquier conteo. */
  metodo_pago: string | null;
  cupon: string | null;
  meses: number | null;
  created_at: string;
  updated_at: string | null;
};

/* Lo que Métricas necesita de una orden: agregar por fecha y canal. */
export type OrdenMetricas = Pick<
  SaleOrder,
  "canal" | "fecha" | "total" | "subtotal" | "envio" | "descuento"
> & {
  /* Cómo pagó y con qué cupón. Solo Tienda Nube los manda hoy; en el resto de
     canales llegan nulos y el panel simplemente no los cuenta. */
  metodo_pago?: string | null;
  cupon?: string | null;
  meses?: number | null;
};

/* Pedido = venta con su cliente resuelto (para la vista de Pedidos y envíos). */
export type SaleConDetalle = SaleConProducto & {
  cliente: Pick<Customer, "id" | "nombre"> | null;
};

/* Venta tal como la consume el módulo de PEDIDOS: solo lo que pinta la tabla y
   el diálogo de envío. Traer la fila completa costaba 819 KB frente a 474 KB;
   esos bytes cruzan hasta el navegador, así que el tipo acota el select. */
export type PedidoEnvio = Pick<
  Sale,
  | "id"
  | "fecha"
  | "canal"
  | "cantidad"
  | "estado"
  | "num_guia"
  | "paqueteria"
  | "url_rastreo"
  | "url_orden"
  | "descripcion"
  /* Nº de orden en la plataforma: es por el que pregunta el cliente y por el que
     se busca el pedido; sin él había que ir al panel del canal a cruzarlo. */
  | "referencia_externa"
  | "envio_direccion"
> & {
  producto: Pick<Product, "id" | "nombre" | "variante"> | null;
  cliente: Pick<Customer, "id" | "nombre"> | null;
};

/* Venta tal como la consume el tablero de DESPACHO de Mercado Libre: lo justo
   para ordenar por plazo y saber a quién le urge. Es el mismo criterio de acotar
   el select que en Pedidos y Métricas. */
export type VentaDespacho = Pick<
  Sale,
  | "id"
  | "fecha"
  | "cantidad"
  | "descripcion"
  | "estado"
  | "num_guia"
  | "url_orden"
  | "referencia_externa"
  | "envio_limite_despacho"
  | "envio_despachado_en"
>;

/* Venta tal como la consume MÉTRICAS: sin los campos de envío ni las marcas de
   auditoría, que ese módulo no muestra (742 KB → 570 KB). */
export type VentaMetricas = Pick<
  Sale,
  | "id"
  | "fecha"
  | "canal"
  | "cantidad"
  | "monto"
  | "descripcion"
  | "notas"
  | "origen"
  | "producto_id"
  | "cliente_id"
  | "referencia_externa"
> & {
  producto: Pick<Product, "id" | "nombre" | "variante" | "tipo"> | null;
};

/* --- Módulo Clientes (Fase 4) --- */

/* Cliente (tabla `customers`). Los de Tienda Nube se crean y actualizan solos
   al importar las órdenes (tiendanube_customer_id != null). */
export type Customer = {
  id: string;
  nombre: string;
  telefono: string | null;
  correo: string | null;
  canal: CanalId | null; // canal de origen
  notas: string | null;
  /* De dónde es. Solo llega de Tienda Nube: Mercado Libre anonimiza al comprador
     y TikTok entrega un correo enmascarado, así que en esos canales queda null. */
  ciudad: string | null;
  estado: string | null;
  cp: string | null;
  tiendanube_customer_id: number | null;
  /* Identidades por canal. Faltaban en el tipo aunque llevan tiempo en la BD. */
  mercadolibre_buyer_id: number | null;
  tiktok_buyer_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

/* Cliente con sus números derivados de `sales` (no se guardan en la BD). */
export type CustomerConStats = Customer & {
  compras: number; // nº de ventas
  total: number; // total gastado
  ultimaCompra: string | null; // "AAAA-MM-DD"
  recurrente: boolean; // 2 o más compras
};

/* --- Módulo Finanzas (Fase 3, solo dirección) --- */

/* Gasto (tabla `expenses`). Los ingresos NO se capturan: salen de `sales`. */
export type Expense = {
  id: string;
  fecha: string; // "AAAA-MM-DD"
  concepto: string;
  monto: number;
  categoria: CategoriaGastoId;
  proveedor: string | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

/* Comprobante/factura de un gasto (binario en el bucket privado `facturas`). */
export type ExpenseReceipt = {
  id: string;
  expense_id: string;
  nombre: string;
  storage_path: string;
  tipo: string | null;
  created_at: string;
};

export type ExpenseConComprobantes = Expense & {
  comprobantes: ExpenseReceipt[];
};

/* ============================ Agencia Fresafit ============================= */
/* Fase B: el otro negocio. Fresafit vende cinturones; la Agencia le lleva la
   operación a otras marcas y les cobra un fijo más un porcentaje de lo que esas
   marcas venden. Nada de esto toca inventario, ventas ni pedidos, que siguen
   siendo de Fresafit. Ver lib/agencia.ts para el cálculo y los catálogos. */

export type AgenciaEmpresa = {
  id: string;
  nombre: string;
  slug: string;
  color: string;
  giro: string | null;
  contacto_nombre: string | null;
  contacto_correo: string | null;
  contacto_telefono: string | null;
  activa: boolean;
  inicio: string | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

/* Quién del equipo atiende a cada empresa. Sin esto, el costo del equipo es un
   bloque que no se puede repartir entre contratos. */
export type AgenciaAsignacion = {
  id: string;
  empresa_id: string;
  profile_id: string;
  papel: string | null;
  activo: boolean;
  created_at: string;
};

export type AgenciaAsignacionConPersona = AgenciaAsignacion & {
  persona: Pick<Profile, "id" | "nombre" | "color"> | null;
};

/* La regla de cobro. `fondo_delegado` es dinero del cliente que solo pasa por la
   agencia (pagar al personal de sus lives): no es ingreso, por eso va aparte. */
export type AgenciaContrato = {
  id: string;
  empresa_id: string;
  nombre: string;
  monto_fijo: number;
  porcentaje: number;
  base_calculo: BaseCalculoId;
  plataforma: PlataformaAgenciaId;
  dia_corte: number;
  periodicidad: "mensual" | "quincenal";
  fondo_delegado: number;
  moneda: string;
  inicio: string | null;
  fin: string | null;
  activo: boolean;
  notas: string | null;
  created_at: string;
  updated_at: string | null;
};

/* Todo lo que la agencia cobra: cortes de contrato, migraciones de plataforma y
   comisiones por referidos. El desglose se guarda congelado aunque sea
   calculable, porque un cobro viejo debe seguir explicándose con las reglas que
   estaban vigentes cuando se emitió. */
export type AgenciaIngreso = {
  id: string;
  empresa_id: string | null;
  contrato_id: string | null;
  tipo: TipoIngresoId;
  concepto: string;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  ventas_base: number;
  ventas_origen: "manual" | "api";
  ventas_nota: string | null;
  monto_fijo: number;
  porcentaje: number;
  monto_variable: number;
  fondo_delegado: number;
  total: number;
  socio: string | null;
  estado: EstadoIngresoId;
  cobrado_at: string | null;
  pagado_at: string | null;
  factura: string | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type AgenciaIngresoConEmpresa = AgenciaIngreso & {
  empresa: Pick<AgenciaEmpresa, "id" | "nombre" | "color"> | null;
};

export type AgenciaReporte = {
  id: string;
  empresa_id: string;
  titulo: string;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  resumen: string | null;
  url: string | null;
  entregado_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type AgenciaReporteConEmpresa = AgenciaReporte & {
  empresa: Pick<AgenciaEmpresa, "id" | "nombre" | "color"> | null;
};

/* Nómina: TODO el equipo, no solo la agencia. `profile_id` liga a la cuenta del
   CRM cuando la persona tiene una (el personal de los lives no la tiene).
   `empresa_id` null = se carga a Fresafit. */
export type NominaEmpleado = {
  id: string;
  profile_id: string | null;
  nombre: string;
  puesto: string | null;
  empresa_id: string | null;
  esquema: EsquemaPagoId;
  monto: number;
  periodicidad: PeriodicidadPagoId;
  dia_corte: number | null;
  situacion: SituacionLaboralId;
  activo: boolean;
  inicio: string | null;
  fin: string | null;
  notas: string | null;
  created_at: string;
  updated_at: string | null;
};

export type NominaEmpleadoConEmpresa = NominaEmpleado & {
  empresa: Pick<AgenciaEmpresa, "id" | "nombre" | "color"> | null;
};

export type NominaPago = {
  id: string;
  empleado_id: string;
  periodo_desde: string | null;
  periodo_hasta: string | null;
  monto: number;
  estado: EstadoPagoNominaId;
  fecha_pago: string | null;
  metodo: string | null;
  comprobante: string | null;
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type NominaPagoConEmpleado = NominaPago & {
  empleado: Pick<NominaEmpleado, "id" | "nombre" | "puesto"> | null;
};
