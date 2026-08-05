"use client";

import { Trash2 } from "lucide-react";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { borrarEvaluacion } from "@/app/(app)/influencers/actions";
import { formatearFechaLarga } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { Influencer, InfluencerEvaluacion } from "@/lib/types";

/* Todas las evaluaciones, del mes más reciente al más viejo: es la vista que
   contesta "cómo nos fue este mes con el programa" sin abrir ficha por ficha. */
export function TablaEvaluaciones({
  evaluaciones,
  influencers,
  onVerDetalle,
}: {
  evaluaciones: InfluencerEvaluacion[];
  influencers: Influencer[];
  onVerDetalle: (influencerId: string) => void;
}) {
  const { ejecutar } = useAccionServidor();
  const nombreDe = (id: string) => influencers.find((i) => i.id === id)?.nombre ?? "—";

  const columnas: Columna<InfluencerEvaluacion>[] = [
    {
      clave: "persona",
      label: "Quién",
      esTitulo: true,
      celda: (e) => <span className="font-semibold">{nombreDe(e.influencer_id)}</span>,
    },
    {
      clave: "periodo",
      label: "Mes",
      celda: (e) => <span className="capitalize">{formatearFechaLarga(e.periodo)}</span>,
    },
    {
      clave: "usos",
      label: "Usos del código",
      celda: (e) => <span className="tabular-nums">{e.usos_codigo ?? "—"}</span>,
    },
    {
      clave: "ventas",
      label: "Ventas",
      celda: (e) => (
        <span className="tabular-nums font-semibold">
          {e.ventas_monto != null ? formatearMXN(e.ventas_monto) : "—"}
        </span>
      ),
    },
    {
      clave: "contenido",
      label: "Contenido",
      celda: (e) => (
        <span className="text-muted-foreground">
          {e.videos ?? 0} videos · {e.stories ?? 0} stories
        </span>
      ),
    },
    {
      clave: "observaciones",
      label: "Observaciones",
      celda: (e) => (
        <span className="block truncate text-muted-foreground" title={e.observaciones ?? ""}>
          {e.observaciones ?? "—"}
        </span>
      ),
    },
    {
      clave: "acciones",
      label: "",
      celda: (e) => (
        <button
          type="button"
          onClick={() =>
            ejecutar(() => borrarEvaluacion(e.id), {
              confirmar: "¿Borrar esta evaluación?",
              ok: "Evaluación borrada.",
            })
          }
          className="text-muted-foreground hover:text-destructive"
          aria-label="Borrar evaluación"
        >
          <Trash2 className="size-4" />
        </button>
      ),
    },
  ];

  return (
    <TablaSimple
      cols="grid-cols-[minmax(180px,1.4fr)_140px_130px_130px_180px_1fr_60px]"
      columnas={columnas}
      datos={evaluaciones}
      filaKey={(e) => e.id}
      minW="min-w-[1000px]"
      vacio="Todavía no hay evaluaciones. Se registran desde la ficha de cada persona."
      onRowClick={(e) => onVerDetalle(e.influencer_id)}
    />
  );
}
