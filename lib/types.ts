/* ============================================================================
   lib/types.ts  —  Tipos del dominio (Fresafit CRM)
   ============================================================================ */

import type { ESTADOS, PRIORIDADES, AREAS, ROLES } from "@/lib/catalogos";

/* Uniones de literales derivadas de los catálogos (p. ej. "por_hacer" | ...). */
export type EstadoId = (typeof ESTADOS)[number]["id"];
export type PrioridadId = (typeof PRIORIDADES)[number]["id"];
export type AreaId = (typeof AREAS)[number]["id"];
export type RolId = (typeof ROLES)[number]["id"];

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
  orden: number;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
};

/* Tarea con el perfil del responsable ya resuelto (para pintar la tarjeta). */
export type TaskConResponsable = Task & {
  responsable: Pick<Profile, "id" | "nombre" | "color"> | null;
};
