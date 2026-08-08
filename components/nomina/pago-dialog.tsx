"use client";

import { useState } from "react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import {
  PastillaEntrada,
  PastillaFecha,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { registrarPago } from "@/app/(app)/nomina/actions";
import { periodoDeCorte } from "@/lib/agencia";
import { hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import { aNumero } from "@/lib/validacion";
import type { NominaEmpleadoConEmpresa } from "@/lib/types";

/* Registrar un pago de nómina. El periodo y el monto se proponen a partir del
   esquema de la persona: en el caso normal —el sueldo de siempre en la quincena
   de siempre— no hay nada que teclear. */
export function PagoDialog({
  empleados,
  preseleccionado,
  onClose,
}: {
  empleados: NominaEmpleadoConEmpresa[];
  preseleccionado: NominaEmpleadoConEmpresa | null;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const activos = empleados.filter((e) => e.activo);
  const [empleadoId, setEmpleadoId] = useState(preseleccionado?.id ?? activos[0]?.id ?? "");
  const empleado = empleados.find((e) => e.id === empleadoId) ?? null;

  const proponer = (e: NominaEmpleadoConEmpresa | null) =>
    e
      ? periodoDeCorte(
          e.dia_corte ?? 15,
          e.periodicidad === "mensual" ? "mensual" : "quincenal",
          hoyISO(),
        )
      : { desde: "", hasta: "" };

  const [periodo, setPeriodo] = useState(() => proponer(preseleccionado ?? activos[0] ?? null));
  const [monto, setMonto] = useState(
    String((preseleccionado ?? activos[0])?.monto ?? ""),
  );
  const [pagado, setPagado] = useState(true);
  const [fechaPago, setFechaPago] = useState(hoyISO());
  const [metodo, setMetodo] = useState("");
  const [comprobante, setComprobante] = useState("");
  const [notas, setNotas] = useState("");

  /* Cambiar de persona arrastra su periodo y su monto: son datos suyos, no del
     formulario. Se recalcula en render para no pintar un frame con los del
     empleado anterior. */
  const [usado, setUsado] = useState(empleadoId);
  if (usado !== empleadoId && empleado) {
    setUsado(empleadoId);
    setPeriodo(proponer(empleado));
    setMonto(String(empleado.monto ?? ""));
  }

  const opcionesEmpleado = activos.map((e) => ({
    id: e.id,
    nombre: `${e.nombre}${e.puesto ? ` · ${e.puesto}` : ""}`,
  }));

  function guardar() {
    if (!empleado) return;
    ejecutar(
      () =>
        registrarPago({
          empleado_id: empleado.id,
          periodo_desde: periodo.desde || null,
          periodo_hasta: periodo.hasta || null,
          monto: Math.max(0, aNumero(monto) ?? 0),
          estado: pagado ? "pagado" : "pendiente",
          fecha_pago: pagado ? fechaPago || null : null,
          metodo,
          comprobante,
          notas,
        }),
      {
        ok: pagado ? "Pago registrado." : "Pago pendiente registrado.",
        error: "No se pudo guardar. Revisa tu conexión.",
        alExito: onClose,
      },
    );
  }

  return (
    <DialogoFormulario
      titulo="Registrar pago"
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar="Registrar pago"
      pending={pending}
    >
      <Hero pasoTitulo="¿A quién y cuánto?">
        {/* La persona va primero, como pastillita sobre el monto: de su esquema
            cuelga todo lo demás (periodo y monto propuestos). */}
        <div className="md:mb-1">
          <PastillaOpcion
            etiqueta="Persona"
            opciones={opcionesEmpleado}
            valor={empleadoId}
            onCambio={(v) => v && setEmpleadoId(v)}
            buscable
          />
        </div>

        {/* El monto protagonista, autoprellenado con el sueldo de la persona. */}
        <div className="flex items-baseline gap-1">
          <span className="text-lg font-semibold md:text-xl" aria-hidden="true">
            $
          </span>
          <input
            id="pago-monto"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            aria-label="Monto"
            placeholder="0.00"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="w-full border-0 bg-transparent px-0 text-lg font-semibold outline-none placeholder:text-muted-foreground/50 md:text-xl"
          />
        </div>

        {empleado && (
          <p className="text-[12px] text-muted-foreground">
            Cobra {formatearMXN(empleado.monto)}{" "}
            {empleado.periodicidad === "por_evento"
              ? "por evento"
              : `cada ${empleado.periodicidad === "semanal" ? "semana" : empleado.periodicidad === "mensual" ? "mes" : "quincena"}`}
            {empleado.empresa ? ` · se carga a ${empleado.empresa.nombre}` : " · Fresafit"}
          </p>
        )}
      </Hero>

      <Propiedades
        pasoTitulo="¿De qué periodo?"
        pasoAyuda="Propuesto por el esquema de la persona; cámbialo si aplica."
      >
        <PastillaFecha
          etiqueta="Periodo desde"
          etiquetaVacia="Desde"
          valor={periodo.desde}
          onCambio={(v) => setPeriodo((p) => ({ ...p, desde: v }))}
          limpiable
        />
        <PastillaFecha
          etiqueta="Hasta"
          etiquetaVacia="Hasta"
          valor={periodo.hasta}
          onCambio={(v) => setPeriodo((p) => ({ ...p, hasta: v }))}
          limpiable
        />
      </Propiedades>

      <Propiedades pasoTitulo="El pago">
        <label className="flex w-full items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={pagado}
            onChange={(e) => setPagado(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Ya se pagó
            <span className="block text-[12.5px] leading-relaxed text-muted-foreground">
              Apágalo para dejarlo como pendiente y que salga en «Por pagar».
            </span>
          </span>
        </label>

        {pagado && (
          <>
            <PastillaFecha
              etiqueta="Fecha de pago"
              etiquetaVacia="Fecha de pago"
              valor={fechaPago}
              onCambio={setFechaPago}
            />
            <PastillaEntrada
              etiqueta="Método"
              valor={metodo}
              onCambio={setMetodo}
              placeholder="Transferencia, efectivo…"
              idMovil="pago-metodo"
            />
          </>
        )}

        <PastillaEntrada
          etiqueta="Comprobante"
          valor={comprobante}
          onCambio={setComprobante}
          placeholder="Folio de la transferencia o enlace"
          opcional
          idMovil="pago-comprobante"
        />
        <PastillaEntrada
          etiqueta="Notas"
          valor={notas}
          onCambio={setNotas}
          opcional
          idMovil="pago-notas"
        />
      </Propiedades>
    </DialogoFormulario>
  );
}
