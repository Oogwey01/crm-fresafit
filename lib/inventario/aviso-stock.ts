/* ============================================================================
   lib/inventario/aviso-stock.ts  —  Confirmación del ajuste manual de stock
   ----------------------------------------------------------------------------
   Los +/− de la tabla y los de la ficha guardan contra el servidor, así que
   hasta que la página revalida no hay señal de que el cambio se haya escrito:
   el número de pantalla se mueve igual. Este aviso cierra ese hueco y dice
   cuánto quedó, de cuánto venía y si el ajuste se quedó en el CRM.
   ============================================================================ */

"use client";

import { toast } from "sonner";

export function avisarStockAjustado({
  productoId,
  nombre,
  anterior,
  nuevo,
  escrituraCanales,
}: {
  productoId: string;
  nombre: string;
  anterior: number;
  nuevo: number;
  /* false (el default del sistema) = el ajuste es local, no viaja a los canales. */
  escrituraCanales: boolean;
}) {
  const unidades = nuevo === 1 ? "1 unidad" : `${nuevo} unidades`;
  const local = escrituraCanales ? "" : " El cambio es solo en el CRM.";
  toast.success(`Stock actualizado: ${unidades}`, {
    /* El id lleva el valor que quedó, no solo el producto: sonner reutiliza el
       aviso cuando el id se repite y NO reinicia su temporizador, así que dos
       ajustes seguidos al mismo producto dejaban el segundo en pantalla apenas
       el resto del primero. Con el valor dentro, cada ajuste es un aviso nuevo
       y solo se colapsa el caso que sí conviene: reintentar el mismo número. */
    id: `stock-${productoId}-${nuevo}`,
    description: `${nombre}: de ${anterior} a ${nuevo}.${local}`,
  });
}
