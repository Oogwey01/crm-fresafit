"use client";

import { useState } from "react";
import { CalendarClock, Lock, Plus, Wallet } from "lucide-react";
import { EncabezadoSeccion } from "@/components/compartido/encabezado-seccion";
import { ListaBarras } from "@/components/compartido/lista-barras";
import { Pastilla } from "@/components/compartido/pastilla";
import { StatCard } from "@/components/compartido/stat-card";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { Button } from "@/components/ui/button";
import { CompromisoDialog } from "@/components/finanzas/compromiso-dialog";
import { obtenerCategoriaPersonal, obtenerPeriodicidadPersonal } from "@/lib/catalogos";
import { formatearFecha } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import {
  costoMensual,
  esInminente,
  proximoPago,
  repartoPorCategoria,
  siguienteCompromiso,
  totalAnual,
  totalMensual,
} from "@/lib/finanzas/personales";
import type { CompromisoPersonalInput } from "@/app/(app)/finanzas/actions";
import type { CompromisoPersonal } from "@/lib/types";

const COLS = "grid-cols-[minmax(170px,1fr)_150px_130px_120px_150px]";

/* Los tres ejemplos del estado vacío. NO son datos sembrados: solo arrancan el
   diálogo con el concepto y el ritmo ya puestos, y nada se guarda hasta que se
   le dé a «Agregar». Están porque una pantalla en blanco con un botón no dice
   qué se espera que uno escriba. */
const EJEMPLOS: { etiqueta: string; plantilla: Partial<CompromisoPersonalInput> }[] = [
  {
    etiqueta: "Luz · bimestral",
    plantilla: { concepto: "Luz", periodicidad: "bimestral", categoria: "servicios" },
  },
  {
    etiqueta: "Internet · mensual",
    plantilla: { concepto: "Internet", periodicidad: "mensual", categoria: "conectividad" },
  },
  {
    etiqueta: "Plan Telcel · mensual",
    plantilla: { concepto: "Plan Telcel", periodicidad: "mensual", categoria: "conectividad" },
  },
];

/* Los pagos fijos de quien mira, dentro de /finanzas pero en su propia tabla y
   con su propio candado (RLS por dueño, ver la migración 20261009000000). Nada
   de aquí entra en los totales del negocio: no comparte ni un reduce con el
   panel de gastos. */
