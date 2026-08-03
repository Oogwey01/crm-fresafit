"use client";

import { cn } from "@/lib/utils";

/* Control segmentado (grupo de botones exclusivos sobre fondo muted), como los
   de alcance/vista/eje del tablero de tareas y el de pestañas de inventario.
   Era el mismo markup copiado 4 veces. */
export function ControlSegmentado<T extends string>({
  opciones,
  valor,
  onCambio,
  className,
  botonClassName,
}: {
  opciones: readonly (readonly [T, string])[];
  valor: T;
  onCambio: (v: T) => void;
  className?: string;
  botonClassName?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-lg bg-muted p-0.5", className)}>
      {opciones.map(([id, label]) => (
        <button
          key={id}
          type="button"
          onClick={() => onCambio(id)}
          className={cn(
            "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
            valor === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
            botonClassName,
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
