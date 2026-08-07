import { obtenerEstado } from "@/lib/catalogos";
import type { EstadoId } from "@/lib/types";

/* El mismo aviso desde las tres superficies que mueven una tarea —tablero,
   tabla y detalle— para que no acaben diciendo tres cosas distintas de lo
   mismo. Sin el título de la tarea: en la tabla ya se ve cuál se movió y en el
   detalle el sujeto es la pantalla. */
export function avisoEstadoTarea(estado: EstadoId): string {
  return `Movida a «${obtenerEstado(estado)?.nombre ?? estado}».`;
}
