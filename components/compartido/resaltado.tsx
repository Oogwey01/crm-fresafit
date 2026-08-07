"use client";

/* Marca en un texto los trozos que coinciden con lo que se está buscando.

   En una lista de mil renglones, con el buscador escrito, la pregunta que uno
   se hace en cada fila es «¿y ésta por qué salió?»: el nombre no lo dice cuando
   la coincidencia iba por el SKU o por media palabra en medio del título. Esto
   lo señala.

   Compara en minúsculas y por posición —no por regex— para no tener que escapar
   lo que la persona escribió: un SKU con guiones o un «(2)» reventarían un
   patrón armado a mano, y aquí llegan tal cual. */

export function Resaltado({ texto, busca }: { texto: string; busca: string }) {
  const q = busca.trim().toLowerCase();
  if (!q || !texto) return <>{texto}</>;

  const bajo = texto.toLowerCase();
  const trozos: React.ReactNode[] = [];
  let desde = 0;

  /* Todas las apariciones, no solo la primera: buscar «negro» en «Cinturón
     Negro — negro liso» tiene que iluminar las dos. */
  for (let i = bajo.indexOf(q); i !== -1; i = bajo.indexOf(q, desde)) {
    if (i > desde) trozos.push(texto.slice(desde, i));
    trozos.push(
      <mark
        key={i}
        /* `text-inherit` a propósito: el <mark> del navegador pinta el texto de
           negro, y esto se usa también sobre el SKU en gris y dentro de filas
           atenuadas. El fondo es el rosa de la marca al 20%, que se lee igual
           en claro y en oscuro. */
        className="rounded-[3px] bg-primary/20 px-0.5 text-inherit"
      >
        {texto.slice(i, i + q.length)}
      </mark>,
    );
    desde = i + q.length;
  }

  if (desde < texto.length) trozos.push(texto.slice(desde));
  return <>{trozos}</>;
}
