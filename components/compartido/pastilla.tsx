import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/* Pastilla de color de un catálogo (canal, estado, área…): fondo al 12% de
   opacidad (sufijo hex "1F") y texto al 100%. El truco del `1F` estaba copiado
   en ~10 componentes. */
export function Pastilla({
  nombre,
  color,
  className,
  style,
}: {
  nombre: string;
  color: string;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold",
        className,
      )}
      style={{ backgroundColor: `${color}1F`, color, ...style }}
    >
      {nombre}
    </span>
  );
}
