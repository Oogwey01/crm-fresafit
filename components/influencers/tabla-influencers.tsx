"use client";

import { AtSign, Music2 } from "lucide-react";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { Pastilla } from "@/components/compartido/pastilla";
import { Resaltado } from "@/components/compartido/resaltado";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { cambiarEtapaInfluencer } from "@/app/(app)/influencers/actions";
import {
  ETAPAS_INFLUENCER,
  MESES_PRUEBA_INFLUENCER,
  obtenerEtapaInfluencer,
  obtenerTierInfluencer,
} from "@/lib/catalogos";
import { formatearFecha } from "@/lib/fecha";
import { formatearNumeroCorto } from "@/lib/moneda";
import type { EtapaInfluencerId, Influencer, InfluencerEntrega, InfluencerEvaluacion } from "@/lib/types";


/* ¿Ya se le acabaron los dos meses de prueba? */
function pruebaVencida(inicio: string | null): boolean {
  if (!inicio) return false;
  const fin = new Date(inicio);
  fin.setMonth(fin.getMonth() + MESES_PRUEBA_INFLUENCER);
  return fin < new Date();
}

export function TablaInfluencers({
  influencers,
  entregas,
  evaluaciones,
  busqueda,
  vacio,
  onEditar,
  onVerDetalle,
}: {
  influencers: Influencer[];
  entregas: InfluencerEntrega[];
  evaluaciones: InfluencerEvaluacion[];
  /* Lo escrito en el buscador. No filtra —la lista ya llega recortada—: solo
     señala en cada renglón por dónde pegó la coincidencia. */
  busqueda: string;
  vacio: string;
  onEditar: (i: Influencer) => void;
  onVerDetalle: (i: Influencer) => void;
}) {
  const { pending, ejecutar } = useAccionServidor();

  function moverEtapa(i: Influencer, etapa: EtapaInfluencerId) {
    ejecutar(() => cambiarEtapaInfluencer(i.id, etapa), {
      ok: `${i.nombre} → ${obtenerEtapaInfluencer(etapa)?.nombre ?? etapa}.`,
      error: "No se pudo mover de etapa. Revisa tu conexión.",
    });
  }

  const columnas: Columna<Influencer>[] = [
    {
      clave: "nombre",
      label: "Quién",
      esTitulo: true,
      celda: (i) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">
            <Resaltado texto={i.nombre} busca={busqueda} />
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
            {i.ig_usuario && (
              <span className="inline-flex items-center gap-1">
                <AtSign className="size-3.5" strokeWidth={1.8} />
                <Resaltado texto={i.ig_usuario} busca={busqueda} /> ·{" "}
                {formatearNumeroCorto(i.ig_seguidores)}
              </span>
            )}
            {i.tiktok_usuario && (
              <span className="inline-flex items-center gap-1">
                <Music2 className="size-3.5" strokeWidth={1.8} />
                <Resaltado texto={i.tiktok_usuario} busca={busqueda} /> ·{" "}
                {formatearNumeroCorto(i.tiktok_seguidores)}
              </span>
            )}
          </div>
        </div>
      ),
    },
    {
      clave: "tier",
      label: "Tier",
      celda: (i) => {
        const tier = obtenerTierInfluencer(i.tier);
        return tier ? <Pastilla nombre={tier.nombre} color={tier.color} /> : <span className="text-muted-foreground">—</span>;
      },
    },
    {
      clave: "codigo",
      label: "Código",
      celda: (i) =>
        i.codigo ? (
          <span className="font-mono text-[12.5px] font-semibold">
            <Resaltado texto={i.codigo} busca={busqueda} />
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      clave: "prueba",
      label: "Prueba",
      celda: (i) =>
        i.inicio_prueba ? (
          <span className={pruebaVencida(i.inicio_prueba) ? "text-amber-600" : undefined}>
            {formatearFecha(i.inicio_prueba)}
            {pruebaVencida(i.inicio_prueba) && (
              <span className="block text-[11px]">periodo cumplido</span>
            )}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      clave: "actividad",
      label: "Material · evaluaciones",
      celda: (i) => {
        const suyas = entregas.filter((e) => e.influencer_id === i.id).length;
        const evals = evaluaciones.filter((e) => e.influencer_id === i.id).length;
        return (
          <button
            type="button"
            onClick={() => onVerDetalle(i)}
            className="text-primary hover:underline"
          >
            {suyas} {suyas === 1 ? "entrega" : "entregas"} · {evals}{" "}
            {evals === 1 ? "evaluación" : "evaluaciones"}
          </button>
        );
      },
    },
    {
      clave: "etapa",
      label: "Etapa",
      celda: (i) => (
        <Select
          value={i.etapa}
          disabled={pending}
          onValueChange={(v) => v && v !== i.etapa && moverEtapa(i, v as EtapaInfluencerId)}
        >
          <SelectTrigger className="h-8 w-[150px]">
            <SelectValue>
              {(v: string) => obtenerEtapaInfluencer(v)?.nombre ?? "Etapa"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {ETAPAS_INFLUENCER.map((e) => (
              <SelectItem key={e.id} value={e.id}>
                {e.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      clave: "acciones",
      label: "",
      celda: (i) => (
        <Button variant="outline" size="sm" onClick={() => onEditar(i)}>
          Editar
        </Button>
      ),
    },
  ];

  return (
    <TablaSimple
      cols="grid-cols-[minmax(220px,2fr)_130px_120px_130px_1fr_160px_90px]"
      columnas={columnas}
      datos={influencers}
      filaKey={(i) => i.id}
      minW="min-w-[1040px]"
      vacio={vacio}
      onRowClick={onVerDetalle}
    />
  );
}
