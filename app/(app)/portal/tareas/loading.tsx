import { EsqueletoModulo } from "@/components/compartido/esqueleto";

/* Las dos bandejas del portal: lista de renglones, sin tarjetas de métricas. */
export default function Cargando() {
  return <EsqueletoModulo tarjetas={0} filas={8} acciones={1} />;
}
