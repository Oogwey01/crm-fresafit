"use client";

import { useEffect, useState } from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { ETAPAS_EMPAQUE } from "@/lib/catalogos";
import { etapaDe } from "@/lib/pedidos/bandejas";
import type { EtapaEmpaqueId, PedidoEnvio } from "@/lib/types";
import { ColumnaEmpaque } from "@/components/pedidos/columna-empaque";
import { TarjetaPaquete } from "@/components/pedidos/tarjeta-paquete";

/* ============================================================================
   El tablero de empaque: la mesa de bodega dentro del CRM.
   ----------------------------------------------------------------------------
   Sustituye a un "Rastreador de paquetes" que se llevaba aparte, en un HTML
   suelto fuera del CRM, porque la tabla de «Por empacar» no contesta lo único
   que importa mientras se arma una caja: en qué punto va cada paquete. Las
   cuatro columnas y sus nombres son los de esa herramienta —el vocabulario es
   el de quien empaca, no uno inventado aquí—.

   Lo que la tabla sí tenía y el rastreador de fuera no, y que aquí se queda: el
   plazo de despacho del canal, que es lo que decide qué caja va primero.
   ============================================================================ */

/* Cada cuánto se recalculan los "1h 11min en esta etapa". Un minuto es la
   granularidad que se enseña: refrescar más seguido no cambiaría un solo texto. */
const LATIDO_MS = 60_000;

const VACIO: Record<EtapaEmpaqueId, string> = {
  preparado: "Nada por preparar. 🎉",
  calidad: "Sin paquetes",
  sellado: "Sin paquetes",
  recolectado: "Nada recolectado hoy",
};

export function TableroEmpaque({
  pedidos,
  ahora,
  onMover,
  onAbrir,
  dominioTiendaNube,
}: {
  /* Ya filtrados por quien manda (ver entraAlTablero en lib/pedidos/bandejas.ts):
     el tablero reparte en columnas, no decide quién entra. */
  pedidos: PedidoEnvio[];
  /* El instante que bajó del servidor. Es la semilla del latido: usarlo en el
     primer render es lo que evita que el servidor pinte "12min" y el navegador
     "13min" y React tire la hidratación. */
  ahora: number;
  onMover: (p: PedidoEnvio, etapa: EtapaEmpaqueId) => void;
  onAbrir: (p: PedidoEnvio) => void;
  /* Viaja hasta la tarjeta: es el respaldo del enlace a la publicación de Tienda
     Nube cuando la sync aún no ha guardado el permalink público. */
  dominioTiendaNube?: string | null;
}) {
  const [reloj, setReloj] = useState(ahora);
  useEffect(() => {
    const t = setInterval(() => setReloj(Date.now()), LATIDO_MS);
    return () => clearInterval(t);
  }, []);

  const [arrastrando, setArrastrando] = useState<string | null>(null);

  /* `distance: 6` en el ratón para que un clic en la tarjeta no cuente como
     arrastre, y `delay: 200` en el táctil para que deslizar los carriles con el
     dedo no levante una tarjeta sin querer. Mismos números que el tablero de
     Tareas, que es el que ya está rodado en teléfono. */
  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function alSoltar(e: DragEndEvent) {
    setArrastrando(null);
    const { active, over } = e;
    if (!over) return;
    const etapa = String(over.id) as EtapaEmpaqueId;
    if (!ETAPAS_EMPAQUE.some((x) => x.id === etapa)) return;
    const p = pedidos.find((x) => x.id === String(active.id));
    /* Soltar en la columna de la que salió no es un movimiento: escribirlo
       resetearía el "lleva 3h aquí", que es el dato que delata lo atorado. */
    if (!p || etapaDe(p) === etapa) return;
    onMover(p, etapa);
  }

  const activo = arrastrando ? pedidos.find((p) => p.id === arrastrando) : null;

  return (
    <div>
      {/* id fijo: sin él, dnd-kit numera su `aria-describedby` distinto en el
          servidor y en el navegador, y React avisa de hidratación. */}
      <DndContext
        id="tablero-empaque"
        sensors={sensores}
        onDragStart={(e: DragStartEvent) => setArrastrando(String(e.active.id))}
        onDragEnd={alSoltar}
        onDragCancel={() => setArrastrando(null)}
      >
        {/* Teléfono: carriles que se deslizan con enganche, porque cuatro
            columnas no caben y bodega empaca con el celular en la mano.
            Escritorio: las cuatro a la vista. */}
        <div className="-mx-4 flex snap-x snap-mandatory items-start gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-4">
          {ETAPAS_EMPAQUE.map((etapa) => (
            <div key={etapa.id} className="w-[85%] shrink-0 snap-start md:w-auto">
              <ColumnaEmpaque
                etapa={etapa.id}
                nombre={etapa.nombre}
                color={etapa.color}
                pedidos={pedidos.filter((p) => etapaDe(p) === etapa.id)}
                ahora={reloj}
                vacio={VACIO[etapa.id]}
                onMover={onMover}
                onAbrir={onAbrir}
                dominioTiendaNube={dominioTiendaNube}
              />
            </div>
          ))}
        </div>

        <DragOverlay>
          {activo ? <TarjetaPaquete pedido={activo} ahora={reloj} overlay /> : null}
        </DragOverlay>
      </DndContext>
    </div>
  );
}
