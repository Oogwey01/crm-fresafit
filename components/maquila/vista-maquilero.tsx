"use client";

import { useState } from "react";
import { AlarmClock, Factory, Scissors, Truck } from "lucide-react";
import { StatCard } from "@/components/compartido/stat-card";
import { TableroMaquila } from "@/components/maquila/tablero";
import { PedidoMaquilaDialog } from "@/components/maquila/pedido-dialog";
import { ESTADOS_MAQUILA_ACTIVOS } from "@/lib/catalogos";
import { particionarPedidos } from "@/lib/maquila/reglas";
import { insumosDePedido } from "@/lib/maquila/consignacion";
import { formatearFecha } from "@/lib/fecha";
import type { GuiaMaquila, InsumoMaquilaConSaldo, PedidoMaquila } from "@/lib/types";

const ACTIVOS: readonly string[] = ESTADOS_MAQUILA_ACTIVOS;

/* La pantalla de Eduardo: SU tablero y nada más. La RLS ya recortó lo que no
   le toca (nada sin pagar, cero dinero de venta); aquí solo se ordena el día:
   qué urge, qué va en el corte y qué sale manual. */
export function VistaMaquilero({
  pedidos,
  guias,
  insumos,
  disenosPorPedido,
  hoy,
  nombre,
}: {
  pedidos: PedidoMaquila[];
  guias: GuiaMaquila[];
  insumos: InsumoMaquilaConSaldo[];
  disenosPorPedido: Record<string, string>;
  hoy: string;
  nombre: string;
}) {
  const [abierto, setAbierto] = useState<PedidoMaquila | null>(null);

  /* Mismo corte que las vistas del tablero: la partición compartida de
     lib/maquila/reglas.ts, para que sus tarjetas cuadren con la lista de
     abajo (lo que espera arte no es trabajo suyo todavía). */
  const { paraHoy, atrasados, prensados, esperandoArte, loteActual, corteActual } =
    particionarPedidos(pedidos, ACTIVOS, hoy);
  /* Las guías las surte logística: a él le importa cuántas puede imprimir ya y
     cuántas siguen esperando del otro lado. */
  const guiasListas = guias.filter((g) => g.archivo_path).length;
  const esperandoGuia = guias.length - guiasListas;

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
          valor={String(loteActual.length)}
          icono={Scissors}
          nota={corteActual ? `lote del ${formatearFecha(corteActual)}` : "sin lote pendiente"}
        />
        <StatCard
          etiqueta="Guías listas"
          valor={String(guiasListas)}
          icono={Truck}
          valorClassName={guiasListas > 0 ? "text-emerald-600" : undefined}
          nota={
            esperandoGuia > 0
              ? `${esperandoGuia} esperan que Fresa Fit la suba`
              : "para imprimir y pegar"
          }
        />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px] text-muted-foreground">
        <span>
          {prensados.length > 0
            ? `${prensados.length} son prensados: salen fuera de corte, en cuanto los tengas.`
            : "Nada de prensado pendiente ahora mismo."}
        </span>
        {/* Lo que se vendió pero todavía no tiene arte: no es trabajo suyo aún,
            pero le sirve saber lo que viene detrás. */}
        {esperandoArte.length > 0 && (
          <span className="whitespace-nowrap">
            <strong className="text-foreground">{esperandoArte.length}</strong> esperan el diseño
          </span>
        )}
        {/* Su material en resguardo: no es dinero, es saber si le alcanzan las
            palancas para lo que tiene enfrente. */}
        {insumos
          .filter((i) => i.activo)
          .map((i) => (
            <span key={i.id} className="whitespace-nowrap">
              {i.nombre}:{" "}
              <strong className={i.saldo <= i.minimo ? "text-red-600" : "text-foreground"}>
                {i.saldo}
              </strong>
              {i.comprometido > 0 ? ` (${i.comprometido} comprometidas)` : ""}
            </span>
          ))}
      </div>

      <TableroMaquila
        pedidos={pedidos}
        guias={guias}
        disenosPorPedido={disenosPorPedido}
        hoy={hoy}
        esEquipo={false}
        onAbrir={setAbierto}
      />

      {abierto && (
        <PedidoMaquilaDialog
          pedido={abierto}
          esEquipo={false}
          esAdmin={false}
          insumos={insumosDePedido(abierto)}
          onClose={() => setAbierto(null)}
        />
      )}
    </div>
  );
}
