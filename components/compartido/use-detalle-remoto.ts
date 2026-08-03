"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* Carga un detalle asíncrono (server action) al abrir un diálogo/vista, con
   protección contra respuestas tardías de un detalle ya cerrado y un
   `recargar()` para refrescar tras una mutación. Unifica el patrón
   useEffect + flag `vivo` que estaba copiado en pedido-prov-dialog,
   task-detail y producto-vista.

   `clave` identifica QUÉ se está cargando (p. ej. el id de la entidad): al
   cambiar, `datos` vuelve a null (es otra entidad). Un `recargar()` en cambio
   CONSERVA los datos visibles mientras llega la respuesta, para que la vista
   no parpadee en vacío tras cada mutación.

   `cargando` se deriva comparando lo pedido con lo respondido — sin setState
   síncrono dentro del efecto. `cargar` se lee fresca vía ref para no obligar
   al caller a memoizarla. */
export function useDetalleRemoto<T>(cargar: () => Promise<T>, clave: string) {
  const [tick, setTick] = useState(0);
  const [resultado, setResultado] = useState<{
    clave: string;
    tick: number;
    datos: T | null;
    error?: string;
  } | null>(null);

  const cargarRef = useRef(cargar);
  useEffect(() => {
    cargarRef.current = cargar;
  });

  useEffect(() => {
    let vivo = true;
    cargarRef
      .current()
      .then((d) => {
        if (vivo) setResultado({ clave, tick, datos: d });
      })
      .catch((e: unknown) => {
        if (!vivo) return;
        const error = e instanceof Error ? e.message : "No se pudo cargar el detalle.";
        setResultado({ clave, tick, datos: null, error });
      });
    return () => {
      vivo = false;
    };
  }, [clave, tick]);

  const recargar = useCallback(() => setTick((t) => t + 1), []);
  const mismaEntidad = resultado?.clave === clave;
  return {
    /* Se conserva entre recargas de la misma entidad; null al cambiar de una. */
    datos: mismaEntidad ? resultado.datos : null,
    cargando: !(mismaEntidad && resultado.tick === tick),
    /* Motivo del fallo, para distinguir "no hay nada" de "no se pudo leer". */
    error: mismaEntidad ? resultado.error : undefined,
    recargar,
  };
}
