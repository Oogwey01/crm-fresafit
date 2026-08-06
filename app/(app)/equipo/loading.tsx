import { EsqueletoModulo } from "@/components/compartido/esqueleto";

/* Next envuelve la página en un <Suspense> con esto: al navegar, el armazón
   aparece de inmediato en vez de dejar la pantalla anterior congelada. Era la
   única página del menú sin él, y la Admin API (los correos) es lenta. */
export default function Cargando() {
  return <EsqueletoModulo tarjetas={0} filas={8} acciones={1} />;
}
