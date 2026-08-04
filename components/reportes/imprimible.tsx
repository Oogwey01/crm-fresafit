"use client";

import { useEffect } from "react";
import { LogoFresafit } from "@/components/logo-fresafit";
import { obtenerCanal, obtenerCategoriaGasto } from "@/lib/catalogos";
import { formatearFecha, hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { ReporteFresafit } from "@/lib/reportes/armar";

/* ============================================================================
   El reporte en papel.
   ----------------------------------------------------------------------------
   Maquetado para A4 con la tipografía de la marca (Space Grotesk en los títulos,
   Instrument Sans en el cuerpo) y su rosa. Cada canal y cada categoría de gasto
   lleva SU color, el mismo del resto del CRM, para que el reparto se reconozca
   de un vistazo sin leer las etiquetas.

   Dos cosas específicas de imprimir:

   · `print-color-adjust: exact` — sin esto, el navegador borra los fondos de
     color al imprimir "para ahorrar tinta" y el reporte sale en blanco y negro,
     que es justo lo contrario de lo que se pidió.

   · `break-inside: avoid` en cada bloque — evita que una tabla quede partida a
     la mitad entre dos páginas.

   El PDF lo genera el navegador con "Guardar como PDF": el texto queda
   seleccionable y el archivo pesa kilobytes.
   ============================================================================ */

export function ReporteImprimible({
  reporte,
  generadoPor,
}: {
  reporte: ReporteFresafit;
  generadoPor: string;
}) {
  /* Se abre el diálogo de impresión solo: a esta pantalla se llega desde el
     botón "Descargar PDF", así que el usuario ya pidió esto. */
  useEffect(() => {
    const t = setTimeout(() => window.print(), 700);
    return () => clearTimeout(t);
  }, []);

  const maxCanal = Math.max(1, ...reporte.ingresos.porCanal.map((c) => c.monto));
  const maxCategoria = Math.max(
    1,
    ...reporte.egresos.porCategoria.map((c) => c.monto),
    reporte.egresos.nomina,
  );
  const maxProducto = Math.max(1, ...reporte.ventas.productos.map((p) => p.monto));
  const positivo = reporte.resultado >= 0;

  return (
    <>
      {/* Estilos de impresión. Van inline porque solo aplican a esta pantalla y
          porque el @page no se puede expresar con clases de Tailwind. */}
      <style>{`
        @page { size: A4; margin: 14mm 12mm; }
        @media print {
          html, body { background: #fff !important; }
          /* El shell de la app (menú lateral, cabecera móvil) no va al papel.
             Se marca con la clase no-imprimir en vez de ocultar el elemento
             header a secas: esa regla se llevaba por delante el encabezado del
             propio reporte. */
          aside, .no-imprimir { display: none !important; }
          main { padding: 0 !important; }
          .hoja { box-shadow: none !important; border: 0 !important; }
        }
        .hoja, .hoja * {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .bloque { break-inside: avoid; page-break-inside: avoid; }
      `}</style>

      <div className="hoja mx-auto max-w-[820px] bg-white p-8 text-[#1a1a1a] shadow-sm print:p-0">
        {/* --- Encabezado --- */}
        <header className="mb-7 flex items-end justify-between gap-6 border-b-[3px] border-[#e84393] pb-4">
          <div>
            <LogoFresafit className="h-8 w-auto" />
            <h1 className="mt-3 font-heading text-[26px] font-bold leading-none tracking-[-0.5px] text-[#1a1a1a]">
              Reporte del negocio
            </h1>
            {/* Con año: un PDF se archiva y se vuelve a abrir meses después. */}
            <p className="mt-1.5 text-[13.5px] text-[#666]">
              Del {formatearFecha(reporte.rango.desde)} al {formatearFecha(reporte.rango.hasta)} de{" "}
              {reporte.rango.hasta.slice(0, 4)}
            </p>
          </div>
          <div className="text-right text-[11px] leading-relaxed text-[#888]">
            <div>Generado el {formatearFecha(hoyISO())}</div>
            {generadoPor && <div>por {generadoPor}</div>}
            <div className="mt-1">
              Comparado contra
              <br />
              {formatearFecha(reporte.comparado.desde)} – {formatearFecha(reporte.comparado.hasta)}
            </div>
          </div>
        </header>

        {/* Sin egresos capturados, "quedó" es el ingreso, no la utilidad. Va
            impreso para que nadie presente ese número como margen. */}
        {reporte.egresos.total === 0 && (
          <p className="bloque mb-5 rounded-lg border border-[#f39c1255] bg-[#f39c120f] px-4 py-2.5 text-[11.5px] leading-relaxed text-[#8a5a00]">
            <strong>Sin gastos ni nómina capturados en este periodo.</strong> «Quedó» es todo lo
            que entró, no la utilidad.
          </p>
        )}

        {/* --- El titular --- */}
        <section className="bloque mb-7 grid grid-cols-3 gap-4">
          {[
            { et: "Entró", val: reporte.ingresos.total, color: "#00b894" },
            { et: "Salió", val: reporte.egresos.total, color: "#e17055" },
            {
              et: "Quedó",
              val: reporte.resultado,
              color: positivo ? "#00b894" : "#d63031",
              destacado: true,
            },
          ].map((k) => (
            <div
              key={k.et}
              className="rounded-xl border border-[#eee] p-4"
              style={k.destacado ? { backgroundColor: `${k.color}12`, borderColor: `${k.color}55` } : undefined}
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[#888]">
                {k.et}
              </div>
              <div
                className="mt-1.5 font-heading text-[23px] font-bold leading-none tabular-nums"
                style={{ color: k.color }}
              >
                {formatearMXN(k.val)}
              </div>
              {k.destacado && reporte.margen !== null && reporte.egresos.total > 0 && (
                <div className="mt-1 text-[11.5px] text-[#666]">
                  {reporte.margen.toFixed(1)}% de margen
                </div>
              )}
            </div>
          ))}
        </section>

        {/* --- De dónde vino --- */}
        <section className="bloque mb-6">
          <h2 className="mb-2.5 font-heading text-[13px] font-bold uppercase tracking-wider text-[#e84393]">
            De dónde vino el dinero
          </h2>
          <table className="w-full text-[13px]">
            <tbody>
              {reporte.ingresos.porCanal.map((c) => {
                const color = obtenerCanal(c.clave)?.color ?? "#94a3b8";
                return (
                  <tr key={c.clave} className="border-b border-[#f0f0f0]">
                    <td className="w-[38%] py-1.5">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block size-2.5 shrink-0 rounded-[3px]"
                          style={{ backgroundColor: color }}
                        />
                        {c.nombre}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <span className="block h-2 rounded-full bg-[#f4f4f6]">
                        <span
                          className="block h-2 rounded-full"
                          style={{
                            width: `${Math.max(3, (c.monto / maxCanal) * 100)}%`,
                            backgroundColor: color,
                          }}
                        />
                      </span>
                    </td>
                    <td className="w-[22%] py-1.5 text-right font-semibold tabular-nums">
                      {formatearMXN(c.monto)}
                    </td>
                  </tr>
                );
              })}
              {reporte.ingresos.agencia > 0 && (
                <tr className="border-b border-[#f0f0f0]">
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block size-2.5 shrink-0 rounded-[3px]"
                        style={{ backgroundColor: "#6c5ce7" }}
                      />
                      Honorarios de la agencia
                    </span>
                  </td>
                  <td className="py-1.5">
                    <span className="block h-2 rounded-full bg-[#f4f4f6]">
                      <span
                        className="block h-2 rounded-full"
                        style={{
                          width: `${Math.max(3, (reporte.ingresos.agencia / maxCanal) * 100)}%`,
                          backgroundColor: "#6c5ce7",
                        }}
                      />
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">
                    {formatearMXN(reporte.ingresos.agencia)}
                  </td>
                </tr>
              )}
              <tr>
                <td className="pt-2 font-semibold" colSpan={2}>
                  Total
                </td>
                <td className="pt-2 text-right font-heading text-[15px] font-bold tabular-nums">
                  {formatearMXN(reporte.ingresos.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* --- En qué se fue --- */}
        <section className="bloque mb-6">
          <h2 className="mb-2.5 font-heading text-[13px] font-bold uppercase tracking-wider text-[#e84393]">
            En qué se fue
          </h2>
          <table className="w-full text-[13px]">
            <tbody>
              {reporte.egresos.porCategoria.map((c) => {
                const color = obtenerCategoriaGasto(c.clave)?.color ?? "#94a3b8";
                return (
                  <tr key={c.clave} className="border-b border-[#f0f0f0]">
                    <td className="w-[38%] py-1.5">
                      <span className="inline-flex items-center gap-2">
                        <span
                          className="inline-block size-2.5 shrink-0 rounded-[3px]"
                          style={{ backgroundColor: color }}
                        />
                        {c.nombre}
                      </span>
                    </td>
                    <td className="py-1.5">
                      <span className="block h-2 rounded-full bg-[#f4f4f6]">
                        <span
                          className="block h-2 rounded-full"
                          style={{
                            width: `${Math.max(3, (c.monto / maxCategoria) * 100)}%`,
                            backgroundColor: color,
                          }}
                        />
                      </span>
                    </td>
                    <td className="w-[22%] py-1.5 text-right font-semibold tabular-nums">
                      {formatearMXN(c.monto)}
                    </td>
                  </tr>
                );
              })}
              {reporte.egresos.nomina > 0 && (
                <tr className="border-b border-[#f0f0f0]">
                  <td className="py-1.5">
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="inline-block size-2.5 shrink-0 rounded-[3px]"
                        style={{ backgroundColor: "#00b894" }}
                      />
                      Nómina pagada
                    </span>
                  </td>
                  <td className="py-1.5">
                    <span className="block h-2 rounded-full bg-[#f4f4f6]">
                      <span
                        className="block h-2 rounded-full"
                        style={{
                          width: `${Math.max(3, (reporte.egresos.nomina / maxCategoria) * 100)}%`,
                          backgroundColor: "#00b894",
                        }}
                      />
                    </span>
                  </td>
                  <td className="py-1.5 text-right font-semibold tabular-nums">
                    {formatearMXN(reporte.egresos.nomina)}
                  </td>
                </tr>
              )}
              <tr>
                <td className="pt-2 font-semibold" colSpan={2}>
                  Total
                </td>
                <td className="pt-2 text-right font-heading text-[15px] font-bold tabular-nums">
                  {formatearMXN(reporte.egresos.total)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        {/* --- Qué se vendió --- */}
        <section className="bloque mb-6">
          <h2 className="mb-2.5 font-heading text-[13px] font-bold uppercase tracking-wider text-[#e84393]">
            Qué se vendió
          </h2>
          <div className="mb-3 grid grid-cols-4 gap-3 rounded-xl bg-[#faf7f9] p-3.5">
            {[
              ["Órdenes", String(reporte.ventas.ordenes)],
              ["Piezas", String(reporte.ventas.piezas)],
              ["Ticket promedio", formatearMXN(reporte.ventas.ticket)],
              ["Clientes nuevos", String(reporte.clientes.nuevos)],
            ].map(([et, val]) => (
              <div key={et}>
                <div className="text-[10.5px] uppercase tracking-wide text-[#888]">{et}</div>
                <div className="font-heading text-[17px] font-bold tabular-nums">{val}</div>
              </div>
            ))}
          </div>
          {reporte.ventas.productos.length > 0 && (
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-[10.5px] uppercase tracking-wide text-[#888]">
                  <th className="pb-1 text-left font-semibold">Producto</th>
                  <th className="pb-1 text-right font-semibold">Piezas</th>
                  <th className="w-[30%] pb-1" />
                  <th className="pb-1 text-right font-semibold">Importe</th>
                </tr>
              </thead>
              <tbody>
                {reporte.ventas.productos.map((p) => (
                  <tr key={p.nombre} className="border-b border-[#f0f0f0]">
                    <td className="py-1.5">{p.nombre}</td>
                    <td className="py-1.5 text-right tabular-nums text-[#666]">{p.piezas}</td>
                    <td className="py-1.5 pl-3">
                      <span className="block h-1.5 rounded-full bg-[#f4f4f6]">
                        <span
                          className="block h-1.5 rounded-full bg-[#e84393]"
                          style={{ width: `${Math.max(3, (p.monto / maxProducto) * 100)}%` }}
                        />
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-semibold tabular-nums">
                      {formatearMXN(p.monto)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {/* --- Operación --- */}
        <section className="bloque mb-6 grid grid-cols-2 gap-6">
          <div>
            <h2 className="mb-2 font-heading text-[13px] font-bold uppercase tracking-wider text-[#e84393]">
              Pedidos del periodo
            </h2>
            <table className="w-full text-[13px]">
              <tbody>
                {[
                  ["Entregados", reporte.pedidos.entregados, false],
                  ["Enviados", reporte.pedidos.enviados, false],
                  ["Sin salir", reporte.pedidos.nuevos + reporte.pedidos.preparando, false],
                  ["Atrasados", reporte.pedidos.atrasados, reporte.pedidos.atrasados > 0],
                ].map(([et, val, alerta]) => (
                  <tr key={String(et)} className="border-b border-[#f0f0f0]">
                    <td className="py-1.5 text-[#666]">{et}</td>
                    <td
                      className="py-1.5 text-right font-semibold tabular-nums"
                      style={alerta ? { color: "#d63031" } : undefined}
                    >
                      {val}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <h2 className="mb-2 font-heading text-[13px] font-bold uppercase tracking-wider text-[#e84393]">
              Inventario hoy
            </h2>
            <table className="w-full text-[13px]">
              <tbody>
                {[
                  /* stock × costo; sin costos capturados sale 0 y eso no es un
                     valor, es un dato que falta. */
                  [
                    "Valor del stock",
                    reporte.inventario.valorStock > 0
                      ? formatearMXN(reporte.inventario.valorStock)
                      : "sin costos",
                    false,
                  ],
                  ["Productos", String(reporte.inventario.productos), false],
                  [
                    "Bajo mínimo",
                    String(reporte.inventario.bajoMinimo),
                    reporte.inventario.bajoMinimo > 0,
                  ],
                  ["Agotados", String(reporte.inventario.sinStock), reporte.inventario.sinStock > 0],
                ].map(([et, val, alerta]) => (
                  <tr key={String(et)} className="border-b border-[#f0f0f0]">
                    <td className="py-1.5 text-[#666]">{et}</td>
                    <td
                      className="py-1.5 text-right font-semibold tabular-nums"
                      style={alerta ? { color: "#e17055" } : undefined}
                    >
                      {val}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* --- Pendientes de la agencia --- */}
        {(reporte.agencia.porCobrar > 0 || reporte.agencia.sinFacturar > 0) && (
          <section className="bloque mb-6 rounded-xl border border-[#6c5ce733] bg-[#6c5ce70a] p-4">
            <h2 className="mb-2 font-heading text-[13px] font-bold uppercase tracking-wider text-[#6c5ce7]">
              Pendientes de la agencia
            </h2>
            <div className="flex gap-8 text-[13px]">
              {reporte.agencia.sinFacturar > 0 && (
                <div>
                  <div className="text-[11px] text-[#888]">Calculado sin facturar</div>
                  <div className="font-heading text-[17px] font-bold tabular-nums">
                    {formatearMXN(reporte.agencia.sinFacturar)}
                  </div>
                </div>
              )}
              {reporte.agencia.porCobrar > 0 && (
                <div>
                  <div className="text-[11px] text-[#888]">Facturado sin pagar</div>
                  <div className="font-heading text-[17px] font-bold tabular-nums text-[#e17055]">
                    {formatearMXN(reporte.agencia.porCobrar)}
                  </div>
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] text-[#888]">
              No entra en el resultado: solo lo que ya se pagó cuenta como ingreso.
            </p>
          </section>
        )}

        {/* --- Notas al pie: las salvedades que evitan malas lecturas --- */}
        <footer className="border-t border-[#eee] pt-3 text-[10.5px] leading-relaxed text-[#999]">
          <p>
            Las ventas son el bruto que reportan los canales (producto + envío − descuentos). La
            nómina cuenta lo pagado dentro del periodo, no lo devengado. El inventario es la
            situación de hoy, no la del cierre del periodo.
          </p>
          <p className="mt-1">Fresafit · Sistema interno · {hoyISO()}</p>
        </footer>
      </div>

      {/* Solo en pantalla: por si el diálogo de impresión no se abrió solo. */}
      <div className="no-imprimir mx-auto mt-4 max-w-[820px] text-center">
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-lg bg-[#e84393] px-4 py-2 text-[13.5px] font-semibold text-white"
        >
          Abrir el diálogo de impresión
        </button>
        <p className="mt-2 text-[12px] text-muted-foreground">
          En el destino, elige «Guardar como PDF». Deja activado «Gráficos de fondo» para que
          salgan los colores.
        </p>
      </div>
    </>
  );
}
