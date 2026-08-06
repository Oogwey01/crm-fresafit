import { EsqueletoModulo } from "@/components/compartido/esqueleto";

/* Next envuelve la página en un <Suspense> con esto: al navegar, el armazón
   aparece de inmediato en vez de dejar la pantalla anterior congelada mientras
   se resuelven las consultas. Canales es de las que más lo necesitan: sus
   páginas esperan a APIs ajenas (las visitas de ML tardan segundos). */
export default function Cargando() {
  return <EsqueletoModulo tarjetas={3} filas={8} acciones={1} />;
}
