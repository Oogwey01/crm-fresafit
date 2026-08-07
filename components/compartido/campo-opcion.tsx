"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/* Elegir una opción de un catálogo CORTO (prioridad, estado, tipo de cobro…).

   En la computadora sigue siendo un Select: la caja mide 150px, se ve la lista
   completa al desplegar y no roba espacio a los campos vecinos. En el teléfono
   un Select son dos toques y una hoja que tapa media pantalla para escoger
   entre tres cosas; con el catálogo a la vista en pastillas se elige de un
   toque y se ve de reojo qué más había.

   El corte está en MAX_PASTILLAS: de ahí para arriba la parrilla se vuelve un
   muro (las 7 áreas ya ocupan tres renglones) y el Select vuelve a ganar. */
export const MAX_PASTILLAS = 6;

export type OpcionCatalogo<T extends string> = {
  readonly id: T;
  readonly nombre: string;
  readonly color?: string;
};

export function CampoOpcion<T extends string>({
  etiqueta,
  opciones,
  valor,
  onCambio,
  id,
  ayuda,
  className,
}: {
  etiqueta: string;
  opciones: readonly OpcionCatalogo<T>[];
  valor: T;
  onCambio: (v: T) => void;
  id?: string;
  /** Renglón de apoyo bajo el campo. */
  ayuda?: string;
  className?: string;
}) {
  const nombreDe = (v: string) => opciones.find((o) => o.id === v)?.nombre ?? etiqueta;
  const enPastillas = opciones.length <= MAX_PASTILLAS;

  const desplegable = (
    <Select value={valor} onValueChange={(v) => v && onCambio(v as T)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue>{(v: string) => nombreDe(v)}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {opciones.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <Label htmlFor={id}>{etiqueta}</Label>

      {enPastillas && (
        <div role="radiogroup" aria-label={etiqueta} className="flex flex-wrap gap-1.5 md:hidden">
          {/* La elegida se marca con el color del catálogo al 12% de fondo y el
              borde a tope (el mismo truco de <Pastilla>), no con el color a
              relleno: media docena de colores del catálogo son claros —el gris
              de "Por hacer", el ámbar de "Media"— y encima texto blanco no se
              lee. Así el texto siempre va sobre el fondo del tema. */}
          {opciones.map((o) => {
            const activo = o.id === valor;
            return (
              <button
                key={o.id}
                type="button"
                role="radio"
                aria-checked={activo}
                onClick={() => onCambio(o.id)}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border-2 px-3.5 py-1.5 text-[13px] transition-colors",
                  activo
                    ? "font-bold text-foreground"
                    : "border-border bg-card font-semibold text-muted-foreground",
                  activo && !o.color && "border-foreground bg-foreground/10",
                )}
                style={
                  activo && o.color
                    ? { backgroundColor: `${o.color}1F`, borderColor: o.color }
                    : undefined
                }
              >
                {o.color && (
                  <span
                    className="size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: o.color }}
                    aria-hidden="true"
                  />
                )}
                {o.nombre}
              </button>
            );
          })}
        </div>
      )}

      <div className={cn(enPastillas && "hidden md:block")}>{desplegable}</div>

      {ayuda && <span className="text-xs text-muted-foreground">{ayuda}</span>}
    </div>
  );
}
