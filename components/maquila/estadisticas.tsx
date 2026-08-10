"use client";

import { StatCard } from "@/components/compartido/stat-card";
import { obtenerAcabadoMaquila, obtenerModeloMaquila } from "@/lib/catalogos";
import { nombreQuincena, quincenasRecientes } from "@/lib/maquila/quincenas";
import { compararQuincenas, resumenDeQuincena } from "@/lib/maquila/estadisticas";
import { formatearMXN } from "@/lib/moneda";
import type { PedidoMaquila } from "@/lib/types";

/* «Así empezamos, así estamos y para allá vamos». Es la pantalla con la que
   Armando se sienta a renegociar el costo por volumen: cuántas piezas salieron
   cada quincena y —solo con permiso de dinero— cuánto se pagó por ellas.

   Se calcula sobre los pedidos enviados, no sobre los cortes: así hay números
   aunque la quincena no se haya cortado todavía. */
export function EstadisticasMaquila({
  pedidos,
  costosPorPedido,
  hoy,
  veDinero,
}: {
  pedidos: PedidoMaquila[];
  costosPorPedido: Record<string, number>;
  hoy: string;
  veDinero: boolean;
}) {
  const costo = veDinero ? (p: { id: string }) => costosPorPedido[p.id] ?? 0 : undefined;
  const quincenas = quincenasRecientes(hoy, 6);
  const resumenes = quincenas.map((q) => resumenDeQuincena(pedidos, q, costo));

  const actual = resumenes[0];
  const anterior = resumenes[1];
  const delta = anterior ? compararQuincenas(actual, anterior) : { piezas: null, monto: null };

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="mb-1 text-[15px] font-semibold">
          Quincena en curso — {nombreQuincena(actual.quincena)}
        </h2>
        <div className="grid grid-cols-2 gap-3.5 md:grid-cols-4">
          <StatCard
            etiqueta="Piezas producidas"
            valor={String(actual.piezas)}
            delta={delta.piezas}
            deltaEtiqueta="vs. quincena anterior"
          />
          {veDinero && (
            <StatCard
              etiqueta="Costo de maquila"
              valor={formatearMXN(actual.monto)}
              delta={delta.monto}
              deltaEtiqueta="vs. quincena anterior"
              nota="sin IVA"
            />
          )}
          <StatCard
            etiqueta="Powerlift"
            valor={String(actual.porModelo.find((m) => m.id === "powerlift")?.piezas ?? 0)}
            nota="de las piezas de esta quincena"
          />
          <StatCard
            etiqueta="Hebilla"
            valor={String(actual.porModelo.find((m) => m.id === "hebilla")?.piezas ?? 0)}
            nota="de las piezas de esta quincena"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border bg-card">
        <table className="w-full min-w-[720px] text-[13.5px]">
          <thead>
            <tr className="border-b text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-2.5 font-semibold">Quincena</th>
              <th className="px-4 py-2.5 text-right font-semibold">Piezas</th>
              {veDinero && <th className="px-4 py-2.5 text-right font-semibold">Costo</th>}
              <th className="px-4 py-2.5 font-semibold">Por modelo</th>
              <th className="px-4 py-2.5 font-semibold">Por acabado</th>
            </tr>
          </thead>
          <tbody>
            {resumenes.map((r) => (
              <tr key={r.quincena.desde} className="border-b last:border-0">
                <td className="px-4 py-2.5 font-medium">{nombreQuincena(r.quincena)}</td>
                <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{r.piezas}</td>
                {veDinero && (
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatearMXN(r.monto)}</td>
                )}
                <td className="px-4 py-2.5 text-muted-foreground">
                  {r.porModelo
                    .map((m) => `${obtenerModeloMaquila(m.id)?.nombre ?? m.id} ${m.piezas}`)
                    .join(" · ") || "—"}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">
                  {r.porAcabado
                    .map((a) => `${obtenerAcabadoMaquila(a.id)?.nombre ?? a.id} ${a.piezas}`)
                    .join(" · ") || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[12.5px] text-muted-foreground">
        Cuenta lo que <strong>salió</strong> en cada quincena (con guía), no lo que se vendió: es
        la base sobre la que se le paga y sobre la que se negocia el costo por volumen.
      </p>
    </div>
  );
}
