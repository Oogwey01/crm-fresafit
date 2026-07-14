/* Lista de barras horizontales en CSS puro (sin librería de gráficas):
   cada renglón muestra nombre, barra proporcional al máximo y valor. */
export function ListaBarras({
  items,
  formatear = (n) => String(n),
  vacio = "Sin datos en este periodo.",
}: {
  items: { id: string; nombre: string; valor: number; color?: string; detalle?: string }[];
  formatear?: (n: number) => string;
  vacio?: string;
}) {
  if (items.length === 0) {
    return <p className="text-sm italic text-muted-foreground">{vacio}</p>;
  }
  const max = Math.max(...items.map((i) => i.valor), 1);
  return (
    <div className="flex flex-col gap-2">
      {items.map((i) => (
        <div key={i.id} className="grid grid-cols-[minmax(110px,1fr)_2fr_auto] items-center gap-2 text-sm">
          <div className="truncate" title={i.detalle ?? i.nombre}>
            {i.nombre}
          </div>
          <div className="h-4 overflow-hidden rounded bg-muted">
            <div
              className="h-full rounded"
              style={{
                width: `${Math.max(2, (i.valor / max) * 100)}%`,
                backgroundColor: i.color ?? "var(--primary)",
              }}
            />
          </div>
          <div className="text-right font-semibold tabular-nums">{formatear(i.valor)}</div>
        </div>
      ))}
    </div>
  );
}
