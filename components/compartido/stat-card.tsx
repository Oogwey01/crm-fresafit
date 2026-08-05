import { ArrowDown, ArrowUp, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* Tarjeta de número grande para paneles (Inventario, Métricas, Finanzas, Pedidos).
   `delta` es el % de cambio vs. el periodo anterior (null = sin comparativo);
   cuando no hay comparativo se puede usar `nota` como pie explicativo. */
export function StatCard({
  etiqueta,
  valor,
  delta,
  deltaEtiqueta,
  nota,
  notaClassName,
  icono: Icono,
  valorClassName,
  className,
}: {
  etiqueta: string;
  valor: string;
  delta?: number | null;
  deltaEtiqueta?: string; // p. ej. "vs. mes pasado"
  nota?: string; // p. ej. "por transacción"
  /* Para esconder el pie donde no cabe (en el teléfono, con tres tarjetas por
     renglón, una nota de cinco palabras ocupa más que la propia cifra). */
  notaClassName?: string;
  icono?: LucideIcon;
  valorClassName?: string;
  className?: string;
}) {
  const tieneDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const sube = tieneDelta && delta! > 0;
  const baja = tieneDelta && delta! < 0;

  return (
    /* En el teléfono van de dos en dos: con el relleno y los tamaños de
       escritorio, media pantalla de tarjeta enseñaba una cifra recortada rodeada
       de aire. Aquí se aprieta el relleno, se baja el cuerpo del número y se
       juntan los renglones; de md en adelante queda exactamente como estaba. */
    <div
      className={cn(
        "min-w-0 overflow-hidden rounded-2xl border bg-card px-3.5 py-3 shadow-sm md:px-5 md:py-4",
        className,
      )}
    >
      <div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground md:text-[11px] md:tracking-wider">
        {Icono && <Icono className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden="true" />}
        <span className="min-w-0 leading-tight">{etiqueta}</span>
      </div>
      <div
        className={cn(
          "mt-1.5 truncate text-[21px] font-bold leading-none tracking-tight tabular-nums md:mt-2.5 md:text-[29px]",
          valorClassName,
        )}
        title={valor}
      >
        {valor}
      </div>
      {tieneDelta ? (
        <div
          className={cn(
            "mt-1.5 flex flex-wrap items-center gap-x-1.5 text-[12px] font-semibold md:mt-2.5 md:text-[12.5px]",
            sube ? "text-green-600" : baja ? "text-red-600" : "text-muted-foreground",
          )}
        >
          {sube ? (
            <ArrowUp className="size-3.5 shrink-0" strokeWidth={2.4} aria-hidden="true" />
          ) : baja ? (
            <ArrowDown className="size-3.5 shrink-0" strokeWidth={2.4} aria-hidden="true" />
          ) : null}
          {Math.abs(delta!).toFixed(0)}%
          {deltaEtiqueta && (
            <span className="min-w-0 font-medium text-muted-foreground">{deltaEtiqueta}</span>
          )}
        </div>
      ) : nota ? (
        <div
          className={cn(
            "mt-1.5 text-[11.5px] font-medium leading-snug text-muted-foreground md:mt-2.5 md:text-[12.5px]",
            notaClassName,
          )}
        >
          {nota}
        </div>
      ) : null}
    </div>
  );
}
