import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/* Lista de barras horizontales en CSS puro (sin librería de gráficas):
   cada renglón muestra nombre, barra proporcional al máximo y valor.
   Los renglones en cero se atenúan (sirven para mostrar canales sin ventas). */
export function ListaBarras({
  items,
  formatear = (n) => String(n),
  vacio = "Sin datos en este periodo.",
  punto = false,
  altoBarra = 22,
  anchoEtiqueta = 130,
}: {
  items: { id: string; nombre: string; valor: number; color?: string; detalle?: string }[];
  formatear?: (n: number) => string;
  vacio?: string;
  punto?: boolean; // cuadrito de color junto al nombre
  altoBarra?: number;
  anchoEtiqueta?: number;
}) {
  if (items.length === 0) {
    return <p className="text-sm italic text-muted-foreground">{vacio}</p>;
  }
  const max = Math.max(...items.map((i) => i.valor), 1);

  return (
    <div className="flex flex-col gap-3.5">
      {items.map((i) => {
        const enCero = i.valor <= 0;
        const color = i.color ?? "var(--primary)";
        return (
          <div key={i.id} className="flex items-center gap-3.5 text-[13.5px]">
            {/* En móvil la etiqueta ocupa ~38% (deja aire a la barra); en
                escritorio usa el ancho fijo por prop. */}
            <span
              className={cn(
                "flex w-[38%] shrink-0 items-center gap-2 md:w-[var(--ancho-etiqueta)]",
                enCero ? "font-medium text-muted-foreground" : "font-semibold",
              )}
              style={{ "--ancho-etiqueta": `${anchoEtiqueta}px` } as CSSProperties}
              title={i.detalle ? `${i.nombre} · ${i.detalle}` : i.nombre}
            >
              {punto && (
                <span
                  className="size-2.5 shrink-0 rounded-[3px]"
                  style={{ backgroundColor: enCero ? "var(--border)" : color }}
                />
              )}
              <span className="truncate">{i.nombre}</span>
            </span>
            <div
              className="flex-1 overflow-hidden rounded-lg bg-muted"
              style={{ height: altoBarra }}
            >
              {!enCero && (
                <div
                  className="h-full rounded-lg"
                  style={{
                    width: `${Math.max(2, (i.valor / max) * 100)}%`,
                    backgroundColor: color,
                  }}
                />
              )}
            </div>
            <span
              className={cn(
                "min-w-[64px] shrink-0 whitespace-nowrap text-right tabular-nums md:min-w-[92px]",
                enCero ? "font-semibold text-muted-foreground" : "font-bold",
              )}
            >
              {formatear(i.valor)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
