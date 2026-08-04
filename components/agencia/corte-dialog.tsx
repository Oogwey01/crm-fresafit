"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/compartido/date-picker";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
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
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Calcular corte</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Contrato</Label>
            <Select value={contratoId} onValueChange={(v) => v && setContratoId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => {
                    const c = contratos.find((x) => x.id === v);
                    const e = empresas.find((x) => x.id === c?.empresa_id);
                    return c ? `${e?.nombre ?? "?"} · ${c.nombre}` : "Elegir contrato";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {contratos.map((c) => {
                  const e = empresas.find((x) => x.id === c.empresa_id);
                  return (
                    <SelectItem key={c.id} value={c.id}>
                      {e?.nombre ?? "?"} · {c.nombre}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {contrato && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="corte-desde">Periodo desde</Label>
                  <DatePicker
                    id="corte-desde"
                    value={periodo.desde}
                    onChange={(v) => setPeriodo((p) => ({ ...p, desde: v }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="corte-hasta">Hasta</Label>
                  <DatePicker
                    id="corte-hasta"
                    value={periodo.hasta}
                    onChange={(v) => setPeriodo((p) => ({ ...p, hasta: v }))}
                  />
                </div>
              </div>
              <p className="-mt-1 text-[12px] text-muted-foreground">
                Propuesto por el contrato, que cierra el día {contrato.dia_corte}. Cámbialo si
                este mes se cerró en otra fecha.
              </p>

              {yaExiste && (
                <p className="rounded-lg bg-amber-100 px-3 py-2 text-[12.5px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                  Ya hay un cobro de {empresa?.nombre} para{" "}
                  {nombrePeriodo(periodo.desde, periodo.hasta)}. Guardarlo otra vez va a fallar:
                  busca el que existe en la lista.
                </p>
              )}

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="corte-ventas">
                  {base?.nombre ?? "Ventas"} del periodo{plataforma ? ` en ${plataforma.nombre}` : ""} ($)
                </Label>
                <Input
                  id="corte-ventas"
                  type="number"
                  min="0"
                  step="0.01"
                  autoFocus
                  placeholder="0.00"
                  value={ventas}
                  onChange={(e) => setVentas(e.target.value)}
                />
                <p className="text-[12px] leading-relaxed text-muted-foreground">{base?.desc}</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="corte-nota">De dónde salió el número</Label>
                <Input
                  id="corte-nota"
                  placeholder="Panel de Shopify, reporte del 1 de agosto…"
                  value={nota}
                  onChange={(e) => setNota(e.target.value)}
                />
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  El CRM no lee las ventas del cliente. Dejar escrito de dónde se sacó es lo que
                  permite reconstruir el cobro si alguien lo cuestiona meses después.
                </p>
              </div>

              {/* El resultado, desglosado como se le va a explicar al cliente. */}
              {desglose && (
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
              )}
            </>
          )}
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar="Calcular corte"
          onGuardar={guardar}
          onCancelar={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
