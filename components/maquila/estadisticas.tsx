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

  /* Piezas por producto en la ventana completa de las quincenas listadas. Se
     agrupa por SKU (y por diseño cuando no hay SKU: los personalizados); los
     cancelados no cuentan. */
  const desdeVentana = quincenas[quincenas.length - 1]?.desde ?? hoy;
  const acumulado = new Map<string, { nombre: string; detalle: string; piezas: number }>();
  for (const p of pedidos) {
    if (!p.pagado_en || p.estado === "cancelado") continue;
    if (p.pagado_en.slice(0, 10) < desdeVentana) continue;
    const clave = p.sku ?? p.diseno ?? "otro";
    const detalle = [
      obtenerModeloMaquila(p.modelo)?.nombre,
      obtenerAcabadoMaquila(p.acabado)?.nombre,
    ]
      .filter(Boolean)
      .join(" · ");
    const previo = acumulado.get(clave);
    if (previo) previo.piezas += p.cantidad;
    else acumulado.set(clave, { nombre: p.diseno ?? p.sku ?? "Sin nombre", detalle, piezas: p.cantidad });
  }
  const porProducto = [...acumulado.entries()]
    .map(([clave, f]) => ({ clave, ...f }))
    .sort((a, b) => b.piezas - a.piezas)
    .slice(0, 15);

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

      {/* Ventas por producto (junta 13/08): qué es lo que más se le manda a
          producir a Eduardo en la ventana de las mismas 6 quincenas. Sale de
          los pedidos de maquila —que por definición son SOLO sus productos:
          prensados, gamuza pro y personalizados— y cuenta piezas, no dinero,
          así que el maquilero puede verlo igual. */}
      {porProducto.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border bg-card">
          <table className="w-full min-w-[520px] text-[13.5px]">
            <thead>
              <tr className="border-b text-left text-[11.5px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-2.5 font-semibold">
                  Lo que más sale (últimas {quincenas.length} quincenas)
                </th>
                <th className="px-4 py-2.5 font-semibold">Modelo · acabado</th>
                <th className="px-4 py-2.5 text-right font-semibold">Piezas</th>
              </tr>
            </thead>
            <tbody>
              {porProducto.map((f) => (
                <tr key={f.clave} className="border-b last:border-0">
                  <td className="px-4 py-2.5 font-medium">{f.nombre}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{f.detalle || "—"}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums">{f.piezas}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
