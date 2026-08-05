"use client";

import { AlertTriangle, PackageX, ShoppingCart, type LucideIcon } from "lucide-react";
import type { GrupoReorden } from "@/lib/inventario/reabastecimiento";
import type { ProductConProveedor } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Lo que hay que atender del inventario, en UN solo renglón.

   Antes eran tres tarjetas apiladas —reorden, por acabarse, solo lectura— con
   ejemplos de producto dentro. Sumaban casi doscientos píxeles antes de que se
   viera el primer renglón del catálogo, y los ejemplos no ayudaban: tres
   nombres truncados de ciento seis no dicen nada que el clic no diga mejor.
   Ahora cada aviso es una pastilla que lleva a su lista. El de «modo solo
   lectura» se fue a la cabecera, junto al estado de los canales: es una
   condición permanente, no un pendiente. */
export function AvisosInventario({
  porPedir,
  porAcabarse,
  agotados,
  gestor,
  pestana,
  onVerQuePedir,
  onVerPorStock,
  onGenerarPedido,
}: {
  porPedir: GrupoReorden[];
  porAcabarse: ProductConProveedor[];
  agotados: ProductConProveedor[];
  gestor: boolean;
  pestana: string;
  onVerQuePedir: () => void;
  onVerPorStock: (estado: string) => void;
  /* Solo dirección: el pedido a proveedor vive en su propio módulo. */
  onGenerarPedido?: () => void;
}) {
  /* En «Qué pedir» ya estás viendo el reorden: repetirlo arriba sobra. */
  const mostrarPorPedir = porPedir.length > 0 && pestana !== "reabastecer";
  const hayAlgo = mostrarPorPedir || porAcabarse.length > 0 || agotados.length > 0;
  if (!hayAlgo) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {mostrarPorPedir && (
        <Aviso
          icono={ShoppingCart}
          tono="rojo"
          onClick={onVerQuePedir}
          titulo="Se acaban antes de que llegue un pedido nuevo, con la venta de los últimos 30 días"
        >
          <b className="font-bold">{porPedir.length}</b> por pedir ya
        </Aviso>
      )}
      {porAcabarse.length > 0 && (
        <Aviso
          icono={AlertTriangle}
          tono="ambar"
          onClick={() => onVerPorStock("por_acabarse")}
          titulo="Queda poco stock: ver la lista filtrada"
        >
          <b className="font-bold">{porAcabarse.length}</b> por acabarse
        </Aviso>
      )}
      {agotados.length > 0 && (
        <Aviso
          icono={PackageX}
          tono="gris"
          onClick={() => onVerPorStock("agotado")}
          titulo="Sin existencias: ver la lista filtrada"
        >
          <b className="font-bold">{agotados.length}</b> agotados
        </Aviso>
      )}
      {gestor && onGenerarPedido && (
        <>
          <div className="flex-1" />
          <Button
            variant="outline"
            size="sm"
            onClick={onGenerarPedido}
            className="h-auto rounded-[9px] px-3 py-1.5 text-[12.5px] font-semibold"
          >
            Generar pedido
          </Button>
        </>
      )}
    </div>
  );
}

const TONOS = {
  rojo: "border-red-200 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-900 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900/50",
  ambar:
    "border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300 dark:hover:bg-amber-900/50",
  gris: "border-border bg-muted/40 text-muted-foreground hover:bg-muted",
} as const;

function Aviso({
  icono: Icono,
  tono,
  titulo,
  onClick,
  children,
}: {
  icono: LucideIcon;
  tono: keyof typeof TONOS;
  titulo: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={titulo}
      className={cn(
        "inline-flex items-center gap-2 rounded-[10px] border px-3 py-1.5 text-[13px] transition-colors",
        TONOS[tono],
      )}
    >
      <Icono className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
      {children}
    </button>
  );
}
