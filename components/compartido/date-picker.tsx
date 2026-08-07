"use client";

import { useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { matrizMes, nombreMes, hoyISO, formatearFecha, ahoraMX } from "@/lib/fecha";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/* Date-picker con la UI de la app: un botón que abre un calendario en popover.
   Reemplazo directo de <Input type="date">: value/onChange usan ISO "AAAA-MM-DD".
   Reutiliza matrizMes/nombreMes/hoyISO de lib/fecha.ts.

   Con `abiertoEnMovil` el calendario se pinta ya desplegado en el teléfono (y
   sigue siendo popover en la computadora): dentro de un diálogo por pasos la
   pantalla está prácticamente vacía, y hacer que la gente toque para abrir una
   capa encima de otra capa es un toque de más para nada. El mes visible vive en
   este componente, así que las dos ramas comparten estado. */
export function DatePicker({
  value,
  onChange,
  id,
  placeholder = "Elegir fecha",
  min,
  max,
  disabled,
  className,
  limpiable = false,
  abiertoEnMovil = false,
}: {
  value: string; // "AAAA-MM-DD" o ""
  onChange: (iso: string) => void;
  id?: string;
  placeholder?: string;
  min?: string; // ISO: días anteriores quedan deshabilitados
  max?: string; // ISO: días posteriores quedan deshabilitados
  disabled?: boolean;
  className?: string;
  limpiable?: boolean; // muestra una ✕ para vaciar la fecha
  abiertoEnMovil?: boolean; // calendario desplegado bajo md:
}) {
  const [open, setOpen] = useState(false);
  /* Mes visible: el de la fecha elegida, o el actual (anclado a México). */
  const [ym, setYm] = useState(() => {
    if (value) {
      const [a, m] = value.split("-").map(Number);
      if (a && m) return { anio: a, mes: m - 1 };
    }
    const d = ahoraMX();
    return { anio: d.getFullYear(), mes: d.getMonth() };
  });

  const hoy = hoyISO();
  const semanas = matrizMes(ym.anio, ym.mes);

  function cambiarMes(delta: number) {
    setYm((prev) => {
      const m = prev.mes + delta;
      return { anio: prev.anio + Math.floor(m / 12), mes: ((m % 12) + 12) % 12 };
    });
  }

  function elegir(iso: string) {
    onChange(iso);
    setOpen(false);
  }

  /* El calendario en sí. `grande` engorda las celdas y las flechas para el
     dedo cuando va desplegado a todo el ancho del teléfono. */
  const calendario = (grande: boolean) => (
    <>
      {/* Encabezado del mes */}
      <div className="mb-1.5 flex items-center justify-between gap-2 px-1">
        <button
          type="button"
          onClick={() => cambiarMes(-1)}
          className={cn(
            "rounded-md border hover:bg-accent",
            grande ? "flex size-9 items-center justify-center" : "p-1",
          )}
          aria-label="Mes anterior"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-bold">{nombreMes(ym.anio, ym.mes)}</span>
        <button
          type="button"
          onClick={() => cambiarMes(1)}
          className={cn(
            "rounded-md border hover:bg-accent",
            grande ? "flex size-9 items-center justify-center" : "p-1",
          )}
          aria-label="Mes siguiente"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      {/* Días de la semana */}
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold uppercase text-muted-foreground">
        {DIAS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Semanas */}
      {semanas.map((semana, i) => (
        <div key={i} className="grid grid-cols-7">
          {semana.map((celda) => {
            const seleccionada = celda.iso === value;
            const esHoy = celda.iso === hoy;
            const fueraRango = (min && celda.iso < min) || (max && celda.iso > max);
            return (
              <button
                key={celda.iso}
                type="button"
                disabled={!!fueraRango}
                onClick={() => elegir(celda.iso)}
                className={cn(
                  "m-0.5 flex items-center justify-center rounded-md transition-colors",
                  grande ? "h-10 text-sm" : "size-8 text-[13px]",
                  !celda.esDelMes && "text-muted-foreground/40",
                  !seleccionada && !fueraRango && "hover:bg-accent",
                  esHoy && !seleccionada && "font-bold text-primary",
                  seleccionada && "bg-primary font-semibold text-primary-foreground",
                  fueraRango && "cursor-not-allowed opacity-30",
                )}
              >
                {celda.dia}
              </button>
            );
          })}
        </div>
      ))}
    </>
  );

  const desplegado = (
    /* Sin `id` aquí: se queda en el disparador del popover para no duplicarlo en
       el DOM. En el teléfono no hay nada que enfocar — el calendario ya se ve. */
    <div className="md:hidden">
      <div className="rounded-xl border p-2">{calendario(true)}</div>
      {limpiable && value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="mt-1.5 ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
          Quitar fecha
        </button>
      )}
    </div>
  );

  const enPopover = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        disabled={disabled}
        className={cn(
          "flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-transparent px-2.5 text-left text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30 md:h-8",
          className,
        )}
      >
        <CalendarIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={cn("flex-1 truncate", !value && "text-muted-foreground")}>
          {value ? formatearFecha(value) : placeholder}
        </span>
        {limpiable && value && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Quitar fecha"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" />
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-2">{calendario(false)}</PopoverContent>
    </Popover>
  );

  if (!abiertoEnMovil) return enPopover;

  return (
    <>
      {desplegado}
      <div className="hidden md:block">{enPopover}</div>
    </>
  );
}
