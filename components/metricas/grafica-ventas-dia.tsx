"use client";

import { formatearFecha } from "@/lib/fecha";
import { formatearMXN, formatearMXNCorto } from "@/lib/moneda";

/* Alto (px) de la barra más alta en "ventas por día". */
const ALTO_BARRAS = 190;

/* Renglón del importe que va encima de cada barra. */
const ALTO_CIFRA = 20;

/* Gráfica de barras verticales «ventas por día». Recalcula su propio máximo
   sobre los días que recibe, así el subconjunto móvil (7 días) no se aplana por
   un pico fuera de la ventana. Columnas por `gridTemplateColumns` inline: el
   número es dinámico y no puede ir en una clase Tailwind estática.

   Cada barra lleva su cifra arriba y su número de ventas abajo: la altura sola
   dice qué día fue mejor, pero no cuánto entró ni cuántas transacciones hubo, y
   eso obligaba a apuntar con el cursor para leer el tooltip (imposible en el
   celular, que es donde más se mira esta pantalla).

   Con `total` en null —quien mira no ve los importes— la gráfica mide el NÚMERO
   DE VENTAS del día. La forma de la semana se conserva, que es para lo que se
   mira: no hay por qué quitar la tarjeta por no poder poner los pesos. */
export function GraficaVentasDia({
  dias,
}: {
  dias: { iso: string; total: number | null; ventas: number }[];
}) {
  const enDinero = dias.some((d) => d.total !== null);
  const alturaDe = (d: { total: number | null; ventas: number }) =>
    enDinero ? (d.total ?? 0) : d.ventas;

  const max = Math.max(...dias.map(alturaDe), 1);
  const cols = { gridTemplateColumns: `repeat(${dias.length}, minmax(0, 1fr))` };
  return (
    <>
      {/* Altura en PÍXELES, no en %: dentro de un flex/grid sin altura definida
          el navegador resuelve `height: X%` a cero y las barras se aplanan. El
          alto reservado suma el renglón de la cifra, que va FUERA de la barra:
          si no, el día más alto lo empujaría fuera de la tarjeta. */}
      <div className="grid items-end gap-2.5" style={{ ...cols, height: ALTO_BARRAS + ALTO_CIFRA }}>
        {dias.map((d) => {
          const alto = alturaDe(d);
          return (
            <div
              key={d.iso}
              className="flex h-full flex-col justify-end"
              title={`${formatearFecha(d.iso)}: ${
                enDinero ? `${formatearMXN(d.total)} · ` : ""
              }${d.ventas} ${d.ventas === 1 ? "venta" : "ventas"}`}
            >
              <span className="mb-1 text-center text-[11px] font-semibold tabular-nums text-muted-foreground">
                {alto > 0 ? (enDinero ? formatearMXNCorto(d.total) : String(d.ventas)) : "—"}
              </span>
              <div
                className="w-full rounded-t-[7px] rounded-b-[3px] bg-primary transition-[filter] hover:brightness-110"
                style={{ height: alto > 0 ? Math.max(3, Math.round((alto / max) * ALTO_BARRAS)) : 0 }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2.5 grid gap-2.5 border-t pt-2.5" style={cols}>
        {dias.map((d) => (
          <div key={d.iso} className="text-center">
            <div className="text-[11.5px] font-medium text-muted-foreground">
              {Number(d.iso.slice(8, 10))}
            </div>
            {/* Solo el número, sin la palabra: en el celular cada columna mide
                unos 40 px y "24 ventas" se parte a media palabra. Lo que es cada
                cifra lo dice la nota al pie, una vez, en lugar de repetirlo
                catorce veces. */}
            <div className="text-[10.5px] tabular-nums text-muted-foreground/70">
              {d.ventas > 0 ? d.ventas : "—"}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
