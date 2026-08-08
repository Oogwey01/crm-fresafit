import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/* El campo de toda la vida: Label arriba, control abajo, renglón de ayuda o de
   error al final. Era el mismo `div.flex.flex-col.gap-1.5` copiado a mano en
   cada diálogo; tenerlo con nombre permite que "(opcional)" y los errores se
   escriban igual en todos lados. */
export function Campo({
  etiqueta,
  htmlFor,
  opcional = false,
  ayuda,
  error,
  className,
  children,
}: {
  etiqueta: string;
  htmlFor?: string;
  /** Añade "(opcional)" al label, en gris para no competir con el nombre. */
  opcional?: boolean;
  /** Renglón de apoyo bajo el control. */
  ayuda?: string;
  /** Qué falta, en cristiano. Sustituye a la ayuda mientras esté presente. */
  error?: string | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={htmlFor}>
        {etiqueta}
        {opcional && (
          <span className="font-normal text-muted-foreground">(opcional)</span>
        )}
      </Label>
      {children}
      {error ? (
        <span className="text-xs font-medium text-destructive">{error}</span>
      ) : (
        ayuda && <span className="text-xs text-muted-foreground">{ayuda}</span>
      )}
    </div>
  );
}
