"use client";

import { useState } from "react";
import Link from "next/link";
import { Boxes, ClipboardCheck, Package, PackageCheck, Sparkles } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/compartido/stat-card";
import { TabsSeccion } from "@/components/compartido/tabs-seccion";
import { SeccionRecepcion } from "@/components/bodega/seccion-recepcion";
import { SeccionConjuntos } from "@/components/bodega/seccion-conjuntos";
import { SeccionFulls } from "@/components/bodega/seccion-fulls";
import { SeccionInsumos } from "@/components/bodega/seccion-insumos";
import { ConteoFisico } from "@/components/bodega/conteo-fisico";
import type { CanalesFicha, ProductoLigeroFila } from "@/app/(app)/bodega/page";
import type {
  ConjuntoArmado,
  ConjuntoConComponentes,
  ConteoConProducto,
  EnvioFullConCajas,
  InsumoConPresentaciones,
  InsumoMovimiento,
  InsumoPermiso,
  Profile,
  RecepcionConItems,
} from "@/lib/types";

/* Personalizados salió de aquí a su propio módulo: quien los lleva es diseño,
   no bodega. Queda el enlace en la cabecera.

   «Conteo físico» llegó al revés: vivía en la pestaña Reconciliación de
   /inventario, que es la pantalla de análisis del catálogo, cuando contar el
   anaquel se hace aquí y con el teléfono en la mano. */
const PESTANAS = [
  ["recepcion", "Recepción"],
  ["conjuntos", "Conjuntos"],
  ["fulls", "Envíos full"],
  ["insumos", "Insumos"],
  ["conteo", "Conteo físico"],
] as const;

type Pestana = (typeof PESTANAS)[number][0];

export function PanelBodega({
  recepciones,
  conjuntos,
  armados,
  canalesFicha,
  envios,
  insumos,
  movimientos,
  permisos,
  equipo,
  productos,
  conteos,
  puedeMoverInsumos,
  admin,
}: {
  recepciones: RecepcionConItems[];
  conjuntos: ConjuntoConComponentes[];
  armados: ConjuntoArmado[];
  canalesFicha: CanalesFicha;
  envios: EnvioFullConCajas[];
  insumos: InsumoConPresentaciones[];
  movimientos: InsumoMovimiento[];
  permisos: InsumoPermiso[];
  equipo: Profile[];
  productos: ProductoLigeroFila[];
  /* Conteos físicos recientes (con su producto, para ver el descuadre). */
  conteos: ConteoConProducto[];
  /* Si esta persona puede mover el stock de insumos (el candado real es la RPC). */
  puedeMoverInsumos: boolean;
  admin: boolean;
}) {
  const [pestana, setPestana] = useState<Pestana>("recepcion");

  const abiertas = recepciones.filter((r) => r.estado === "abierta");
  const porDescontar = abiertas.reduce(
    (acc, r) => acc + r.items.filter((i) => i.estado !== "descontado").length,
    0,
  );
  const insumosBajos = insumos.filter((i) => i.activo && i.stock <= i.minimo);
  /* Cuántos conjuntos se pueden armar hoy: los que tienen todas sus piezas
     ligadas a una ficha y stock suficiente para al menos uno. Es el mismo
     criterio de la columna «Armables», que es lo que la RPC va a permitir. */
  const conjuntosArmables = conjuntos.filter((c) => {
    if (!c.componentes.length) return false;
    return c.componentes.every((comp) => {
      const p = comp.producto_id ? productos.find((x) => x.id === comp.producto_id) : null;
      return !!p && p.stock >= comp.cantidad;
    });
  });

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Bodega</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Lo que llega, lo que se arma, lo que se personaliza y lo que se consume.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          {/* La vuelta al catálogo: aquí se ve entrar la mercancía, allá cuánta
              hay. Antes era la miga de pan de cuando bodega colgaba de
              Inventario; ahora que es módulo propio, se queda como atajo. */}
          <Link
            href="/inventario"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold",
            )}
          >
            <Package className="size-4" strokeWidth={2} />
            Inventario
          </Link>
          <Link
            href="/personalizados"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold",
            )}
          >
            <Sparkles className="size-4" strokeWidth={2} />
            Personalizados
          </Link>
          {/* Las tareas de bodega viven en el tablero de siempre, no en un
              sistema aparte: filtradas por su etiqueta. */}
          <Link
            href="/tareas?etiqueta=bodega"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold",
            )}
          >
            <ClipboardCheck className="size-4" strokeWidth={2} />
            Tareas de bodega
          </Link>
        </div>
      </div>

      <TabsSeccion opciones={PESTANAS} valor={pestana} onCambio={setPestana} className="mb-4" />

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard etiqueta="Cargas abiertas" valor={String(abiertas.length)} icono={PackageCheck} />
        <StatCard
          etiqueta="Renglones pendientes"
          valor={String(porDescontar)}
          icono={Boxes}
          nota="sin descontar"
          valorClassName={porDescontar > 0 ? "text-amber-600" : undefined}
        />
        <StatCard
          etiqueta="Conjuntos"
          valor={String(conjuntos.length)}
          icono={Boxes}
          nota={`${conjuntosArmables.length} se pueden armar hoy`}
        />
        <StatCard
          etiqueta="Insumos por acabarse"
          valor={String(insumosBajos.length)}
          icono={Boxes}
          valorClassName={insumosBajos.length > 0 ? "text-red-600" : undefined}
        />
      </div>

      {pestana === "recepcion" && (
        <SeccionRecepcion recepciones={recepciones} productos={productos} />
      )}
      {pestana === "conjuntos" && (
        <SeccionConjuntos
          conjuntos={conjuntos}
          productos={productos}
          armados={armados}
          canalesFicha={canalesFicha}
          equipo={equipo}
        />
      )}
      {pestana === "fulls" && <SeccionFulls envios={envios} productos={productos} />}
      {pestana === "insumos" && (
        <SeccionInsumos
          insumos={insumos}
          movimientos={movimientos}
          permisos={permisos}
          equipo={equipo}
          puedeMover={puedeMoverInsumos}
          admin={admin}
        />
      )}
      {pestana === "conteo" && (
        <ConteoFisico conteos={conteos} productos={productos} equipo={equipo} />
      )}
    </div>
  );
}
