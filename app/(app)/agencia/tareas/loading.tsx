import { EsqueletoModulo } from "@/components/compartido/esqueleto";

/* Mismo armazón que /tareas: el tablero es el mismo componente. */
export default function Cargando() {
  return <EsqueletoModulo tarjetas={0} filas={10} acciones={2} />;
}
