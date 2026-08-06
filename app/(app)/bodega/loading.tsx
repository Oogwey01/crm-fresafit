import { EsqueletoModulo } from "@/components/compartido/esqueleto";

/* Next envuelve la página en un <Suspense> con esto: al navegar, el armazón
   aparece de inmediato en vez de dejar la pantalla anterior congelada. */
export default function Cargando() {
  return <EsqueletoModulo tarjetas={4} filas={10} acciones={2} />;
}
