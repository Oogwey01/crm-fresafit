"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Boxes,
  Download,
  FileText,
  Package,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { RangoFechas } from "@/components/compartido/rango-fechas";
import { StatCard } from "@/components/compartido/stat-card";
import { Button } from "@/components/ui/button";
import { obtenerCanal, obtenerCategoriaGasto } from "@/lib/catalogos";
import { formatearFecha, hoyISO, rangosDePeriodo, type PresetRangoId } from "@/lib/fecha";
import { deltaPct } from "@/lib/metricas";
import { formatearMXN } from "@/lib/moneda";
import { cn } from "@/lib/utils";
import type { ReporteFresafit } from "@/lib/reportes/armar";

/* Fila de una tabla de desglose con su barra de proporción. Se repite en
   canales, categorías de gasto y productos, y la barra es lo que hace que el
   reparto se lea de un vistazo sin comparar cifras. */
function Linea({
  nombre,
  monto,
  detalle,
  proporcion,
  color = "var(--color-primary)",
}: {
  nombre: string;
  monto: number;
  detalle?: string;
  proporcion: number;
  color?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
        <span className="min-w-0 truncate">{nombre}</span>
        <span className="shrink-0 tabular-nums">
          {formatearMXN(monto)}
          {detalle && <span className="ml-1.5 text-[12px] text-muted-foreground">{detalle}</span>}
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
        <span
          className="block h-full rounded-full"
          style={{ width: `${Math.min(100, proporcion * 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function Seccion({
  titulo,
  icono: Icono,
  children,
  className,
}: {
  titulo: string;
  icono: typeof Banknote;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-2xl border bg-card p-5 shadow-sm", className)}>
      <h3 className="mb-3.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Icono className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
        {titulo}
      </h3>
      {children}
    </section>
  );
}

export function PanelReporteFresafit({ reporte }: { reporte: ReporteFresafit }) {
  const router = useRouter();
  const [navegando, startNavegar] = useTransition();
  const [preset, setPreset] = useState<PresetRangoId | "">("mes");

  /* El rango vive en la URL: el reporte se calcula en el servidor (ocho
     consultas agregadas) y así un periodo concreto se puede compartir con un
     enlace o dejar abierto en una pestaña. */
  function cambiarRango(desde: string, hasta: string) {
    startNavegar(() => {
      router.push(`/reportes?desde=${desde}&hasta=${hasta}`, { scroll: false });
    });
  }

  function elegirPreset(id: PresetRangoId) {
    setPreset(id);
    const r = rangosDePeriodo(id);
    cambiarRango(r.actual.desde, r.actual.hasta);
  }


  /* PDF: abre la vista de impresión, que se maqueta para A4 con los colores de
     la marca y dispara el diálogo del navegador. El PDF lo genera el propio
     navegador ("Guardar como PDF"), así que el texto queda seleccionable y el
     archivo pesa kilobytes. */
  function descargarPDF() {
    window.open(
      `/reportes/imprimir?desde=${reporte.rango.desde}&hasta=${reporte.rango.hasta}`,
      "_blank",
      "noopener",
    );
  }

  /* CSV: es lo que se pega en una hoja o se le manda al contador sin tener que
     copiar cifra por cifra. */
  function descargarCSV() {
    const filas: string[][] = [
      ["Reporte Fresafit", `${reporte.rango.desde} a ${reporte.rango.hasta}`],
      [],
      ["INGRESOS", ""],
      ["Ventas", String(reporte.ingresos.ventas)],
      ...reporte.ingresos.porCanal.map((c) => [`  ${c.nombre}`, String(c.monto)]),
      ["Honorarios de la agencia", String(reporte.ingresos.agencia)],
      ["Total ingresos", String(reporte.ingresos.total)],
      [],
      ["EGRESOS", ""],
      ...reporte.egresos.porCategoria.map((c) => [`  ${c.nombre}`, String(c.monto)]),
      ["Gastos", String(reporte.egresos.gastos)],
      ["Nómina pagada", String(reporte.egresos.nomina)],
      ["Total egresos", String(reporte.egresos.total)],
      [],
      ["RESULTADO", String(reporte.resultado)],
      ["Margen %", reporte.margen !== null ? String(reporte.margen) : ""],
      [],
      ["OPERACIÓN", ""],
      ["Órdenes", String(reporte.ventas.ordenes)],
      ["Piezas", String(reporte.ventas.piezas)],
      ["Ticket promedio", String(reporte.ventas.ticket)],
      ["Clientes nuevos", String(reporte.clientes.nuevos)],
      ["Pedidos entregados", String(reporte.pedidos.entregados)],
      ["Pedidos atrasados", String(reporte.pedidos.atrasados)],
      ["Productos bajo mínimo", String(reporte.inventario.bajoMinimo)],
      ["Valor del inventario", String(reporte.inventario.valorStock)],
    ];
    const csv = filas
      .map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `reporte-fresafit-${reporte.rango.desde}-a-${reporte.rango.hasta}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* Nadie ha capturado gastos ni pagos de nómina en este periodo: el "resultado"
     es en realidad el ingreso, y presentarlo como utilidad sería engañoso. */
  const sinEgresos = reporte.egresos.total === 0;
  const deltaVentas = deltaPct(reporte.ingresos.ventas, reporte.ingresos.ventasAnterior);
  const deltaGastos = deltaPct(reporte.egresos.gastos, reporte.egresos.gastosAnterior);
  const maxCanal = Math.max(1, ...reporte.ingresos.porCanal.map((c) => c.monto));
  const maxCategoria = Math.max(1, ...reporte.egresos.porCategoria.map((c) => c.monto));
  const maxProducto = Math.max(1, ...reporte.ventas.productos.map((p) => p.monto));

  return (
    <div className={cn(navegando && "opacity-60 transition-opacity")}>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Reportes</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            El cierre del negocio en el periodo que elijas, armado con lo que ya está en el CRM.
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
          <Button variant="outline" onClick={descargarCSV} className="flex-1 md:flex-none">
            <Download className="size-4" strokeWidth={2} />
            CSV
          </Button>
          <Button variant="outline" onClick={descargarPDF} className="flex-1 md:flex-none">
            <FileText className="size-4" strokeWidth={2} />
            PDF
          </Button>
        </div>
      </div>

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <RangoFechas
          desde={reporte.rango.desde}
          hasta={reporte.rango.hasta}
          onChange={(d, h) => {
            setPreset("");
            cambiarRango(d, h);
          }}
          preset={preset}
          onPreset={elegirPreset}
        />
        <p className="text-[13px] text-muted-foreground">
          Del {formatearFecha(reporte.rango.desde)} al {formatearFecha(reporte.rango.hasta)}, contra
          el {formatearFecha(reporte.comparado.desde)}–{formatearFecha(reporte.comparado.hasta)}.
        </p>
      </div>

      {sinEgresos && (
        <p className="mb-4 rounded-xl bg-amber-100 px-4 py-3 text-[13px] leading-relaxed text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <strong>En este periodo no hay gastos ni pagos de nómina capturados.</strong> Lo que
          aparece como «quedó» es en realidad todo lo que entró, no la utilidad. Para que el
          reporte sirva de cierre hay que registrar los gastos en Finanzas y marcar los pagos en
          Nómina.
        </p>
      )}

      {/* --- El titular: entró, salió, quedó --- */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard
          etiqueta="Entró"
          valor={formatearMXN(reporte.ingresos.total)}
          nota={
            reporte.ingresos.agencia > 0
              ? `incl. ${formatearMXN(reporte.ingresos.agencia)} de la agencia`
              : "ventas brutas"
          }
          icono={TrendingUp}
        />
        <StatCard
          etiqueta="Salió"
          valor={formatearMXN(reporte.egresos.total)}
          nota={`${formatearMXN(reporte.egresos.gastos)} gastos + ${formatearMXN(reporte.egresos.nomina)} nómina`}
          icono={TrendingDown}
        />
        <StatCard
          etiqueta="Quedó"
          valor={formatearMXN(reporte.resultado)}
          /* Sin egresos capturados el margen sale 100% y eso no es un resultado,
             es un dato que falta. Decirlo evita que alguien presente ese número. */
          nota={
            sinEgresos
              ? "faltan capturar los costos"
              : reporte.margen !== null
                ? `${reporte.margen.toFixed(1)}% de margen`
                : undefined
          }
          icono={Banknote}
          valorClassName={
            sinEgresos
              ? "text-muted-foreground"
              : reporte.resultado < 0
                ? "text-red-600"
                : "text-green-600"
          }
        />
        <StatCard
          etiqueta="Ventas"
          valor={formatearMXN(reporte.ingresos.ventas)}
          delta={deltaVentas}
          deltaEtiqueta="vs. periodo anterior"
          icono={Package}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* --- De dónde vino el dinero --- */}
        <Seccion titulo="De dónde vino" icono={TrendingUp}>
          <div className="flex flex-col gap-2.5">
            {reporte.ingresos.porCanal.length === 0 ? (
              <p className="text-[13.5px] italic text-muted-foreground">
                No hubo ventas en este periodo.
              </p>
            ) : (
              reporte.ingresos.porCanal.map((c) => (
                <Linea
                  key={c.clave}
                  nombre={c.nombre}
                  monto={c.monto}
                  detalle={`${c.cantidad} renglones`}
                  proporcion={c.monto / maxCanal}
                  color={obtenerCanal(c.clave)?.color ?? "#e84393"}
                />
              ))
            )}
            {reporte.ingresos.agencia > 0 && (
              <div className="mt-1 border-t pt-2.5">
                <Linea
                  nombre="Honorarios de la agencia"
                  monto={reporte.ingresos.agencia}
                  proporcion={reporte.ingresos.agencia / maxCanal}
                  color="#6c5ce7"
                />
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                  Lo que cobró la Agencia y ya se pagó. No incluye fondos delegados: ese dinero es
                  del cliente y solo pasa de largo.
                </p>
              </div>
            )}
          </div>
        </Seccion>

        {/* --- En qué se fue --- */}
        <Seccion titulo="En qué se fue" icono={TrendingDown}>
          <div className="flex flex-col gap-2.5">
            {reporte.egresos.porCategoria.length === 0 && reporte.egresos.nomina === 0 ? (
              <p className="text-[13.5px] italic text-muted-foreground">
                No hay gastos capturados en este periodo.
              </p>
            ) : (
              <>
                {reporte.egresos.porCategoria.map((c) => (
                  <Linea
                    key={c.clave}
                    nombre={c.nombre}
                    monto={c.monto}
                    detalle={`${c.cantidad}`}
                    proporcion={c.monto / maxCategoria}
                    color={obtenerCategoriaGasto(c.clave)?.color ?? "#94a3b8"}
                  />
                ))}
                {reporte.egresos.nomina > 0 && (
                  <div className="mt-1 border-t pt-2.5">
                    <Linea
                      nombre="Nómina pagada"
                      monto={reporte.egresos.nomina}
                      proporcion={reporte.egresos.nomina / Math.max(maxCategoria, reporte.egresos.nomina)}
                      color="#00b894"
                    />
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">
                      Pagos de nómina marcados como pagados dentro del periodo. Lo devengado y no
                      pagado no cuenta aquí.
                    </p>
                  </div>
                )}
              </>
            )}
            {deltaGastos !== null && (
              <p className="mt-1 text-[12.5px] text-muted-foreground">
                Los gastos {deltaGastos >= 0 ? "subieron" : "bajaron"}{" "}
                <strong>{Math.abs(deltaGastos).toFixed(1)}%</strong> contra el periodo anterior.
              </p>
            )}
          </div>
        </Seccion>

        {/* --- Qué se vendió --- */}
        <Seccion titulo="Qué se vendió" icono={Package}>
          <div className="mb-3.5 grid grid-cols-3 gap-3 border-b pb-3.5">
            <div>
              <div className="text-[11.5px] text-muted-foreground">Órdenes</div>
              <div className="text-[19px] font-bold tabular-nums">{reporte.ventas.ordenes}</div>
            </div>
            <div>
              <div className="text-[11.5px] text-muted-foreground">Piezas</div>
              <div className="text-[19px] font-bold tabular-nums">{reporte.ventas.piezas}</div>
            </div>
            <div>
              <div className="text-[11.5px] text-muted-foreground">Ticket</div>
              <div className="text-[19px] font-bold tabular-nums">
                {formatearMXN(reporte.ventas.ticket)}
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-2.5">
            {reporte.ventas.productos.length === 0 ? (
              <p className="text-[13.5px] italic text-muted-foreground">Sin productos vendidos.</p>
            ) : (
              reporte.ventas.productos.map((p) => (
                <Linea
                  key={p.nombre}
                  nombre={p.nombre}
                  monto={p.monto}
                  detalle={`${p.piezas} pz`}
                  proporcion={p.monto / maxProducto}
                />
              ))
            )}
          </div>
        </Seccion>

        {/* --- Cómo va la operación --- */}
        <Seccion titulo="Cómo va la operación" icono={Boxes}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Pedidos del periodo
              </div>
              <dl className="flex flex-col gap-1 text-[13.5px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Entregados</dt>
                  <dd className="tabular-nums">{reporte.pedidos.entregados}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Enviados</dt>
                  <dd className="tabular-nums">{reporte.pedidos.enviados}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Sin salir</dt>
                  <dd className="tabular-nums">
                    {reporte.pedidos.nuevos + reporte.pedidos.preparando}
                  </dd>
                </div>
                {reporte.pedidos.atrasados > 0 && (
                  <div className="flex justify-between gap-2 font-semibold text-red-600">
                    <dt>Atrasados</dt>
                    <dd className="tabular-nums">{reporte.pedidos.atrasados}</dd>
                  </div>
                )}
              </dl>
            </div>
            <div>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Inventario hoy
              </div>
              <dl className="flex flex-col gap-1 text-[13.5px]">
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Valor</dt>
                  <dd className="tabular-nums">
                    {reporte.inventario.valorStock > 0 ? (
                      formatearMXN(reporte.inventario.valorStock)
                    ) : (
                      /* Se calcula stock × costo, y hoy ningún producto tiene
                         costo: mejor decirlo que enseñar un $0 que parece real. */
                      <span className="text-[12px] text-muted-foreground">sin costos capturados</span>
                    )}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Productos</dt>
                  <dd className="tabular-nums">{reporte.inventario.productos}</dd>
                </div>
                <div
                  className={cn(
                    "flex justify-between gap-2",
                    reporte.inventario.bajoMinimo > 0 && "font-semibold text-amber-600",
                  )}
                >
                  <dt>Bajo mínimo</dt>
                  <dd className="tabular-nums">{reporte.inventario.bajoMinimo}</dd>
                </div>
                {reporte.inventario.sinStock > 0 && (
                  <div className="flex justify-between gap-2 font-semibold text-red-600">
                    <dt>Agotados</dt>
                    <dd className="tabular-nums">{reporte.inventario.sinStock}</dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
          <div className="mt-3.5 flex items-center gap-4 border-t pt-3 text-[13.5px]">
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Users className="size-3.5" strokeWidth={1.9} />
              {reporte.clientes.nuevos} clientes nuevos
            </span>
            <span className="text-muted-foreground">
              {reporte.clientes.conCompra} compraron en el periodo
            </span>
          </div>
          {/* El inventario es la foto de HOY: no hay historia de stock por día. */}
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            El inventario es la situación de hoy, no la del cierre del periodo: el CRM no guarda
            el stock día por día.
          </p>
        </Seccion>

        {/* --- Agencia, si hay algo que decir --- */}
        {(reporte.agencia.porCobrar > 0 || reporte.agencia.sinFacturar > 0) && (
          <Seccion titulo="Pendientes de la Agencia" icono={Banknote} className="lg:col-span-2">
            <div className="flex flex-wrap gap-6">
              {reporte.agencia.sinFacturar > 0 && (
                <div>
                  <div className="text-[11.5px] text-muted-foreground">Calculado sin facturar</div>
                  <div className="text-[19px] font-bold tabular-nums">
                    {formatearMXN(reporte.agencia.sinFacturar)}
                  </div>
                </div>
              )}
              {reporte.agencia.porCobrar > 0 && (
                <div>
                  <div className="text-[11.5px] text-muted-foreground">Facturado sin pagar</div>
                  <div className="text-[19px] font-bold tabular-nums text-amber-600">
                    {formatearMXN(reporte.agencia.porCobrar)}
                  </div>
                </div>
              )}
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              No entra en el resultado de arriba porque todavía no es dinero: solo lo pagado
              cuenta como ingreso.
            </p>
          </Seccion>
        )}
      </div>


      {/* Ancla de fecha para el nombre del archivo descargado. */}
      <span className="sr-only">{hoyISO()}</span>
    </div>
  );
}
