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
  icono: Icono,
  valorClassName,
  className,
}: {
  etiqueta: string;
  valor: string;
  delta?: number | null;
  deltaEtiqueta?: string; // p. ej. "vs. mes pasado"
  nota?: string; // p. ej. "por transacción"
  icono?: LucideIcon;
  valorClassName?: string;
  className?: string;
}) {
  const tieneDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  const sube = tieneDelta && delta! > 0;
  const baja = tieneDelta && delta! < 0;

  return (
    <div className={cn("min-w-0 rounded-2xl border bg-card px-5 py-4 shadow-sm", className)}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {Icono && <Icono className="size-3.5" strokeWidth={1.9} aria-hidden="true" />}
        {etiqueta}
      </div>
      <div
        className={cn(
          "mt-2.5 truncate text-2xl font-bold leading-none tracking-tight tabular-nums md:text-[29px]",
          valorClassName,
        )}
        title={valor}
      >
        {valor}
      </div>
      {tieneDelta ? (
        <div
          className={cn(
            "mt-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold",
            sube ? "text-green-600" : baja ? "text-red-600" : "text-muted-foreground",
          )}
        >
          {sube ? (
            <ArrowUp className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
          ) : baja ? (
            <ArrowDown className="size-3.5" strokeWidth={2.4} aria-hidden="true" />
          ) : null}
          {Math.abs(delta!).toFixed(0)}%
          {deltaEtiqueta && <span className="font-medium text-muted-foreground">{deltaEtiqueta}</span>}
        </div>
      ) : nota ? (
        <div className="mt-2.5 text-[12.5px] font-medium text-muted-foreground">{nota}</div>
      ) : null}
    </div>
  );
}
