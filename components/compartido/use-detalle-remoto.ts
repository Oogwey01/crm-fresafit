"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Carga un detalle asíncrono (server action) al abrir un diálogo/vista, con
   protección contra respuestas tardías de un detalle ya cerrado y un
   `recargar()` para refrescar tras una mutación. Unifica el patrón
   useEffect + flag `vivo` que estaba copiado en pedido-prov-dialog,
   task-detail y producto-vista.

   `clave` identifica QUÉ se está cargando (p. ej. el id de la entidad).
   `cargando` se deriva comparando la marca pedida con la respondida — sin
   setState síncrono dentro del efecto. `cargar` se lee fresca vía ref para no
   obligar al caller a memoizarla. */
export function useDetalleRemoto<T>(cargar: () => Promise<T>, clave: string) {
  const [tick, setTick] = useState(0);
  const marca = `${clave}#${tick}`;
  const [resultado, setResultado] = useState<{ marca: string; datos: T | null } | null>(null);

  const cargarRef = useRef(cargar);
  useEffect(() => {
    cargarRef.current = cargar;
  });

  useEffect(() => {
    let vivo = true;
    cargarRef
      .current()
      .then((d) => {
        if (vivo) setResultado({ marca, datos: d });
      })
      .catch(() => {
        if (vivo) setResultado({ marca, datos: null });
      });
    return () => {
      vivo = false;
    };
  }, [marca]);

  const recargar = useCallback(() => setTick((t) => t + 1), []);
  const alDia = resultado?.marca === marca;
  return {
    datos: alDia ? resultado.datos : null,
    cargando: !alDia,
    recargar,
  };
}
