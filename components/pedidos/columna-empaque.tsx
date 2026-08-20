"use client";

import { useDroppable } from "@dnd-kit/core";
import { TarjetaPaquete } from "@/components/pedidos/tarjeta-paquete";
import type { EtapaEmpaqueId, PedidoEnvio } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Una columna del tablero de empaque. Calcada de components/tareas/columna.tsx:
   el mismo `useDroppable` y el mismo aviso de "suéltalo aquí" (borde punteado)
   cuando la tarjeta pasa por encima, para que las dos pantallas del CRM que se
   arrastran se sientan igual. */
export function ColumnaEmpaque({
  etapa,
  nombre,
  color,
  pedidos,
  ahora,
  vacio,
  onMover,
  onAbrir,
  dominioTiendaNube,
}: {
  etapa: EtapaEmpaqueId;
  nombre: string;
  color: string;
  pedidos: PedidoEnvio[];
  ahora: number;
  vacio: string;
  onMover: (p: PedidoEnvio, etapa: EtapaEmpaqueId) => void;
  onAbrir: (p: PedidoEnvio) => void;
  dominioTiendaNube?: string | null;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa });

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "min-h-32 rounded-xl bg-muted/60 p-2.5 transition-colors",
        isOver && "bg-primary/10 outline-2 outline-dashed outline-primary",
      )}
    >
      <div className="flex items-start justify-between gap-2 px-1 pb-2.5 pt-1">
        {/* El nombre en dos renglones si hace falta: "Sellado y esperando
            recolección" es el nombre que usa bodega y acortarlo obligaría a
            traducir entre esta pantalla y como se habla en la mesa. */}
        <span
          className="text-[12.5px] font-bold uppercase leading-tight tracking-wide"
          style={{ color }}
        >
          {nombre}
        </span>
        <span className="shrink-0 rounded-full bg-background px-2 py-0.5 text-xs font-bold tabular-nums text-muted-foreground">
          {pedidos.length}
        </span>
      </div>

      <div className="flex min-h-16 flex-col gap-2.5">
        {pedidos.length === 0 ? (
          <div className="py-4 text-center text-sm italic text-muted-foreground/60">{vacio}</div>
        ) : (
          pedidos.map((p) => (
            <TarjetaPaquete
              key={p.id}
              pedido={p}
              ahora={ahora}
              onMover={onMover}
              onAbrir={onAbrir}
              dominioTiendaNube={dominioTiendaNube}
            />
          ))
        )}
      </div>
    </div>
  );
}
