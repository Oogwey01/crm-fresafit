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
  onVerQuePedir,
  onVerPorStock,
  onGenerarPedido,
}: {
  porPedir: GrupoReorden[];
  porAcabarse: ProductConProveedor[];
  agotados: ProductConProveedor[];
  gestor: boolean;
  /* Solo dirección: «Qué pedir» vive en /proveedores, que es su módulo. Sin
     handler el aviso sigue enseñando el número, pero como dato quieto. */
  onVerQuePedir?: () => void;
  onVerPorStock: (estado: string) => void;
  /* Solo dirección: el pedido a proveedor vive en su propio módulo. */
  onGenerarPedido?: () => void;
}) {
  const hayAlgo = porPedir.length > 0 || porAcabarse.length > 0 || agotados.length > 0;
  if (!hayAlgo) return null;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {porPedir.length > 0 && (
        <Aviso
          icono={ShoppingCart}
          tono="rojo"
          onClick={onVerQuePedir}
          titulo={
            onVerQuePedir
              ? "Se acaban antes de que llegue un pedido nuevo, con la venta de los últimos 30 días. Ver «Qué pedir» en Proveedores"
              : "Se acaban antes de que llegue un pedido nuevo, con la venta de los últimos 30 días"
          }
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
  rojo: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-300",
  ambar:
    "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300",
  gris: "border-border bg-muted/40 text-muted-foreground",
} as const;

/* El realce del cursor va aparte: solo lo lleva el aviso que de verdad se puede
   pulsar. */
const HOVER = {
  rojo: "transition-colors hover:bg-red-100 dark:hover:bg-red-900/50",
  ambar: "transition-colors hover:bg-amber-100 dark:hover:bg-amber-900/50",
  gris: "transition-colors hover:bg-muted",
} as const;

/* Sin `onClick` se pinta como texto y no como botón: el aviso sigue diciendo su
   número —que es el dato— pero no promete un clic que no lleva a ningún lado.
   Pasa con «por pedir» para quien no es dirección: la lista vive en /proveedores
   y esa pantalla no la puede abrir. */
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
  onClick?: () => void;
  children: React.ReactNode;
}) {
  const clases = cn(
    "inline-flex items-center gap-2 rounded-[10px] border px-3 py-1.5 text-[13px]",
    TONOS[tono],
    onClick && HOVER[tono],
  );
  const contenido = (
    <>
      <Icono className="size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
      {children}
    </>
  );

  if (!onClick) {
    return (
      <span title={titulo} className={clases}>
        {contenido}
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} title={titulo} className={clases}>
      {contenido}
    </button>
  );
}
