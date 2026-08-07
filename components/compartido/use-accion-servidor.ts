"use client";

import { useTransition } from "react";
import { toast } from "sonner";

/* Ejecuta un server action desde un diálogo/panel con el ritual completo que
   cada componente tenía copiado: startTransition + parche optimista + try/catch
   + toast de error, de advertencia o de éxito + callback al terminar (cerrar el
   diálogo, recargar el detalle).
   Generaliza el `accion(fn, okMsg)` local de pedido-prov-dialog/task-detail.

   Los server actions devuelven `{ error: string }` en fallo controlado; el
   catch cubre el fallo de red/transporte con el mensaje `error` del caller
   (los diálogos usan literales propios: "No se pudo guardar…", etc.).

   `advertencia` es el caso ok-a-medias del contrato de lib/acciones.ts: lo
   principal se guardó pero algo secundario falló. Se pinta ámbar y PISA al
   toast de éxito — decir "Guardado." y encima "no se avisó al canal" sería
   mandar dos mensajes que se contradicen. */
export function useAccionServidor() {
  const [pending, startTransition] = useTransition();

  function ejecutar<R extends object>(
    fn: () => Promise<R | { error: string }>,
    opts: {
      /* Toast de éxito (si se omite, no hay toast). Como función recibe el
         resultado, para los mensajes que llevan datos: "3 tareas creadas.". */
      ok?: string | ((r: R) => string);
      /** Toast si la promesa revienta (red caída). */
      error?: string;
      /** window.confirm previo; si se cancela, no se ejecuta nada. */
      confirmar?: string;
      /* Parche optimista. Corre DENTRO de la transición, justo antes de llamar
         al servidor: es lo que exige `useOptimistic` —su setter solo pinta
         mientras hay una transición viva— y lo que el tablero de tareas hacía a
         mano. Si el action falla, React revierte solo al revalidar. */
      optimista?: () => void;
      /** Al éxito, con el resultado (cerrar diálogo, recargar, leer datos). */
      alExito?: (r: R) => void | Promise<void>;
      /* Limpieza que corre pase lo que pase, como el `finally` que cada panel
         tenía a mano: apagar el spinner propio, soltar el guardia de
         reentrada. Sin esto, un fallo dejaba el botón girando para siempre.
         No corre si `confirmar` se canceló: ahí no llegó a empezar nada. */
      siempre?: () => void;
    } = {},
  ) {
    if (opts.confirmar && !window.confirm(opts.confirmar)) return;
    startTransition(async () => {
      opts.optimista?.();
      try {
        const r = await fn();
        if ("error" in r && typeof r.error === "string") {
          toast.error(r.error);
          return;
        }
        const exito = r as R;
        const advertencia =
          "advertencia" in exito && typeof exito.advertencia === "string"
            ? exito.advertencia
            : null;
        if (advertencia) toast.warning(advertencia);
        else if (opts.ok) {
          toast.success(typeof opts.ok === "function" ? opts.ok(exito) : opts.ok);
        }
        await opts.alExito?.(exito);
      } catch {
        toast.error(opts.error ?? "Algo falló. Revisa tu conexión.");
      } finally {
        opts.siempre?.();
      }
    });
  }

  return { pending, ejecutar };
}
