"use client";

import { Fragment } from "react";
import { mesCorto } from "@/lib/fecha";

/* Las pestañas de la hoja de Excel («FEBRERO», «MARZO»…) convertidas en una
   tira de pastillas: un toque recorta el panel entero a ese mes, el mismo
   toque (o «Todo») lo suelta. No es un dropdown a propósito: los meses se ven
   todos de un golpe, como se ven las pestañas en la hoja. */
export function FiltroMeses({
  meses,
  activo,
  onElegir,
}: {
  /* "AAAA-MM" ascendente, solo los meses que tienen fichas. */
  meses: string[];
  /* El mes elegido, o null cuando el rango no es exactamente un mes. */
  activo: string | null;
  onElegir: (ym: string | null) => void;
}) {
  /* Con un solo mes no hay nada que filtrar. */
  if (meses.length < 2) return null;

  return (
    <div
      className="mb-4 flex items-center gap-0.5 overflow-x-auto rounded-[14px] border bg-card p-1.5"
      role="group"
      aria-label="Filtrar por mes"
    >
      <PastillaMes activa={activo === null} onClick={() => onElegir(null)}>
        Todo
      </PastillaMes>
      {meses.map((ym, i) => {
        const anio = ym.slice(0, 4);
        const cambiaAnio = i === 0 || meses[i - 1].slice(0, 4) !== anio;
        return (
          <Fragment key={ym}>
            {/* El año se pinta una vez por grupo, como rótulo, y las pastillas
                quedan con el mes a secas: «2025 · Jul Ago … | 2026 · Ene Feb». */}
            {cambiaAnio && (
              <span className="shrink-0 select-none pl-2.5 pr-1 text-[10.5px] font-bold tracking-[0.08em] text-muted-foreground/60">
                {anio}
              </span>
            )}
            <PastillaMes activa={activo === ym} onClick={() => onElegir(activo === ym ? null : ym)}>
              {mesCorto(ym)}
            </PastillaMes>
          </Fragment>
        );
      })}
    </div>
  );
}

function PastillaMes({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={activa}
      onClick={onClick}
      className={`shrink-0 rounded-[9px] px-3 py-1.5 text-[13px] font-semibold transition-colors ${
        activa
          ? "bg-primary text-primary-foreground shadow-[0_5px_12px_-7px_rgba(232,67,147,0.8)]"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}
