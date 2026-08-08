"use client";

import { useState } from "react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import {
  PastillaDato,
  PastillaFecha,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import { Input } from "@/components/ui/input";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { calcularCorteContrato } from "@/app/(app)/agencia/actions";
import {
  calcularCorte,
  nombrePeriodo,
  obtenerBaseCalculo,
  obtenerPlataformaAgencia,
  periodoDeCorte,
} from "@/lib/agencia";
import { hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import { aNumero } from "@/lib/validacion";
import type { AgenciaContrato, AgenciaEmpresa, AgenciaIngresoConEmpresa } from "@/lib/types";

/* ============================================================================
   Cerrar el periodo de un contrato.
   ----------------------------------------------------------------------------
   El CRM no lee las ventas del cliente (su Shopify y su TikTok Shop son cuentas
   ajenas), así que el número se captura aquí y el CRM hace la aritmética. El
   periodo lo propone él a partir del día de corte del contrato: eso es lo que
   evita el error clásico de cobrar dos veces el mismo mes o saltarse uno.
   ============================================================================ */
export function CorteDialog({
  contratos,
  empresas,
  ingresos,
  onClose,
}: {
  contratos: AgenciaContrato[];
  empresas: AgenciaEmpresa[];
  ingresos: AgenciaIngresoConEmpresa[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [contratoId, setContratoId] = useState(contratos[0]?.id ?? "");
  const contrato = contratos.find((c) => c.id === contratoId) ?? null;

  /* Periodo propuesto por el contrato elegido; se puede corregir a mano si el
     mes se cerró tarde. */
  const propuesto = contrato
    ? periodoDeCorte(contrato.dia_corte, contrato.periodicidad, hoyISO())
    : { desde: "", hasta: "" };
  const [periodo, setPeriodo] = useState(propuesto);
  const [contratoUsado, setContratoUsado] = useState(contratoId);
  /* Al cambiar de contrato, el periodo tiene que seguirle: cada uno cierra en su
     propio día. Se recalcula en render en vez de en un efecto para no pintar un
     periodo equivocado durante un frame. */
  if (contratoUsado !== contratoId && contrato) {
    setContratoUsado(contratoId);
    setPeriodo(periodoDeCorte(contrato.dia_corte, contrato.periodicidad, hoyISO()));
  }

  const [ventas, setVentas] = useState("");
  const [nota, setNota] = useState("");

  const empresa = empresas.find((e) => e.id === contrato?.empresa_id) ?? null;
  const base = contrato ? obtenerBaseCalculo(contrato.base_calculo) : null;
  const plataforma = contrato ? obtenerPlataformaAgencia(contrato.plataforma) : null;
  const ventasNum = Math.max(0, aNumero(ventas) ?? 0);

  const desglose = contrato
    ? calcularCorte(
        {
          monto_fijo: contrato.monto_fijo,
          porcentaje: contrato.porcentaje,
          fondo_delegado: contrato.fondo_delegado,
        },
        ventasNum,
      )
    : null;

  const opcionesContrato = contratos.map((c) => {
    const e = empresas.find((x) => x.id === c.empresa_id);
    return { id: c.id, nombre: `${e?.nombre ?? "?"} · ${c.nombre}` };
  });

  /* Aviso temprano si ese periodo ya se cobró. La base lo impide con un índice
     único, pero enterarse antes de teclear el monto es mejor que después. */
  const yaExiste = ingresos.some(
    (i) =>
      i.contrato_id === contratoId &&
      i.periodo_desde === periodo.desde &&
      i.periodo_hasta === periodo.hasta,
  );

  function guardar() {
    if (!contrato) return;
    ejecutar(
      () =>
        calcularCorteContrato({
          contrato_id: contrato.id,
          periodo_desde: periodo.desde,
          periodo_hasta: periodo.hasta,
          ventas_base: ventasNum,
          ventas_nota: nota,
        }),
      {
        ok: "Corte calculado.",
        error: "No se pudo calcular. Revisa tu conexión.",
        alExito: onClose,
      },
    );
  }

  return (
    <DialogoFormulario
      titulo="Calcular corte"
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar="Calcular corte"
      pending={pending}
    >
      <Hero pasoTitulo="¿De qué contrato y cuánto se vendió?">
        {/* El contrato primero, como pastillita sobre el hero: de él cuelgan el
            periodo propuesto y la fórmula del corte. */}
        <div className="md:mb-1">
          <PastillaOpcion
            etiqueta="Contrato"
            opciones={opcionesContrato}
            valor={contratoId}
            onCambio={(v) => v && setContratoId(v)}
            buscable
          />
        </div>

        {contrato && (
          <>
            <Campo
              etiqueta={`${base?.nombre ?? "Ventas"} del periodo${plataforma ? ` en ${plataforma.nombre}` : ""} ($)`}
              htmlFor="corte-ventas"
              ayuda={base?.desc}
            >
              <div className="flex items-baseline gap-1">
                <span className="text-lg font-semibold md:text-xl" aria-hidden="true">
                  $
                </span>
                <input
                  id="corte-ventas"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  autoFocus
                  placeholder="0.00"
                  value={ventas}
                  onChange={(e) => setVentas(e.target.value)}
                  className="w-full border-0 bg-transparent px-0 text-lg font-semibold outline-none placeholder:text-muted-foreground/50 md:text-xl"
                />
              </div>
            </Campo>

            <Campo
              etiqueta="De dónde salió el número"
              htmlFor="corte-nota"
              ayuda="El CRM no lee las ventas del cliente. Dejar escrito de dónde se sacó es lo que permite reconstruir el cobro si alguien lo cuestiona meses después."
            >
              <Input
                id="corte-nota"
                placeholder="Panel de Shopify, reporte del 1 de agosto…"
                value={nota}
                onChange={(e) => setNota(e.target.value)}
              />
            </Campo>
          </>
        )}
      </Hero>

      {contrato && (
        <Propiedades
          pasoTitulo="El periodo"
          pasoAyuda={`Propuesto por el contrato, que cierra el día ${contrato.dia_corte}. Cámbialo si este mes se cerró en otra fecha.`}
        >
          <PastillaFecha
            etiqueta="Periodo desde"
            etiquetaVacia="Desde"
            valor={periodo.desde}
            onCambio={(v) => setPeriodo((p) => ({ ...p, desde: v }))}
          />
          <PastillaFecha
            etiqueta="Hasta"
            etiquetaVacia="Hasta"
            valor={periodo.hasta}
            onCambio={(v) => setPeriodo((p) => ({ ...p, hasta: v }))}
          />
          {/* En el teléfono este renglón ya lo dice pasoAyuda. */}
          <p className="hidden w-full text-[12px] text-muted-foreground md:block">
            Propuesto por el contrato, que cierra el día {contrato.dia_corte}. Cámbialo si
            este mes se cerró en otra fecha.
          </p>

          {yaExiste && (
            <p className="w-full rounded-lg bg-amber-100 px-3 py-2 text-[12.5px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
              Ya hay un cobro de {empresa?.nombre} para{" "}
              {nombrePeriodo(periodo.desde, periodo.hasta)}. Guardarlo otra vez va a fallar:
              busca el que existe en la lista.
            </p>
          )}
        </Propiedades>
      )}

      {/* El resultado, desglosado como se le va a explicar al cliente. En
          escritorio son datos de solo lectura (pastillas grises); en el
          teléfono se conserva la cajita del desglose. */}
      {contrato && desglose && (
        <Propiedades
          pasoTitulo="El resultado"
          pasoAyuda="Desglosado como se le va a explicar al cliente."
        >
          <div className="w-full md:hidden">
            <div className="rounded-xl border bg-muted/40 px-4 py-3 text-[13px]">
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Fijo del periodo</span>
                <span className="tabular-nums">{formatearMXN(desglose.monto_fijo)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">
                  {contrato.porcentaje}% de {formatearMXN(ventasNum)}
                </span>
                <span className="tabular-nums">{formatearMXN(desglose.monto_variable)}</span>
              </div>
              <div className="mt-1.5 flex justify-between gap-3 border-t pt-1.5 font-semibold">
                <span>Honorarios</span>
                <span className="tabular-nums">{formatearMXN(desglose.honorarios)}</span>
              </div>
              {desglose.fondo_delegado > 0 && (
                <>
                  <div className="mt-1.5 flex justify-between gap-3 text-muted-foreground">
                    <span>Fondo delegado (no es ingreso)</span>
                    <span className="tabular-nums">
                      {formatearMXN(desglose.fondo_delegado)}
                    </span>
                  </div>
                  <div className="mt-1.5 flex justify-between gap-3 border-t pt-1.5 text-[15px] font-bold">
                    <span>Se le cobra</span>
                    <span className="tabular-nums">{formatearMXN(desglose.total)}</span>
                  </div>
                </>
              )}
            </div>
          </div>

          <PastillaDato
            etiqueta="Fijo del periodo"
            valor={`Fijo ${formatearMXN(desglose.monto_fijo)}`}
          />
          <PastillaDato
            etiqueta={`${contrato.porcentaje}% de ${formatearMXN(ventasNum)}`}
            valor={`${contrato.porcentaje}% ${formatearMXN(desglose.monto_variable)}`}
          />
          <PastillaDato
            etiqueta="Honorarios"
            valor={`Honorarios ${formatearMXN(desglose.honorarios)}`}
          />
          {desglose.fondo_delegado > 0 && (
            <>
              <PastillaDato
                etiqueta="Fondo delegado (no es ingreso)"
                valor={`Fondo ${formatearMXN(desglose.fondo_delegado)}`}
              />
              <PastillaDato
                etiqueta="Se le cobra"
                valor={`Se le cobra ${formatearMXN(desglose.total)}`}
              />
            </>
          )}
        </Propiedades>
      )}
    </DialogoFormulario>
  );
}
