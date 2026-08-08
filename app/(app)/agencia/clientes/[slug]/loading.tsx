import { EsqueletoModulo } from "@/components/compartido/esqueleto";

/* El espacio de un cliente: cabecera + pestañas + lista. */
export default function Cargando() {
  return <EsqueletoModulo tarjetas={0} filas={8} acciones={1} />;
}
