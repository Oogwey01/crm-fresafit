/* ============================================================================
   lib/types.ts  —  Tipos del dominio (Fresafit CRM)
   ============================================================================ */

import type { ESTADOS, PRIORIDADES, AREAS, ROLES, ETIQUETAS } from "@/lib/catalogos";

/* Uniones de literales derivadas de los catálogos (p. ej. "por_hacer" | ...). */
export type EstadoId = (typeof ESTADOS)[number]["id"];
export type PrioridadId = (typeof PRIORIDADES)[number]["id"];
export type AreaId = (typeof AREAS)[number]["id"];
export type RolId = (typeof ROLES)[number]["id"];
export type EtiquetaId = (typeof ETIQUETAS)[number]["id"];

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
