"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { obtenerEstado } from "@/lib/catalogos";
import { matrizMes, nombreMes, hoyISO, esVencida } from "@/lib/fecha";
import type { TaskConResponsable } from "@/lib/types";
import { cn } from "@/lib/utils";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

export function VistaCalendario({
  tareas,
  onAbrir,
}: {
  tareas: TaskConResponsable[];
  onAbrir: (t: TaskConResponsable) => void;
}) {
  const [ym, setYm] = useState(() => {
    const d = new Date();
    return { anio: d.getFullYear(), mes: d.getMonth() };
  });

  const hoy = hoyISO();
  const semanas = matrizMes(ym.anio, ym.mes);

  // Tareas por día (fecha límite) y las que no tienen fecha.
  const porDia = new Map<string, TaskConResponsable[]>();
  const sinFecha: TaskConResponsable[] = [];
  for (const t of tareas) {
    if (!t.fecha_limite) {
      sinFecha.push(t);
      continue;
    }
    const dia = t.fecha_limite.slice(0, 10);
    if (!porDia.has(dia)) porDia.set(dia, []);
    porDia.get(dia)!.push(t);
  }

  function cambiarMes(delta: number) {
    setYm((prev) => {
      const m = prev.mes + delta;
      const anio = prev.anio + Math.floor(m / 12);
      const mes = ((m % 12) + 12) % 12;
      return { anio, mes };
    });
  }

  function Chip({ t }: { t: TaskConResponsable }) {
    const e = obtenerEstado(t.estado);
    const vencida = esVencida(t.fecha_limite, t.estado);
    return (
      <button
        type="button"
        onClick={() => onAbrir(t)}
        title={t.titulo}
        className={cn(
          "block w-full truncate rounded px-1 py-0.5 text-left text-[11px] font-medium text-white",
          vencida && "ring-1 ring-red-500",
        )}
        style={{ backgroundColor: e?.color ?? "#94a3b8" }}
      >
        {t.titulo}
      </button>
    );
  }

  return (
    <div>
      {/* Encabezado del mes */}
      <div className="mb-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => cambiarMes(-1)}
          className="rounded-md border p-1.5 hover:bg-accent"
          aria-label="Mes anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-40 text-center text-sm font-bold">{nombreMes(ym.anio, ym.mes)}</span>
        <button
          type="button"
          onClick={() => cambiarMes(1)}
          className="rounded-md border p-1.5 hover:bg-accent"
          aria-label="Mes siguiente"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[720px] rounded-lg border">
          {/* Días de la semana */}
          <div className="grid grid-cols-7 border-b bg-muted/40 text-center text-xs font-bold uppercase text-muted-foreground">
            {DIAS.map((d) => (
              <div key={d} className="py-1.5">
                {d}
              </div>
            ))}
          </div>

          {/* Semanas */}
          {semanas.map((semana, i) => (
            <div key={i} className="grid grid-cols-7">
              {semana.map((celda) => {
                const items = porDia.get(celda.iso) ?? [];
                const esHoy = celda.iso === hoy;
                return (
                  <div
                    key={celda.iso}
                    className={cn(
                      "min-h-24 border-r border-b p-1 last:border-r-0",
                      !celda.esDelMes && "bg-muted/30",
                      esHoy && "bg-primary/5",
                    )}
                  >
                    <div
                      className={cn(
                        "mb-1 text-right text-xs",
                        !celda.esDelMes ? "text-muted-foreground/50" : "text-muted-foreground",
                        esHoy && "font-bold text-primary",
                      )}
                    >
                      {celda.dia}
                    </div>
                    <div className="flex flex-col gap-1">
                      {items.slice(0, 3).map((t) => (
                        <Chip key={t.id} t={t} />
                      ))}
                      {items.length > 3 && (
                        <span className="px-1 text-[10px] text-muted-foreground">
                          +{items.length - 3} más
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Tareas sin fecha */}
      {sinFecha.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Sin fecha ({sinFecha.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {sinFecha.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onAbrir(t)}
                title={t.titulo}
                className="max-w-56 truncate rounded-md border bg-card px-2 py-1 text-xs hover:bg-accent"
              >
                {t.titulo}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
