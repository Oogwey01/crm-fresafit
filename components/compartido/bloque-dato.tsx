import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/* Tarjeta con rótulo y pie explicativo, y el dato suelto que va dentro. Nacieron
   en el bloque "las plataformas por dentro" de Métricas y los usan también las
   páginas de Canales: son la forma de presentar un número que necesita contexto
   para no malinterpretarse (una tasa, un conteo de casos, un monto en juego). */
export function Bloque({
  titulo,
  icono: Icono,
  children,
  pie,
  className,
}: {
  titulo: string;
  icono: LucideIcon;
  children: React.ReactNode;
  pie?: string;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}>
      <h3 className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icono className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
        {titulo}
      </h3>
      {children}
      {pie && <p className="mt-3 text-[12px] leading-relaxed text-muted-foreground">{pie}</p>}
    </section>
  );
}

export function Dato({
  etiqueta,
  valor,
  detalle,
  className,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  className?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] text-muted-foreground">{etiqueta}</div>
      <div className={cn("text-[19px] font-bold leading-tight tabular-nums", className)}>
        {valor}
      </div>
      {detalle && <div className="text-[11.5px] text-muted-foreground">{detalle}</div>}
    </div>
  );
}
