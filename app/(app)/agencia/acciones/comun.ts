/* Lo que comparten las acciones de la Agencia y las de nómina y reportes, que
   viven en sus propias rutas porque existen en los DOS espacios. Sin "use
   server": un módulo de acciones solo puede exportar funciones async, y aquí
   hay constantes.

   Salió del actions.ts único de 596 líneas, que servía a tres módulos de UI
   distintos (agencia, nómina y reportes) desde una sola ruta. */

import { revalidatePath } from "next/cache";
import { invalidar, TAGS } from "@/lib/supabase/cache";

/* Nómina y reportes existen en los DOS espacios (Fresafit y Agencia) sobre las
   mismas tablas, así que al guardar hay que refrescar ambos: mover a alguien de
   empresa lo saca de una lista y lo mete en la otra. */
const RUTAS = [
  "/agencia/empresas",
  "/agencia/cobros",
  "/agencia/nomina",
  "/agencia/reportes",
  /* El tablero pinta el nombre y el color de cada cliente en las tarjetas:
     renombrar una empresa tiene que verse también ahí. */
  "/agencia/tareas",
  "/nomina",
  "/reportes",
];

export const revalidar = () => {
  RUTAS.forEach((r) => revalidatePath(r));
  /* Las cuentas activas están cacheadas entre requests (lib/supabase/cache). */
  invalidar(TAGS.agencia);
};

export const SOLO_ADMINISTRACION =
  "Solo dirección o administración puede ver y mover la información de la Agencia.";