export function PanelPersonales({ compromisos }: { compromisos: CompromisoPersonal[] }) {
  const [dialog, setDialog] = useState<CompromisoPersonal | "nuevo" | null>(null);
  const [plantilla, setPlantilla] = useState<Partial<CompromisoPersonalInput> | null>(null);

  const mensual = totalMensual(compromisos);
  const anual = totalAnual(compromisos);
  const siguiente = siguienteCompromiso(compromisos);
  const reparto = repartoPorCategoria(compromisos);
  const hayActivos = compromisos.some((c) => c.activo);

  function abrirNuevo(conPlantilla: Partial<CompromisoPersonalInput> | null = null) {
    setPlantilla(conPlantilla);
    setDialog("nuevo");
  }

  const columnas: Columna<CompromisoPersonal>[] = [
    {
      clave: "concepto",
      label: "Concepto",
      esTitulo: true,
      celda: (c) => (
        <button
          type="button"
          onClick={() => setDialog(c)}
          className="truncate text-left font-medium hover:underline"
          title={c.notas ?? c.concepto}
        >
          {c.concepto}
        </button>
      ),
    },
    {
      clave: "categoria",
      label: "Categoría",
      celda: (c) => {
        const cat = obtenerCategoriaPersonal(c.categoria);
        return cat ? <Pastilla nombre={cat.nombre} color={cat.color} /> : null;
      },
    },
    {
      clave: "monto",
      label: "Cada cobro",
      celda: (c) => (
        <div className="min-w-0">
          <div className="truncate tabular-nums">{formatearMXN(c.monto)}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {obtenerPeriodicidadPersonal(c.periodicidad)?.nombre ?? c.periodicidad}
          </div>
        </div>
      ),
    },
    {
      /* La columna que justifica la pantalla: todo en la misma moneda. */
      clave: "mensual",
      label: "Al mes",
      celda: (c) => (
        <div className="font-semibold tabular-nums">
          {formatearMXN(costoMensual(c.monto, c.periodicidad))}
        </div>
      ),
    },
    {
      /* Fecha solo cuando de verdad se sabe (ver proximoPago): para lo que no es
         mensual se dice el día y el ritmo, que es todo lo que hay. */
      clave: "toca",
      label: "Toca el",
      celda: (c) => {
        const fecha = proximoPago(c.dia_pago, c.periodicidad);
        if (fecha) {
          return (
            <span className={esInminente(fecha) ? "font-medium text-amber-600" : undefined}>
              {formatearFecha(fecha)}
            </span>
          );
        }
        if (!c.dia_pago) return <span className="text-muted-foreground/50">—</span>;
        const meses = obtenerPeriodicidadPersonal(c.periodicidad)?.mesesQueCubre ?? 1;
        return (
          <span className="text-[12px] text-muted-foreground">
            día {c.dia_pago} · cada {meses} meses
          </span>
        );
      },
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <EncabezadoSeccion titulo="Mis gastos fijos" className="mb-0">
          Lo que pagas tú, no la empresa: la luz, el internet, tu plan de Telcel.{" "}
          <b className="font-semibold text-foreground">Esta sección es solo tuya</b> —nadie más del
          equipo la tiene siquiera— y nada de aquí entra en los números de Fresafit.
        </EncabezadoSeccion>
        {compromisos.length > 0 && (
          <Button
            onClick={() => abrirNuevo()}
            className="h-auto w-full shrink-0 gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.1} />
            Nuevo pago fijo
          </Button>
        )}
      </div>

      {compromisos.length === 0 ? (
        /* Nace vacía. Sin tarjetas ni gráfica: un $0.00 con una barra en blanco
           se lee como pantalla rota, no como pantalla nueva. */
        <div className="flex flex-col items-start gap-3 rounded-2xl border bg-card px-5 py-6 shadow-sm">
          <div className="flex items-center gap-2">
            <Lock className="size-4 text-muted-foreground" aria-hidden="true" />
            <h3 className="text-[15px] font-semibold">Aquí llevas tus pagos fijos</h3>
          </div>
          <p className="max-w-prose text-sm leading-relaxed text-muted-foreground">
            Captura lo que pagas cada mes o cada tanto —la luz, el internet, tu plan de Telcel— y
            arriba te va a decir <b className="text-foreground">cuánto te cuesta el mes</b> con
            todo repartido: un recibo bimestral cuenta a la mitad.
          </p>
          <Button onClick={() => abrirNuevo()} className="gap-1.5">
            <Plus className="size-4" strokeWidth={2.1} />
            Agregar el primero
          </Button>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="text-[12px] text-muted-foreground">Por ejemplo:</span>
            {EJEMPLOS.map((e) => (
              <button
                key={e.etiqueta}
                type="button"
                onClick={() => abrirNuevo(e.plantilla)}
                className="rounded-full border border-dashed px-3 py-1 text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {e.etiqueta}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-3">
            <StatCard
              etiqueta="Me cuesta al mes"
              valor={formatearMXN(mensual)}
              icono={CalendarClock}
              nota={hayActivos ? "ya repartido: lo bimestral cuenta a la mitad" : "todo está dado de baja"}
              notaClassName="hidden md:block"
            />
            <StatCard
              etiqueta="Al año"
              valor={formatearMXN(anual)}
              icono={Wallet}
              nota="lo mismo × 12"
              notaClassName="hidden md:block"
            />
            <StatCard
              etiqueta="Próximo pago"
              valor={siguiente ? formatearFecha(siguiente.fecha) : "—"}
              nota={siguiente?.compromiso.concepto ?? "sin día de pago capturado"}
              valorClassName={
                siguiente && esInminente(siguiente.fecha) ? "text-amber-600" : undefined
              }
              className="col-span-2 md:col-span-1"
            />
          </div>

          {reparto.length > 0 && (
            <div className="mb-4 rounded-2xl border bg-card p-4 shadow-sm">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Reparto del gasto mensual
              </h2>
              <ListaBarras items={reparto} formatear={formatearMXN} punto />
            </div>
          )}

          <TablaSimple
            cols={COLS}
            columnas={columnas}
            datos={compromisos}
            filaKey={(c) => c.id}
            minW="min-w-[760px]"
            /* Lo dado de baja se conserva, pero atenuado: sigue en la lista y ya
               no cuenta en el total. */
            filaClassName={(c) => (c.activo ? "" : "opacity-60")}
            onRowClick={(c) => setDialog(c)}
          />
        </>
      )}

      {dialog && (
        <CompromisoDialog
          compromiso={dialog === "nuevo" ? null : dialog}
          plantilla={dialog === "nuevo" ? plantilla : null}
          onClose={() => {
            setDialog(null);
            setPlantilla(null);
          }}
        />
      )}
    </div>
  );
}
