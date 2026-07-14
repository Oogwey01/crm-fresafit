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
  CANALES,
} from "@/lib/catalogos";

/* Uniones de literales derivadas de los catálogos (p. ej. "por_hacer" | ...). */
export type EstadoId = (typeof ESTADOS)[number]["id"];
export type PrioridadId = (typeof PRIORIDADES)[number]["id"];
export type AreaId = (typeof AREAS)[number]["id"];
export type RolId = (typeof ROLES)[number]["id"];
export type EtiquetaId = (typeof ETIQUETAS)[number]["id"];
export type TipoProductoId = (typeof TIPOS_PRODUCTO)[number]["id"];
export type EstadoPedidoProvId = (typeof ESTADOS_PEDIDO_PROVEEDOR)[number]["id"];
export type CanalId = (typeof CANALES)[number]["id"];

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
  etiquetas: string[];
  orden: number;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

/* Tarea con el perfil del responsable ya resuelto (para pintar la tarjeta). */
export type TaskConResponsable = Task & {
  responsable: Pick<Profile, "id" | "nombre" | "color"> | null;
};

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
  notas: string | null;
  sku: string | null;
  tiendanube_product_id: number | null;
  tiendanube_variant_id: number | null;
  meli_item_id: string | null;
  meli_variation_id: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type ProductConProveedor = Product & {
  proveedor: Pick<Supplier, "id" | "nombre"> | null;
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
  notas: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type SupplierOrderConDetalle = SupplierOrder & {
  proveedor: Pick<Supplier, "id" | "nombre"> | null;
  items: (SupplierOrderItem & { producto: Pick<Product, "id" | "nombre" | "variante"> | null })[];
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
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

export type SaleConProducto = Sale & {
  producto: Pick<Product, "id" | "nombre" | "variante"> | null;
};
