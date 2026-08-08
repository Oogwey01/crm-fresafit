"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/* Sección que se pliega, con contador en el encabezado. Nació en el detalle de
   tarea (subtareas + enlaces + adjuntos + comentarios + historial eran varias
   pantallas de scroll en el teléfono) y se promovió aquí para los formularios.

   Por defecto se comporta como allá: pliega SOLO en móvil y de md: en adelante
   el contenido queda siempre abierto y el chevron desaparece. Con
   `plegableEnEscritorio` también colapsa en la computadora — así los bloques
   opcionales de un formulario (comprobantes, renglones, presentaciones) nacen
   cerrados y el diálogo se queda corto.

   El plegado usa el mismo grid 0fr→1fr que la vista móvil del tablero. */
export function SeccionPlegable({
  titulo,
  contador,
  sufijoEscritorio,
  abiertaPorDefecto = false,
  plegableEnEscritorio = false,
  className,
  children,
}: {
  titulo: string;
  contador?: string | number | null;
  /* Lo que en el teléfono va como pastilla, en escritorio se sigue leyendo
     dentro del propio encabezado (así estaba «Subtareas (2/5)»). */
  sufijoEscritorio?: string | null;
  abiertaPorDefecto?: boolean;
  /** true ⇒ el encabezado también responde al clic de md: en adelante. */
  plegableEnEscritorio?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto);
  return (
    <div className={cn("mt-4 border-t pt-3", className)}>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className={cn(
          "flex w-full items-center gap-2 py-1 text-left",
          !plegableEnEscritorio && "md:pointer-events-none md:mb-2 md:py-0",
        )}
      >
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {titulo}
          {sufijoEscritorio && <span className="hidden md:inline"> {sufijoEscritorio}</span>}
        </h3>
        {contador != null && (
          <span
            className={cn(
              "rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground",
              !plegableEnEscritorio && "md:hidden",
            )}
          >
            {contador}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
            !plegableEnEscritorio && "md:hidden",
            !abierta && "-rotate-90",
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200",
          !plegableEnEscritorio && "md:grid-rows-[1fr]",
          abierta ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
