"use client";

import { useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import {
  ahoraMX,
  formatearFecha,
  hoyISO,
  matrizMes,
  nombreMes,
  PRESETS_RANGO,
  rangosDePeriodo,
  type PresetRangoId,
} from "@/lib/fecha";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];

/* Selector de RANGO de fechas, al estilo de las apps de vuelos: se elige el
   inicio y el fin en el mismo calendario, con dos meses a la vista y una
   columna de atajos.

   Antes eran dos DatePicker sueltos ("Del …" / "al …") acoplados con min/max,
   que es justo lo que a Armando le causaba ruido: había que abrir dos
   calendarios distintos para expresar un solo rango.

   Reutiliza matrizMes/nombreMes/ahoraMX de lib/fecha.ts, igual que el
   DatePicker de fecha única — sin librerías nuevas. */
export function RangoFechas({
  desde,
  hasta,
  onChange,
  /* Preset activo, si lo hay: se resalta en la columna de atajos. "" = rango a
     mano. El padre lo mantiene para poder rotular el periodo y su comparativo. */
  preset = "",
  onPreset,
  className,
  max = hoyISO(),
}: {
  desde: string; // "AAAA-MM-DD"
  hasta: string;
  onChange: (desde: string, hasta: string) => void;
  preset?: PresetRangoId | "";
  onPreset?: (id: PresetRangoId) => void;
  className?: string;
  max?: string; // por defecto hoy: no tiene sentido pedir ventas del futuro
}) {
  const [open, setOpen] = useState(false);
  /* Mientras se elige: se guarda el primer clic y el día bajo el cursor, para
     poder pintar el tramo en curso antes de cerrar. */
  const [anclaje, setAnclaje] = useState<string | null>(null);
  const [encima, setEncima] = useState<string | null>(null);

  /* Mes izquierdo (el derecho es el siguiente). Arranca en el mes del `desde`. */
  const [ym, setYm] = useState(() => {
    const base = desde || hoyISO();
    const [a, m] = base.split("-").map(Number);
    if (a && m) return { anio: a, mes: m - 1 };
    const d = ahoraMX();
    return { anio: d.getFullYear(), mes: d.getMonth() };
  });

  function cambiarMes(delta: number) {
    setYm((prev) => {
      const m = prev.mes + delta;
      return { anio: prev.anio + Math.floor(m / 12), mes: ((m % 12) + 12) % 12 };
    });
  }

  /* Extremos de la selección en curso (o del rango ya fijado). */
  const [ini, fin] = anclaje
    ? [anclaje, encima ?? anclaje].sort()
    : [desde, hasta].sort();

  function elegir(iso: string) {
    if (!anclaje) {
      setAnclaje(iso);
      setEncima(iso);
      return;
    }
    /* Segundo clic: se ordenan solos, así da igual si empiezan por el final. */
    const [a, b] = [anclaje, iso].sort();
    setAnclaje(null);
    setEncima(null);
    onChange(a, b);
    setOpen(false);
  }

  function aplicarPreset(id: PresetRangoId) {
    const { actual } = rangosDePeriodo(id);
    setAnclaje(null);
    setEncima(null);
    onPreset?.(id);
    onChange(actual.desde, actual.hasta);
    setOpen(false);
  }

  const etiquetaPreset = PRESETS_RANGO.find((p) => p.id === preset)?.nombre;
  const etiqueta = etiquetaPreset
    ? etiquetaPreset
    : desde && hasta
      ? desde === hasta
        ? formatearFecha(desde)
        : `${formatearFecha(desde)} – ${formatearFecha(hasta)}`
      : "Elegir fechas";

  function pintarMes(anio: number, mes: number) {
    const semanas = matrizMes(anio, mes);
    const hoy = hoyISO();
    return (
      <div>
        <div className="mb-1.5 text-center text-sm font-bold">{nombreMes(anio, mes)}</div>
        <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-muted-foreground">
          {DIAS.map((d, i) => (
            <div key={i} className="py-1">
              {d}
            </div>
          ))}
        </div>
        {semanas.map((semana, i) => (
          <div key={i} className="grid grid-cols-7">
            {semana.map((celda) => {
              const fueraRango = max && celda.iso > max;
              const esIni = celda.iso === ini;
              const esFin = celda.iso === fin;
              const dentro = !!ini && !!fin && celda.iso > ini && celda.iso < fin;
              const extremo = esIni || esFin;
              return (
                <button
                  key={celda.iso}
                  type="button"
                  disabled={!!fueraRango}
                  onClick={() => elegir(celda.iso)}
                  onMouseEnter={() => anclaje && setEncima(celda.iso)}
                  className={cn(
                    "relative m-0 flex h-8 items-center justify-center text-[13px] transition-colors",
                    !celda.esDelMes && "text-muted-foreground/40",
                    dentro && "bg-primary/15",
                    /* Los extremos redondean solo por su lado, para que el tramo
                       se lea como una barra continua. */
                    esIni && !esFin && "rounded-l-md bg-primary font-semibold text-primary-foreground",
                    esFin && !esIni && "rounded-r-md bg-primary font-semibold text-primary-foreground",
                    esIni && esFin && "rounded-md bg-primary font-semibold text-primary-foreground",
                    !extremo && !dentro && !fueraRango && "rounded-md hover:bg-accent",
                    celda.iso === hoy && !extremo && "font-bold text-primary",
                    fueraRango && "cursor-not-allowed opacity-30",
                  )}
                >
                  {celda.dia}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  const siguiente = ym.mes === 11 ? { anio: ym.anio + 1, mes: 0 } : { anio: ym.anio, mes: ym.mes + 1 };

  return (
    <Popover
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          // Cerrar a media selección no debe dejar un rango incompleto.
          setAnclaje(null);
          setEncima(null);
        }
      }}
    >
      <PopoverTrigger
        className={cn(
          "flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-2.5 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:h-8",
          className,
        )}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="truncate">{etiqueta}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <div className="flex flex-col sm:flex-row">
          {/* Atajos */}
          <div className="flex shrink-0 flex-row flex-wrap gap-1 border-b p-2 sm:w-40 sm:flex-col sm:flex-nowrap sm:border-b-0 sm:border-r">
            {PRESETS_RANGO.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => aplicarPreset(p.id)}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-accent",
                  preset === p.id && "bg-primary/10 font-semibold text-primary",
                )}
              >
                {p.nombre}
              </button>
            ))}
          </div>

          {/* Calendario: dos meses en escritorio, uno en móvil */}
          <div className="p-2">
            <div className="mb-1 flex items-center justify-between gap-2 px-1">
              <button
                type="button"
                onClick={() => cambiarMes(-1)}
                className="rounded-md border p-1 hover:bg-accent"
                aria-label="Mes anterior"
              >
                <ChevronLeft className="size-4" />
              </button>
              <span className="text-xs text-muted-foreground">
                {anclaje ? "Elige la fecha final" : "Elige la fecha inicial"}
              </span>
              <button
                type="button"
                onClick={() => cambiarMes(1)}
                className="rounded-md border p-1 hover:bg-accent"
                aria-label="Mes siguiente"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
            <div className="flex gap-4">
              <div className="w-[224px]">{pintarMes(ym.anio, ym.mes)}</div>
              <div className="hidden w-[224px] sm:block">
                {pintarMes(siguiente.anio, siguiente.mes)}
              </div>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
