"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/* Los campos protagonistas de un formulario (el título de la tarea, el
   concepto del gasto): un input sin caja ni label, grande, como escribir sobre
   la hoja. El placeholder hace de pregunta ("¿Qué hay que hacer?") y el
   contexto lo da el título del diálogo o del paso; el nombre del campo viaja en
   aria-label para el lector de pantalla.

   Sin autoFocus a propósito: el initialFocus de Base UI ya evita enfocar cuando
   el diálogo se abrió por toque, y así el teclado no salta encima de la
   pantalla completa del teléfono. */
export function CampoHero({
  valor,
  onCambio,
  placeholder,
  etiqueta,
  id,
  error,
  className,
}: {
  valor: string;
  onCambio: (v: string) => void;
  placeholder: string;
  /** Nombre del campo para accesibilidad: "Título". */
  etiqueta: string;
  id?: string;
  error?: string | null;
  className?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <input
        id={id}
        aria-label={etiqueta}
        aria-invalid={error ? true : undefined}
        placeholder={placeholder}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className={cn(
          "w-full border-0 bg-transparent px-0 font-heading text-lg font-semibold outline-none",
          "placeholder:text-muted-foreground/50 md:text-xl",
          className,
        )}
      />
      {error && <span className="text-xs font-medium text-destructive">{error}</span>}
    </div>
  );
}

/* La pareja del hero: texto libre secundario (descripción, notas) también sin
   caja. Crece solo con el contenido para que dos renglones no naveguen dentro
   de una cajita con scroll propio. */
export function DescripcionHero({
  valor,
  onCambio,
  placeholder = "Detalles, contexto…",
  etiqueta,
  id,
  rows = 2,
  className,
}: {
  valor: string;
  onCambio: (v: string) => void;
  placeholder?: string;
  /** Nombre del campo para accesibilidad: "Descripción". */
  etiqueta: string;
  id?: string;
  rows?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLTextAreaElement>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [valor]);

  return (
    <textarea
      ref={ref}
      id={id}
      aria-label={etiqueta}
      placeholder={placeholder}
      value={valor}
      rows={rows}
      onChange={(e) => onCambio(e.target.value)}
      className={cn(
        "w-full resize-none border-0 bg-transparent px-0 text-sm outline-none",
        "placeholder:text-muted-foreground/50",
        className,
      )}
    />
  );
}
