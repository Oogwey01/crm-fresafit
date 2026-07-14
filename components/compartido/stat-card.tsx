import { cn } from "@/lib/utils";

/* Tarjeta de número grande para paneles (Métricas, Finanzas, Pedidos).
   `delta` es el % de cambio vs. el periodo anterior (null = sin comparativo). */
export function StatCard({
  etiqueta,
  valor,
  delta,
  deltaEtiqueta,
}: {
  etiqueta: string;
  valor: string;
  delta?: number | null;
  deltaEtiqueta?: string; // p. ej. "vs. mes pasado"
}) {
  const tieneDelta = delta !== undefined && delta !== null && Number.isFinite(delta);
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {etiqueta}
      </div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{valor}</div>
      {tieneDelta && (
        <div
          className={cn(
            "mt-0.5 text-xs font-semibold",
            delta! > 0 ? "text-green-600" : delta! < 0 ? "text-red-600" : "text-muted-foreground",
          )}
        >
          {delta! > 0 ? "▲" : delta! < 0 ? "▼" : "•"} {Math.abs(delta!).toFixed(0)}%
          {deltaEtiqueta && <span className="font-normal text-muted-foreground"> {deltaEtiqueta}</span>}
        </div>
      )}
    </div>
  );
}
