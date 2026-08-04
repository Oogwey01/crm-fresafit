import { EsqueletoModulo } from "@/components/compartido/esqueleto";

/* La página llama en vivo a Mercado Libre, que a veces tarda: sin esto la
   pantalla anterior se queda congelada mientras contesta. */
export default function Cargando() {
  return <EsqueletoModulo tarjetas={4} filas={8} />;
}
