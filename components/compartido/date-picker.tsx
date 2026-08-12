"use client";

import { useEffect, useRef, useState } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from "lucide-react";
import { matrizMes, nombreMes, hoyISO, formatearFecha, ahoraMX, textoFechaHora } from "@/lib/fecha";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const DIAS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/* El calendario en sí, sin disparador: lo comparten DatePicker (abajo) y el
   popover de PastillaFecha. `grande` engorda las celdas y las flechas para el
   dedo cuando va desplegado a todo el ancho del teléfono. El mes visible vive
   aquí y arranca en el de la fecha elegida, o en el actual (anclado a México). */
export function Calendario({
  valor,
  onCambio,
  min,
  max,
  grande = false,
}: {
  valor: string; // "AAAA-MM-DD" o ""
  onCambio: (iso: string) => void;
  min?: string; // ISO: días anteriores quedan deshabilitados
  max?: string; // ISO: días posteriores quedan deshabilitados
  grande?: boolean;
}) {
  const [ym, setYm] = useState(() => {
    if (valor) {
      const [a, m] = valor.split("-").map(Number);
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

  return (
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
            const seleccionada = celda.iso === valor;
            const esHoy = celda.iso === hoy;
            const fueraRango = (min && celda.iso < min) || (max && celda.iso > max);
            return (
              <button
                key={celda.iso}
                type="button"
                disabled={!!fueraRango}
                onClick={() => onCambio(celda.iso)}
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
}

/* Date-picker con la UI de la app: un botón que abre un calendario en popover.
   Reemplazo directo de <Input type="date">: value/onChange usan ISO "AAAA-MM-DD".
   Reutiliza matrizMes/nombreMes/hoyISO de lib/fecha.ts.

   Con `abiertoEnMovil` el calendario se pinta ya desplegado en el teléfono (y
   sigue siendo popover en la computadora): dentro de un diálogo por pasos la
   pantalla está prácticamente vacía, y hacer que la gente toque para abrir una
   capa encima de otra capa es un toque de más para nada. */
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

  function elegir(iso: string) {
    onChange(iso);
    setOpen(false);
  }

  const desplegado = (
    /* Sin `id` aquí: se queda en el disparador del popover para no duplicarlo en
       el DOM. En el teléfono no hay nada que enfocar — el calendario ya se ve. */
    <div className="md:hidden">
      <div className="rounded-xl border p-2">
        <Calendario valor={value} onCambio={onChange} min={min} max={max} grande />
      </div>
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
      <PopoverContent className="w-auto p-2">
        <Calendario valor={value} onCambio={elegir} min={min} max={max} />
      </PopoverContent>
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

/* ── Fecha Y hora (recordatorios, eventos agendados) ─────────────────────── */

const HORAS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0"));
const MINUTOS = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, "0"));

/* La hora con la que arranca un aviso nuevo: la próxima en punto si es para hoy
   (un aviso de hoy a las 09:00 con la tarde encima ya no avisa nada) y 09:00
   para cualquier otro día. Solo la hora, "HH". */
function horaSugerida(fecha: string): string {
  if (fecha && fecha !== hoyISO()) return "09";
  return String(Math.min(ahoraMX().getHours() + 1, 23)).padStart(2, "0");
}

/* Columna scrolleable de horas o minutos, como las del selector nativo pero
   con la UI de la app. */
function ColumnaTiempo({
  etiqueta,
  opciones,
  valor,
  centro,
  onElegir,
  grande = false,
}: {
  etiqueta: string;
  opciones: readonly string[];
  valor: string; // "HH" o "mm"; "" mientras no se elige
  /** Dónde queda el scroll al abrir si aún no hay valor (la hora sugerida). */
  centro: string;
  onElegir: (v: string) => void;
  grande?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  /* Al abrir, lo elegido (o lo sugerido) queda a media columna. Solo al montar:
     re-centrar en cada clic pelearía con el scroll del dedo. */
  useEffect(() => {
    const cont = ref.current;
    const objetivo = cont?.querySelector<HTMLElement>("[data-centrar]");
    if (cont && objetivo) {
      cont.scrollTop = objetivo.offsetTop - cont.clientHeight / 2 + objetivo.clientHeight / 2;
    }
  }, []);

  return (
    <div className={cn("flex flex-col", grande ? "min-w-0 flex-1" : "w-14")}>
      <span className="pb-1 text-center text-[11px] font-semibold uppercase text-muted-foreground">
        {etiqueta}
      </span>
      {/* Altura FIJA: si la columna crece con sus 24 opciones, estira el popover
          entero a lo alto de la pantalla. h-64 ≈ la altura del calendario. */}
      <div
        ref={ref}
        className={cn(
          "relative flex flex-col overflow-y-auto rounded-lg border p-1",
          grande ? "h-40" : "h-64",
        )}
      >
        {opciones.map((o) => (
          <button
            key={o}
            type="button"
            data-centrar={o === (valor || centro) ? "" : undefined}
            onClick={() => onElegir(o)}
            className={cn(
              "shrink-0 rounded-md text-center tabular-nums transition-colors",
              grande ? "py-2 text-sm" : "py-1 text-[13px]",
              o === valor
                ? "bg-primary font-semibold text-primary-foreground"
                : "hover:bg-accent",
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

/* El control completo de fecha y hora: el calendario de la app con las columnas
   de hora y minutos al lado (o abajo, en `grande`). Reemplazo del
   <input type="datetime-local">: value/onChange usan "AAAA-MM-DDTHH:mm", así
   que localInputAIso/isoALocalInput siguen haciendo el puente con la BD. */
export function SelectorFechaHora({
  valor,
  onCambio,
  grande = false,
  limpiable = false,
  onListo,
}: {
  valor: string; // "AAAA-MM-DDTHH:mm" o ""
  onCambio: (v: string) => void;
  grande?: boolean;
  limpiable?: boolean; // botón "Quitar" cuando hay valor
  /** Pinta el botón "Listo"; se llama al terminar (para cerrar el popover). */
  onListo?: () => void;
}) {
  const [fecha = "", hora = ""] = valor.split("T");
  const [hh = "", mm = ""] = hora.split(":");

  /* Cada mitad rellena a la otra con algo sensato: un solo clic ya deja un
     valor completo, porque el aviso necesita fecha Y hora sí o sí. */
  function elegirFecha(iso: string) {
    onCambio(`${iso}T${hh || horaSugerida(iso)}:${mm || "00"}`);
  }
  function elegirHora(h: string) {
    onCambio(`${fecha || hoyISO()}T${h}:${mm || "00"}`);
  }
  function elegirMinuto(m: string) {
    const f = fecha || hoyISO();
    onCambio(`${f}T${hh || horaSugerida(f)}:${m}`);
  }

  /* Un valor con minutos fuera de la rejilla de 5 (un aviso viejo que se está
     editando) se cuela en su lugar para no perderse. */
  const minutos = mm && !MINUTOS.includes(mm) ? [...MINUTOS, mm].sort() : MINUTOS;

  const columnas = (
    <>
      <ColumnaTiempo
        etiqueta="Hora"
        opciones={HORAS}
        valor={hh}
        centro={horaSugerida(fecha || hoyISO())}
        onElegir={elegirHora}
        grande={grande}
      />
      <ColumnaTiempo
        etiqueta="Min"
        opciones={minutos}
        valor={mm}
        centro="00"
        onElegir={elegirMinuto}
        grande={grande}
      />
    </>
  );

  return (
    <div className="flex flex-col">
      {grande ? (
        <>
          <div className="rounded-xl border p-2">
            <Calendario valor={fecha} onCambio={elegirFecha} grande />
          </div>
          <div className="mt-2 flex gap-2">{columnas}</div>
        </>
      ) : (
        <div className="flex items-start gap-2">
          <div className="shrink-0">
            <Calendario valor={fecha} onCambio={elegirFecha} />
          </div>
          {columnas}
        </div>
      )}

      {((limpiable && valor) || onListo) && (
        <div className="mt-1.5 flex items-center justify-between gap-2">
          {limpiable && valor ? (
            <button
              type="button"
              onClick={() => {
                onCambio("");
                onListo?.();
              }}
              className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" aria-hidden="true" />
              Quitar
            </button>
          ) : (
            <span />
          )}
          {onListo && (
            <button
              type="button"
              onClick={onListo}
              className="rounded-lg bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Listo
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* Reemplazo directo de <Input type="datetime-local"> con la UI de la app: un
   botón que abre el SelectorFechaHora en popover, hermano del DatePicker. */
export function DateTimePicker({
  value,
  onChange,
  id,
  placeholder = "Elegir fecha y hora",
  disabled,
  className,
  limpiable = false,
}: {
  value: string; // "AAAA-MM-DDTHH:mm" o ""
  onChange: (v: string) => void;
  id?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  limpiable?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
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
          {value ? textoFechaHora(value) : placeholder}
        </span>
        {limpiable && value && (
          <span
            role="button"
            tabIndex={-1}
            aria-label="Quitar fecha y hora"
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
      <PopoverContent className="w-auto p-2">
        <SelectorFechaHora
          valor={value}
          onCambio={onChange}
          limpiable={limpiable}
          onListo={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}
