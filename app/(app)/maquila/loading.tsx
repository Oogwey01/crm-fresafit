import { EsqueletoModulo } from "@/components/compartido/esqueleto";

/* El hueco de Maquila mientras llegan los pedidos. */
export default function Loading() {
  return <EsqueletoModulo tarjetas={4} filas={8} acciones={1} />;
}
