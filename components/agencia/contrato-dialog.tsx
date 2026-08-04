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
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/compartido/date-picker";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  BASES_CALCULO,
  PERIODICIDADES,
  PLATAFORMAS_AGENCIA,
  calcularCorte,
  obtenerBaseCalculo,
} from "@/lib/agencia";
import { formatearMXN } from "@/lib/moneda";
import { aNumero } from "@/lib/validacion";
import {
  crearContrato,
  editarContrato,
  borrarContrato,
  type ContratoInput,
} from "@/app/(app)/agencia/actions";
import type { AgenciaContrato, AgenciaEmpresa } from "@/lib/types";

/* Venta de ejemplo para la vista previa. No es un dato del contrato: sirve para
   ver la fórmula aplicada a un número y detectar un porcentaje mal tecleado
   antes de guardarlo. */
const VENTA_EJEMPLO = 100000;

export function ContratoDialog({
  empresa,
  contrato,
  onClose,
}: {
  empresa: AgenciaEmpresa;
  contrato: AgenciaContrato | null; // null = alta
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [nombre, setNombre] = useState(contrato?.nombre ?? "Contrato mensual");
  const [montoFijo, setMontoFijo] = useState(String(contrato?.monto_fijo ?? ""));
  const [porcentaje, setPorcentaje] = useState(String(contrato?.porcentaje ?? ""));
  const [base, setBase] = useState<string>(contrato?.base_calculo ?? "ventas_brutas");
  const [plataforma, setPlataforma] = useState<string>(contrato?.plataforma ?? "otro");
  const [diaCorte, setDiaCorte] = useState(String(contrato?.dia_corte ?? 1));
  const [periodicidad, setPeriodicidad] = useState<"mensual" | "quincenal">(
    contrato?.periodicidad ?? "mensual",
  );
  const [fondo, setFondo] = useState(String(contrato?.fondo_delegado ?? ""));
  const [inicio, setInicio] = useState(contrato?.inicio ?? "");
  const [fin, setFin] = useState(contrato?.fin ?? "");
  const [activo, setActivo] = useState(contrato?.activo ?? true);
  const [notas, setNotas] = useState(contrato?.notas ?? "");

  const num = (s: string) => Math.max(0, aNumero(s) ?? 0);
  const vistaPrevia = calcularCorte(
    { monto_fijo: num(montoFijo), porcentaje: num(porcentaje), fondo_delegado: num(fondo) },
    VENTA_EJEMPLO,
  );

  function guardar() {
    const input: ContratoInput = {
      empresa_id: empresa.id,
      nombre,
      monto_fijo: num(montoFijo),
      porcentaje: num(porcentaje),
      base_calculo: base,
      plataforma,
      dia_corte: Math.trunc(num(diaCorte)) || 1,
      periodicidad,
      fondo_delegado: num(fondo),
      inicio: inicio || null,
      fin: fin || null,
      activo,
      notas,
    };
    ejecutar(() => (contrato ? editarContrato(contrato.id, input) : crearContrato(input)), {
      ok: contrato ? "Contrato actualizado." : "Contrato creado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!contrato) return;
    ejecutar(() => borrarContrato(contrato.id), {
      confirmar:
        "¿Borrar este contrato? Los cobros que ya se calcularon se quedan, pero pierden la referencia a su regla.",
      ok: "Contrato borrado.",
      error: "No se pudo borrar.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {contrato ? "Editar contrato" : "Nuevo contrato"} · {empresa.nombre}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="con-nombre">Nombre del contrato</Label>
            <Input
              id="con-nombre"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Contrato mensual"
            />
          </div>

          {/* La fórmula: fijo + % sobre una base */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="con-fijo">Fijo al mes ($)</Label>
              <Input
                id="con-fijo"
                type="number"
                min="0"
                step="0.01"
                placeholder="40000"
                value={montoFijo}
                onChange={(e) => setMontoFijo(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="con-pct">Porcentaje (%)</Label>
              <Input
                id="con-pct"
                type="number"
                min="0"
                max="100"
                step="0.001"
                placeholder="4"
                value={porcentaje}
                onChange={(e) => setPorcentaje(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>El porcentaje se aplica sobre</Label>
            <Select value={base} onValueChange={(v) => v && setBase(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => BASES_CALCULO.find((b) => b.id === v)?.nombre ?? "Base"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {BASES_CALCULO.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* La definición exacta es lo que evita la discusión al cerrar el mes. */}
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {obtenerBaseCalculo(base)?.desc}
            </p>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Plataforma</Label>
              <Select value={plataforma} onValueChange={(v) => v && setPlataforma(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      PLATAFORMAS_AGENCIA.find((p) => p.id === v)?.nombre ?? "Plataforma"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PLATAFORMAS_AGENCIA.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Periodicidad</Label>
              <Select
                value={periodicidad}
                onValueChange={(v) => v && setPeriodicidad(v as "mensual" | "quincenal")}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => PERIODICIDADES.find((p) => p.id === v)?.nombre ?? "—"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PERIODICIDADES.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="con-dia">Día de corte</Label>
              <Input
                id="con-dia"
                type="number"
                min="1"
                max="28"
                step="1"
                value={diaCorte}
                onChange={(e) => setDiaCorte(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="con-fondo">Fondo delegado ($ al mes)</Label>
            <Input
              id="con-fondo"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={fondo}
              onChange={(e) => setFondo(e.target.value)}
            />
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Dinero del cliente que pasa por la agencia para pagar a terceros (el personal de
              sus lives, por ejemplo). Se le cobra pero <strong>no cuenta como ingreso</strong>.
            </p>
          </div>

          {/* Vista previa: la fórmula aplicada a un número redondo. */}
          <div className="rounded-xl border bg-muted/40 px-4 py-3 text-[13px]">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Con {formatearMXN(VENTA_EJEMPLO)} de venta en el periodo
            </div>
            <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="tabular-nums">{formatearMXN(vistaPrevia.monto_fijo)} fijo</span>
              <span className="text-muted-foreground">+</span>
              <span className="tabular-nums">
                {formatearMXN(vistaPrevia.monto_variable)} variable
              </span>
              <span className="text-muted-foreground">=</span>
              <span className="text-[16px] font-bold tabular-nums">
                {formatearMXN(vistaPrevia.honorarios)}
              </span>
              <span className="text-muted-foreground">de honorarios</span>
            </div>
            {vistaPrevia.fondo_delegado > 0 && (
              <div className="mt-1 text-muted-foreground">
                Se le cobran {formatearMXN(vistaPrevia.total)} contando el fondo delegado.
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="con-inicio">Inicio</Label>
              <DatePicker id="con-inicio" value={inicio} onChange={setInicio} limpiable />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="con-fin">Fin (si lo tiene)</Label>
              <DatePicker id="con-fin" value={fin} onChange={setFin} limpiable />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              Contrato vigente
              <span className="block text-[12.5px] leading-relaxed text-muted-foreground">
                Solo los vigentes cuentan en el fijo mensual y aparecen para calcular cortes.
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="con-notas">Notas del acuerdo</Label>
            <Textarea
              id="con-notas"
              rows={2}
              placeholder="Qué se descuenta, qué incluye, cómo se factura…"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={contrato ? "Guardar cambios" : "Crear contrato"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={contrato ? borrar : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
