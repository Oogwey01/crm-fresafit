import { EsqueletoModulo } from "@/components/compartido/esqueleto";

/* La página pide los carritos abandonados a Tienda Nube en vivo, que puede
   tardar: sin esto la pantalla anterior se queda congelada mientras contesta. */
export default function Cargando() {
  return <EsqueletoModulo tarjetas={4} filas={6} />;
}
