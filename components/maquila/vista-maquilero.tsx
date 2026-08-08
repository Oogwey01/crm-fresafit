"use client";

import { useState } from "react";
import { AlarmClock, Factory, Scissors, Zap } from "lucide-react";
import { StatCard } from "@/components/compartido/stat-card";
import { TableroMaquila } from "@/components/maquila/tablero";
import { PedidoMaquilaDialog } from "@/components/maquila/pedido-dialog";
import { ESTADOS_MAQUILA_ACTIVOS } from "@/lib/catalogos";
import { formatearFecha } from "@/lib/fecha";
import type { PedidoMaquila } from "@/lib/types";

const ACTIVOS: readonly string[] = ESTADOS_MAQUILA_ACTIVOS;

/* La pantalla de Eduardo: SU tablero y nada más. La RLS ya recortó lo que no
   le toca (nada sin pagar, cero dinero de venta); aquí solo se ordena el día:
   qué urge, qué va en el corte y qué sale manual. */
export function VistaMaquilero({
  pedidos,
  hoy,
  nombre,
}: {
  pedidos: PedidoMaquila[];
  hoy: string;
  nombre: string;
}) {
  const [abierto, setAbierto] = useState<PedidoMaquila | null>(null);

  const activos = pedidos.filter((p) => ACTIVOS.includes(p.estado));
  const paraHoy = activos.filter((p) => p.fecha_prometida && p.fecha_prometida <= hoy);
  const atrasados = activos.filter((p) => p.fecha_prometida && p.fecha_prometida < hoy);
  const prensados = activos.filter((p) => p.ruta === "directa" || p.acabado === "prensado");
  const enCorte = activos.filter((p) => p.ruta === "corte");
  const corteActual = enCorte.reduce<string | null>(
    (min, p) => (p.corte_fecha && (!min || p.corte_fecha < min) ? p.corte_fecha : min),
    null,
  );

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-[26px] font-bold tracking-tight">Maquila México</h1>
        <p className="mt-1.5 text-[14.5px] text-muted-foreground">
          Hola, {nombre}. Esto es lo que hay que producir, ordenado por urgencia: lo de arriba va
          primero. Cada pedido trae su ficha imprimible con todo el armado.
        </p>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard
          etiqueta="Para hoy"
          valor={String(paraHoy.length)}
          icono={Factory}
          nota="vencen hoy o ya se pasaron"
        />
        <StatCard
          etiqueta="Atrasados"
          valor={String(atrasados.length)}
          icono={AlarmClock}
          valorClassName={atrasados.length > 0 ? "text-red-600" : undefined}
        />
        <StatCard
          etiqueta="Corte actual"
          valor={String(enCorte.filter((p) => p.corte_fecha === corteActual).length)}
          icono={Scissors}
          nota={corteActual ? `lote del ${formatearFecha(corteActual)}` : "sin lote pendiente"}
        />
        <StatCard
          etiqueta="Prensados"
          valor={String(prensados.length)}
          icono={Zap}
          nota="fuera de corte, salen manual"
        />
      </div>

      <TableroMaquila pedidos={pedidos} hoy={hoy} esEquipo={false} onAbrir={setAbierto} />

      {abierto && (
        <PedidoMaquilaDialog
          pedido={abierto}
          esEquipo={false}
          esAdmin={false}
          onClose={() => setAbierto(null)}
        />
      )}
    </div>
  );
}
