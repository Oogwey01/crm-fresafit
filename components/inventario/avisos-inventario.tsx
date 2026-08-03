"use client";

import { AlertTriangle, Lock, ShoppingCart } from "lucide-react";
import type { GrupoReorden } from "@/lib/inventario/reabastecimiento";
import type { ProductConProveedor } from "@/lib/types";
import { Button } from "@/components/ui/button";

/* Los tres avisos que van entre la barra de herramientas y las tablas:
   reorden (rojo), por-acabarse (ámbar) y modo solo lectura. */
export function AvisosInventario({
  porPedir,
  porAcabarse,
  agotados,
  escrituraCanales,
  gestor,
  pestana,
  algunCanalConectado,
  onVerQuePedir,
  onVerPorStock,
  onGenerarPedido,
}: {
  porPedir: GrupoReorden[];
  porAcabarse: ProductConProveedor[];
  agotados: ProductConProveedor[];
  /* false (el default del sistema) = el CRM no modifica nada en las plataformas. */
  escrituraCanales: boolean;
  gestor: boolean;
  pestana: string;
  algunCanalConectado: boolean;
  onVerQuePedir: () => void;
  onVerPorStock: (estado: string) => void;
  onGenerarPedido: () => void;
}) {
  return (
    <>
      {/* Aviso de reorden: lo que se va a agotar ANTES de que llegue un pedido
          nuevo, según lo que se está vendiendo. Es distinto de «por acabarse»
          (umbral fijo): aquí manda la velocidad de salida. */}
      {porPedir.length > 0 && pestana !== "reabastecer" && (
        <button
          type="button"
          onClick={onVerQuePedir}
          className="mb-4 flex w-full items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-left hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:hover:bg-red-900/50"
        >
          <ShoppingCart className="size-[18px] shrink-0 text-red-600 dark:text-red-400" strokeWidth={1.9} aria-hidden="true" />
          <span className="flex-1 text-[13.5px] leading-relaxed text-red-800 dark:text-red-300">
            <b className="font-bold">
              {porPedir.length === 1
                ? "1 producto hay que pedirlo ya."
                : `${porPedir.length} productos hay que pedirlos ya.`}
            </b>{" "}
            Con la venta de los últimos 30 días se acaban antes de que llegue un pedido nuevo:{" "}
            {porPedir
              .slice(0, 3)
              .map((g) => g.nombre)
              .join(", ")}
            {porPedir.length > 3 ? "…" : ""}
          </span>
          <span className="shrink-0 text-[12.5px] font-semibold text-red-700 underline-offset-2 hover:underline dark:text-red-300">
            Ver qué pedir
          </span>
        </button>
      )}

      {/* Aviso: SOLO lo que está por acabarse (lo accionable). Lo agotado se
          consulta con el filtro; en la tienda hay cientos y ahogaban el aviso. */}
      {porAcabarse.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950">
          <AlertTriangle className="size-[18px] shrink-0 text-amber-600 dark:text-amber-400" strokeWidth={1.9} aria-hidden="true" />
          <button
            type="button"
            onClick={() => onVerPorStock("por_acabarse")}
            className="flex-1 text-left text-[13.5px] leading-relaxed text-amber-800 hover:underline dark:text-amber-300"
          >
            <b className="font-bold text-amber-700 dark:text-amber-300">
              {porAcabarse.length === 1
                ? "1 producto está por acabarse."
                : `${porAcabarse.length} productos están por acabarse.`}
            </b>{" "}
            {porAcabarse
              .slice(0, 3)
              .map((p) => p.nombre)
              .join(", ")}
            {porAcabarse.length > 3 ? "…" : ""}
          </button>
          {agotados.length > 0 && (
            <button
              type="button"
              onClick={() => onVerPorStock("agotado")}
              className="shrink-0 text-[12.5px] font-semibold text-amber-700 underline-offset-2 hover:underline dark:text-amber-300"
            >
              Ver {agotados.length} agotados
            </button>
          )}
          {gestor && (
            <Button
              variant="outline"
              size="sm"
              onClick={onGenerarPedido}
              className="h-auto shrink-0 rounded-[9px] border-amber-200 bg-card px-3 py-1.5 text-[12.5px] font-semibold text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-300"
            >
              Generar pedido
            </Button>
          )}
        </div>
      )}

      {/* Modo solo lectura: el CRM importa de las plataformas pero no escribe
          nada allá. Se avisa donde se edita el stock, para que nadie espere que
          el ajuste viaje a la tienda. */}
      {!escrituraCanales && algunCanalConectado && pestana === "productos" && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border bg-muted/40 px-4 py-3">
          <Lock className="mt-0.5 size-[16px] shrink-0 text-muted-foreground" strokeWidth={1.9} aria-hidden="true" />
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">
            <b className="font-semibold text-foreground">Modo solo lectura.</b> El CRM importa el inventario de
            Tienda Nube, Mercado Libre y TikTok Shop, pero no modifica nada allá. Los ajustes de stock, precio y
            costo que hagas aquí se quedan en el CRM.
          </p>
        </div>
      )}
    </>
  );
}
