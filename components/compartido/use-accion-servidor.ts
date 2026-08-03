"use client";

import { useTransition } from "react";
import { toast } from "sonner";

/* Ejecuta un server action desde un diálogo/panel con el ritual completo que
   cada componente tenía copiado: startTransition + try/catch + toast de error
   o de éxito + callback al terminar (cerrar el diálogo, recargar el detalle).
   Generaliza el `accion(fn, okMsg)` local de pedido-prov-dialog/task-detail.

   Los server actions devuelven `{ error: string }` en fallo controlado; el
   catch cubre el fallo de red/transporte con el mensaje `error` del caller
   (los diálogos usan literales propios: "No se pudo guardar…", etc.). */
export function useAccionServidor() {
  const [pending, startTransition] = useTransition();

  function ejecutar<R extends object>(
    fn: () => Promise<R | { error: string }>,
    opts: {
      /** Toast de éxito (si se omite, no hay toast). */
      ok?: string;
      /** Toast si la promesa revienta (red caída). */
      error?: string;
      /** window.confirm previo; si se cancela, no se ejecuta nada. */
      confirmar?: string;
      /** Al éxito, con el resultado (cerrar diálogo, recargar, leer datos). */
      alExito?: (r: R) => void | Promise<void>;
    } = {},
  ) {
    if (opts.confirmar && !window.confirm(opts.confirmar)) return;
    startTransition(async () => {
      try {
        const r = await fn();
        if ("error" in r && typeof r.error === "string") {
          toast.error(r.error);
          return;
        }
        if (opts.ok) toast.success(opts.ok);
        await opts.alExito?.(r as R);
      } catch {
        toast.error(opts.error ?? "Algo falló. Revisa tu conexión.");
      }
    });
  }

  return { pending, ejecutar };
}
