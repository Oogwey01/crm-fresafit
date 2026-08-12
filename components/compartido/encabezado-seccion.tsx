import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Título de una pestaña o bloque con la línea que explica para qué sirve.
   Extraído de la copia local que tenía components/maquila/insumos.tsx: las
   secciones de un módulo se explican solas o el equipo pregunta por WhatsApp.

   Distinto de components/compartido/seccion.tsx, que es un rótulo uppercase con
   separador para agrupar campos dentro de una ficha. Éste encabeza una vista. */
export function EncabezadoSeccion({
  titulo,
  children,
  className,
}: {
  titulo: string;
  /* La explicación. Admite <b> y demás para resaltar la regla que importa. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-3", className)}>
      <h2 className="mb-1 text-[15px] font-semibold">{titulo}</h2>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}
