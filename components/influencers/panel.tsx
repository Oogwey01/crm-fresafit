"use client";

import { useMemo, useState } from "react";
import { Gift, Megaphone, Plus, Star, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/compartido/stat-card";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { InfluencerDialog } from "@/components/influencers/influencer-dialog";
import { TablaInfluencers } from "@/components/influencers/tabla-influencers";
import { EntregasInfluencer } from "@/components/influencers/entregas-influencer";
import { TablaEvaluaciones } from "@/components/influencers/tabla-evaluaciones";
import { ImportarProspectos } from "@/components/influencers/importar-prospectos";
import { ETAPAS_INFLUENCER, TIERS_INFLUENCER } from "@/lib/catalogos";
import { formatearMXN } from "@/lib/moneda";
import { norm } from "@/lib/importar/tsv";
import type {
  Influencer,
  InfluencerEntrega,
  InfluencerEvaluacion,
  Product,
} from "@/lib/types";

/* Las tres preguntas del programa: a quién estamos viendo, quién ya trabaja con
   nosotros y cómo le fue este mes. */
const PESTANAS = [
  ["pipeline", "Pipeline"],
  ["embajadores", "Embajadores"],
  ["evaluaciones", "Evaluaciones"],
] as const;

type Pestana = (typeof PESTANAS)[number][0];

/* Etapas que cuentan como "ya está adentro". */
const ETAPAS_ACTIVAS = ["activo", "pausado"];

export type ProductoLigero = Pick<Product, "id" | "nombre" | "variante" | "sku" | "precio">;

export function PanelInfluencers({
  influencers,
  entregas,
  evaluaciones,
  productos,
  /* Va incrustado como pestaña de «Clientes y ventas»: ese módulo ya puso su
     título, así que aquí solo quedan los botones. */
  embebido = false,
}: {
  influencers: Influencer[];
  entregas: InfluencerEntrega[];
  evaluaciones: InfluencerEvaluacion[];
  productos: ProductoLigero[];
  embebido?: boolean;
}) {
  const [pestana, setPestana] = useState<Pestana>("pipeline");
  const [busqueda, setBusqueda] = useState("");
  const [filtroEtapa, setFiltroEtapa] = useState("todas");
  /* null = cerrado; "nuevo" = alta; objeto = edición. */
  const [dialogo, setDialogo] = useState<Influencer | "nuevo" | null>(null);
  /* Ficha cuyas entregas y evaluación se están viendo. */
  const [detalleId, setDetalleId] = useState<string | null>(null);
  const detalle = detalleId ? (influencers.find((i) => i.id === detalleId) ?? null) : null;

  const activos = influencers.filter((i) => ETAPAS_ACTIVAS.includes(i.etapa));
  const prospectos = influencers.filter((i) => i.etapa === "prospecto" || i.etapa === "evaluacion");

  /* Lo que se comprometió al mes en producto: la suma del crédito de quien está
     activo (el suyo si se negoció, si no el de su tier). */
  const creditoMensual = activos.reduce((acc, i) => acc + (creditoDe(i) ?? 0), 0);
  const entregadoEsteMes = useMemo(() => {
    const mes = new Date().toISOString().slice(0, 7);
    return entregas
      .filter((e) => e.fecha.startsWith(mes))
      .reduce((acc, e) => acc + (e.valor ?? 0) * e.cantidad, 0);
  }, [entregas]);

  /* El compilador de React memoiza esto solo; envolverlo a mano en useMemo
     rompía su optimización (la lista base se deriva en cada render). */
  const base = pestana === "embajadores" ? activos : prospectos;
  const q = norm(busqueda);
  const visibles = base.filter((i) => {
    if (filtroEtapa !== "todas" && i.etapa !== filtroEtapa) return false;
    if (!q) return true;
    return [i.nombre, i.ig_usuario, i.tiktok_usuario, i.codigo, i.correo]
      .filter(Boolean)
      .some((c) => norm(String(c)).includes(q));
  });

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        {!embebido && (
          <div>
            <h1 className="text-[26px] font-bold tracking-tight">Influencers y embajadores</h1>
            <p className="mt-1.5 text-[14.5px] text-muted-foreground">
              Quién nos representa, qué se le manda y cuánto vende su código.
            </p>
          </div>
        )}
        <div className="flex w-full flex-wrap items-center gap-2 md:ml-auto md:w-auto md:justify-end">
          <ImportarProspectos />
          <Button
            onClick={() => setDialogo("nuevo")}
            className="h-auto w-full gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.1} />
            Nuevo influencer
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard etiqueta="Prospectos" valor={String(prospectos.length)} icono={Users} />
        <StatCard etiqueta="Activos" valor={String(activos.length)} icono={Star} />
        <StatCard
          etiqueta="Crédito al mes"
          valor={formatearMXN(creditoMensual)}
          icono={Gift}
          nota="comprometido en producto"
        />
        <StatCard
          etiqueta="Entregado este mes"
          valor={formatearMXN(entregadoEsteMes)}
          icono={Megaphone}
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

        <div className="flex-1" />

        {pestana !== "evaluaciones" && (
          <>
            <Input
              placeholder="Buscar por nombre, @usuario o código…"
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              className="h-auto min-w-[240px] flex-1 rounded-[10px] bg-card py-2 md:max-w-xs"
            />
            <Select value={filtroEtapa} onValueChange={(v) => setFiltroEtapa(v ?? "todas")}>
              <SelectTrigger className="w-[170px] bg-card">
                <SelectValue>
                  {(v: string) =>
                    v === "todas"
                      ? "Todas las etapas"
                      : (ETAPAS_INFLUENCER.find((e) => e.id === v)?.nombre ?? "Etapa")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas las etapas</SelectItem>
                {ETAPAS_INFLUENCER.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>

      {pestana !== "evaluaciones" && (
        <TablaInfluencers
          influencers={visibles}
          entregas={entregas}
          evaluaciones={evaluaciones}
          vacio={
            pestana === "embajadores"
              ? "Todavía no hay nadie activo. Cambia a alguien de etapa desde el pipeline."
              : "No hay prospectos. Importa las respuestas del formulario para empezar."
          }
          onEditar={setDialogo}
          onVerDetalle={(i) => setDetalleId(i.id)}
        />
      )}

      {pestana === "evaluaciones" && (
        <TablaEvaluaciones
          evaluaciones={evaluaciones}
          influencers={influencers}
          onVerDetalle={(id) => setDetalleId(id)}
        />
      )}

      {dialogo && (
        <InfluencerDialog
          influencer={dialogo === "nuevo" ? null : dialogo}
          onClose={() => setDialogo(null)}
        />
      )}

      {detalle && (
        <EntregasInfluencer
          influencer={detalle}
          entregas={entregas.filter((e) => e.influencer_id === detalle.id)}
          evaluaciones={evaluaciones.filter((e) => e.influencer_id === detalle.id)}
          productos={productos}
          onClose={() => setDetalleId(null)}
        />
      )}
    </div>
  );
}

/* Lo que se le da al mes: lo negociado en su ficha o, si no, lo del tier. */
export function creditoDe(i: Influencer): number | null {
  if (i.credito_mensual != null) return i.credito_mensual;
  return TIERS_INFLUENCER.find((t) => t.id === i.tier)?.creditoMensual ?? null;
}
