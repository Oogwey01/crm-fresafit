"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { avisarStockAjustado } from "@/lib/inventario/aviso-stock";
import { ajustarStock } from "@/app/(app)/inventario/actions";

/* Los botones −/+ de stock viven en dos vistas del catálogo (la desglosada y la
   agrupada por producto). El ajuste optimista, el aviso y el manejo de error son
   idénticos en las dos, así que se comparten aquí en vez de duplicarse. */
export function useAjusteStock(escrituraCanales: boolean) {
  const [, startTransition] = useTransition();

  /* Aviso del botón: sin escritura a canales el ajuste se queda en el CRM, y eso
     hay que decirlo antes de que alguien lo toque creyendo que sincroniza. */
  const tituloAjuste = escrituraCanales
    ? undefined
    : "Ajuste local: el stock cambia solo en el CRM, no en Tienda Nube ni Mercado Libre.";

  function cambiarStock(
    p: { id: string; nombre: string; stock: number },
    delta: number,
  ) {
    const nuevo = p.stock + delta;
    if (nuevo < 0) return;
    startTransition(async () => {
      try {
        const r = await ajustarStock(p.id, nuevo);
        if ("error" in r) toast.error(r.error);
        else
          avisarStockAjustado({
            productoId: p.id,
            nombre: p.nombre,
            anterior: p.stock,
            nuevo,
            escrituraCanales,
          });
      } catch {
        toast.error("No se pudo ajustar el stock. Revisa tu conexión.");
      }
    });
  }

  return { cambiarStock, tituloAjuste };
}
