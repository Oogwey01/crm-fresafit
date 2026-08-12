/* Lo que comparten las familias de acciones de Finanzas. Sin "use server": un
   módulo de acciones solo puede exportar funciones async, y aquí hay constantes
   (mismo motivo que app/(app)/maquila/acciones/comun.ts). */

import { revalidatePath } from "next/cache";

export function revalidar() {
  revalidatePath("/finanzas");
}

/* Los gastos del negocio son administrativos: dirección y administración. La
   BD lo refuerza con RLS (policies es_administrativo) —esto es defensa en
   profundidad. */
export const NO_AUTORIZADO = "Solo dirección o administración puede ver y mover las finanzas.";

/* Lo personal no es un escalón más de permiso: la sección es de una sola
   persona. El mensaje lo dice así para que nadie crea que le falta un permiso
   que pedir. */
export const NO_ES_TUYO = "Esa sección no es tuya: son las cuentas personales de otra persona.";
