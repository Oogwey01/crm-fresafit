/* ============================================================================
   lib/maquila/estadisticas.ts — Volumen de producción por quincena
   ----------------------------------------------------------------------------
   Para qué existe, en palabras de Armando: «si llevamos a un volumen de
   pedidos constantes y grandes, tienes que bajar precios». La negociación se
   hace con la quincena anterior al lado, no de memoria.

   Se calcula sobre los PEDIDOS ENVIADOS, no sobre los cortes: así hay números
   aunque la quincena todavía no se haya cortado, y aunque quien mire no pueda
   ver el dinero (las piezas son operación; el monto, permiso aparte).

   Funciones puras; el corte por permiso lo hace quien llama.
   ============================================================================ */

import { deltaPct } from "@/lib/metricas";
import type { Quincena } from "@/lib/maquila/quincenas";

export type PiezaProducida = {
  id: string;
  enviado_en: string | null;
  estado: string;
  modelo: string;
  acabado: string;
  cantidad: number;
};

export type ResumenQuincena = {
  quincena: Quincena;
  piezas: number;
  monto: number;
  porModelo: { id: string; piezas: number }[];
  porAcabado: { id: string; piezas: number }[];
};

/* El día (México) en que salió una pieza. `enviado_en` es un instante UTC: sin
   convertirlo, todo lo enviado después de las 18:00 caería en el día
   siguiente y las piezas del 15 se irían a la otra quincena. */
function diaDeSalida(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
}

/* Lo producido en una quincena. `costoUnitario` resuelve el costo del renglón;
   si no se pasa —porque quien mira no ve dinero— el monto queda en 0 y la
   pantalla solo enseña piezas. */
export function resumenDeQuincena(
  piezas: PiezaProducida[],
  quincena: Quincena,
  costoUnitario?: (p: PiezaProducida) => number,
): ResumenQuincena {
  const dentro = piezas.filter((p) => {
    if (!p.enviado_en) return false;
    if (p.estado !== "enviado" && p.estado !== "entregado") return false;
    const dia = diaDeSalida(p.enviado_en);
    return dia >= quincena.desde && dia <= quincena.hasta;
  });

  const porModelo = new Map<string, number>();
  const porAcabado = new Map<string, number>();
  let total = 0;
  let monto = 0;

  for (const p of dentro) {
    total += p.cantidad;
    monto += (costoUnitario?.(p) ?? 0) * p.cantidad;
    porModelo.set(p.modelo, (porModelo.get(p.modelo) ?? 0) + p.cantidad);
    porAcabado.set(p.acabado, (porAcabado.get(p.acabado) ?? 0) + p.cantidad);
  }

  const aLista = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([id, piezas]) => ({ id, piezas }))
      .sort((a, b) => b.piezas - a.piezas);

  return {
    quincena,
    piezas: total,
    monto: Math.round(monto * 100) / 100,
    porModelo: aLista(porModelo),
    porAcabado: aLista(porAcabado),
  };
}

/* El Δ contra la quincena previa, en el mismo formato que usan Métricas y
   Finanzas (deltaPct devuelve null cuando no hay base con la que comparar). */
export function compararQuincenas(
  actual: ResumenQuincena,
  anterior: ResumenQuincena,
): { piezas: number | null; monto: number | null } {
  return {
    piezas: deltaPct(actual.piezas, anterior.piezas),
    monto: deltaPct(actual.monto, anterior.monto),
  };
}
