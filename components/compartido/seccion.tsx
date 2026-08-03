import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Sección con rótulo uppercase y separador superior, como la usaban (cada uno
   con su copia local) producto-vista y task-detail. Las diferencias de estilo
   que habían divergido se preservan vía className. */
export function Seccion({
  titulo,
  children,
  className,
  tituloClassName,
}: {
  titulo: string;
  children: ReactNode;
  className?: string;
  tituloClassName?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2 border-t pt-3", className)}>
      <span
        className={cn(
          "text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
          tituloClassName,
        )}
      >
        {titulo}
      </span>
      {children}
    </div>
  );
}
