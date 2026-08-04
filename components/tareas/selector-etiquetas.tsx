"use client";

import { useState } from "react";
import { etiquetasPorArea, obtenerArea } from "@/lib/catalogos";
import { cn } from "@/lib/utils";

/* Chips de etiquetas, ordenados por relevancia para el área de la tarea.

   El catálogo pasó de 7 etiquetas genéricas a una lista por área (diseño,
   contenido, tech, logística…), justo lo que pedía Armando. Para que crecer el
   catálogo no se traduzca en una parrilla ilegible, aquí se muestran primero las
   del área de la tarea más las transversales, y las demás quedan detrás de un
   «ver todas» — siguen disponibles, pero no estorban. */
export function SelectorEtiquetas({
  area,
  seleccionadas,
  onToggle,
  disabled = false,
}: {
  area: string;
  seleccionadas: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const [verTodas, setVerTodas] = useState(false);
  const { propias, generales, otras } = etiquetasPorArea(area);

  /* Una etiqueta de otra área ya puesta se sigue viendo aunque el bloque esté
     plegado: si no, parecería que se perdió al cambiar de área. */
  const otrasPuestas = otras.filter((e) => seleccionadas.includes(e.id));
  const visibles = verTodas ? [...propias, ...generales, ...otras] : [...propias, ...generales, ...otrasPuestas];

  const nombreArea = obtenerArea(area)?.nombre;

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1.5">
        {visibles.map((et) => {
          const on = seleccionadas.includes(et.id);
          return (
            <button
              key={et.id}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(et.id)}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors disabled:opacity-50",
                on ? "text-white" : "text-muted-foreground hover:bg-accent",
              )}
              style={on ? { backgroundColor: et.color, borderColor: et.color } : undefined}
            >
              {et.nombre}
            </button>
          );
        })}
      </div>
      {otras.length > 0 && (
        <button
          type="button"
          onClick={() => setVerTodas((v) => !v)}
          className="w-fit text-[11.5px] font-medium text-muted-foreground hover:text-foreground hover:underline"
        >
          {verTodas
            ? `Ver solo las de ${nombreArea ?? "esta área"}`
            : `Ver las ${otras.length} etiquetas de otras áreas`}
        </button>
      )}
    </div>
  );
}
