"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Boxes, ClipboardCheck, PackageCheck, Sparkles } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { StatCard } from "@/components/compartido/stat-card";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { SeccionRecepcion } from "@/components/bodega/seccion-recepcion";
import { SeccionConjuntos } from "@/components/bodega/seccion-conjuntos";
import { SeccionFulls } from "@/components/bodega/seccion-fulls";
import { SeccionInsumos } from "@/components/bodega/seccion-insumos";
import type { ProductoLigeroFila } from "@/app/(app)/inventario/bodega/page";
import type {
  ConjuntoConComponentes,
  EnvioFullConCajas,
  InsumoConPresentaciones,
  InsumoMovimiento,
  InsumoPermiso,
  Profile,
  RecepcionConItems,
} from "@/lib/types";

/* Personalizados salió de aquí a su propio módulo: quien los lleva es diseño,
   no bodega. Queda el enlace en la cabecera. */
const PESTANAS = [
  ["recepcion", "Recepción"],
  ["conjuntos", "Conjuntos"],
  ["fulls", "Envíos full"],
  ["insumos", "Insumos"],
] as const;

type Pestana = (typeof PESTANAS)[number][0];

export function PanelBodega({
  recepciones,
  conjuntos,
  envios,
  insumos,
  movimientos,
  permisos,
  equipo,
  productos,
  puedeMoverInsumos,
  admin,
}: {
  recepciones: RecepcionConItems[];
  conjuntos: ConjuntoConComponentes[];
  envios: EnvioFullConCajas[];
  insumos: InsumoConPresentaciones[];
  movimientos: InsumoMovimiento[];
  permisos: InsumoPermiso[];
  equipo: Profile[];
  productos: ProductoLigeroFila[];
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
  const conjuntosActivos = conjuntos.filter((c) => c.activo);

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <Link
            href="/inventario"
            className="mb-1.5 inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" strokeWidth={2} />
            Inventario
          </Link>
          <h1 className="text-[26px] font-bold tracking-tight">Bodega</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Lo que llega, lo que se arma, lo que se personaliza y lo que se consume.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
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

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard etiqueta="Cargas abiertas" valor={String(abiertas.length)} icono={PackageCheck} />
        <StatCard
          etiqueta="Renglones pendientes"
          valor={String(porDescontar)}
          icono={Boxes}
          nota="sin descontar"
          valorClassName={porDescontar > 0 ? "text-amber-600" : undefined}
        />
        <StatCard etiqueta="Conjuntos armados" valor={String(conjuntosActivos.length)} icono={Boxes} />
        <StatCard
          etiqueta="Insumos por acabarse"
          valor={String(insumosBajos.length)}
          icono={Boxes}
          valorClassName={insumosBajos.length > 0 ? "text-red-600" : undefined}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={pestana} onValueChange={(v) => v && setPestana(v as Pestana)}>
          <SelectTrigger className="w-full bg-card md:hidden">
            <SelectValue>
              {(v: string) => PESTANAS.find(([id]) => id === v)?.[1] ?? "Sección"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PESTANAS.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ControlSegmentado
          opciones={PESTANAS}
          valor={pestana}
          onCambio={setPestana}
          className="hidden md:inline-flex"
        />
      </div>

      {pestana === "recepcion" && (
        <SeccionRecepcion recepciones={recepciones} productos={productos} />
      )}
      {pestana === "conjuntos" && <SeccionConjuntos conjuntos={conjuntos} productos={productos} />}
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
    </div>
  );
}
