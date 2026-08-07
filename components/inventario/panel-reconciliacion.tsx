"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { revisarDescuadres } from "@/app/(app)/inventario/actions";
import { formatearFechaHora } from "@/lib/fecha";
import { Button } from "@/components/ui/button";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { cn } from "@/lib/utils";
import { PanelPiloto } from "@/components/inventario/panel-piloto";
import { FichasDuplicadas } from "@/components/inventario/fichas-duplicadas";
import { TablaDescuadres } from "@/components/inventario/tabla-descuadres";
import { ConteoFisico } from "@/components/inventario/conteo-fisico";
import type { EstadoPiloto } from "@/lib/inventario/piloto";
import type { ResumenReconciliacion } from "@/lib/inventario/reconciliacion";
import type { ConteoConProducto, ProductConProveedor, Profile } from "@/lib/types";


/* Pestaña de reconciliación completa. El resultado de la revisión vive aquí:
   se corre a demanda (lee los catálogos en vivo de cada canal), así que se
   guarda en estado local hasta que se vuelva a pedir. */
export function PanelReconciliacion({
  piloto,
  conteos,
  productos,
  equipo,
  reconciliacionInicial,
}: {
  /* Estado del piloto de escritura: qué productos manda el CRM y cómo van. */
  piloto: EstadoPiloto;
  /* Conteos físicos recientes (con su producto). */
  conteos: ConteoConProducto[];
  productos: ProductConProveedor[];
  /* Equipo, para los selectores de "quién contó/corroboró". */
  equipo: Profile[];
  /* Última reconciliación guardada, para mostrarla al instante al entrar. */
  reconciliacionInicial: { resumen: ResumenReconciliacion; creadoEn: string } | null;
}) {
  const { pending: revisando, ejecutar } = useAccionServidor();
  const [reconciliacion, setReconciliacion] = useState<ResumenReconciliacion | null>(
    reconciliacionInicial?.resumen ?? null,
  );
  const [ultimaRevision, setUltimaRevision] = useState<string | null>(
    reconciliacionInicial?.creadoEn ?? null,
  );

  /* Sin `ok`: el aviso se arma en `alExito` porque aquí el resultado decide el
     TONO, no solo el texto — que todo cuadre es un éxito, y que no cuadre es
     una advertencia aunque la revisión haya salido bien. */
  function revisar() {
    ejecutar(() => revisarDescuadres(), {
      error: "No se pudo revisar. Revisa tu conexión.",
      alExito: (r) => {
        setReconciliacion(r.resumen);
        setUltimaRevision(r.creadoEn);
        const n = r.resumen.descuadres.length;
        const dup = r.resumen.duplicados.length;
        const repetidas = dup ? ` · ${dup} artículo${dup === 1 ? "" : "s"} con fichas repetidas` : "";
        if (n === 0) toast.success(`Todo cuadra: ${r.resumen.revisados} productos revisados.${repetidas}`);
        else
          toast.warning(
            `${n} producto${n === 1 ? "" : "s"} con descuadre de ${r.resumen.revisados} revisados.${repetidas}`,
          );
      },
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Monitor del piloto: solo aparece cuando el CRM tiene el mando de
          algún producto. Va arriba porque es lo que hay que vigilar a diario
          mientras dura la transición. */}
      <PanelPiloto estado={piloto} />
      <div className="flex flex-col gap-3 rounded-xl border bg-card px-4 py-3.5 md:flex-row md:items-center md:justify-between">
        <p className="text-[13.5px] leading-relaxed text-muted-foreground">
          Compara el stock del CRM contra el que tienen <b>en este momento</b> Tienda Nube y
          Mercado Libre, y lista solo lo que no coincide. Es de solo lectura: no corrige nada.
          Para arreglar un descuadre, ajústalo con los botones +/− en Productos.
        </p>
        <div className="flex shrink-0 flex-col items-start gap-1 md:items-end">
          <Button
            variant="outline"
            onClick={revisar}
            disabled={revisando}
            className="h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold"
          >
            <RefreshCw className={cn("size-[15px]", revisando && "animate-spin")} strokeWidth={1.9} aria-hidden="true" />
            {revisando ? "Revisando…" : reconciliacion ? "Revisar de nuevo" : "Revisar ahora"}
          </Button>
          {ultimaRevision && (
            <span className="text-[12px] text-muted-foreground">
              Última revisión: {formatearFechaHora(ultimaRevision)}
            </span>
          )}
        </div>
      </div>

      {revisando && !reconciliacion && (
        <p className="text-sm italic text-muted-foreground">
          Leyendo los catálogos de los canales… puede tardar un poco si hay muchos productos.
        </p>
      )}

      {reconciliacion && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <span>
              <b className="text-foreground">{reconciliacion.revisados}</b> productos revisados ·{" "}
              <b className={cn(reconciliacion.descuadres.length > 0 ? "text-red-600" : "text-green-600")}>
                {reconciliacion.descuadres.length}
              </b>{" "}
              con descuadre
            </span>
            {!reconciliacion.tnConectada && (
              <span className="rounded-full border px-2 py-0.5 text-xs">Tienda Nube no conectada</span>
            )}
            {!reconciliacion.mlConectada && (
              <span className="rounded-full border px-2 py-0.5 text-xs">Mercado Libre no conectado</span>
            )}
          </div>
          <FichasDuplicadas
            grupos={reconciliacion.duplicados}
            onFusionado={(clave) =>
              setReconciliacion((r) =>
                r ? { ...r, duplicados: r.duplicados.filter((g) => g.clave !== clave) } : r,
              )
            }
          />
          <TablaDescuadres descuadres={reconciliacion.descuadres} />
        </>
      )}

      {!reconciliacion && !revisando && (
        <p className="text-sm italic text-muted-foreground">
          Pulsa «Revisar ahora» para generar el reporte.
        </p>
      )}

      <ConteoFisico conteos={conteos} productos={productos} equipo={equipo} />
    </div>
  );
}
