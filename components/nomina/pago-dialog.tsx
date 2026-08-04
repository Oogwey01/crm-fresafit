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
import { registrarPago } from "@/app/(app)/agencia/actions";
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
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Registrar pago</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Persona</Label>
            <Select value={empleadoId} onValueChange={(v) => v && setEmpleadoId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => empleados.find((e) => e.id === v)?.nombre ?? "Elegir"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {activos.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nombre}
                    {e.puesto ? ` · ${e.puesto}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {empleado && (
              <p className="text-[12px] text-muted-foreground">
                Cobra {formatearMXN(empleado.monto)}{" "}
                {empleado.periodicidad === "por_evento"
                  ? "por evento"
                  : `cada ${empleado.periodicidad === "semanal" ? "semana" : empleado.periodicidad === "mensual" ? "mes" : "quincena"}`}
                {empleado.empresa ? ` · se carga a ${empleado.empresa.nombre}` : " · Fresafit"}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pago-desde">Periodo desde</Label>
              <DatePicker
                id="pago-desde"
                value={periodo.desde}
                onChange={(v) => setPeriodo((p) => ({ ...p, desde: v }))}
                limpiable
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pago-hasta">Hasta</Label>
              <DatePicker
                id="pago-hasta"
                value={periodo.hasta}
                onChange={(v) => setPeriodo((p) => ({ ...p, hasta: v }))}
                limpiable
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pago-monto">Monto ($)</Label>
            <Input
              id="pago-monto"
              type="number"
              min="0"
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
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
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pago-fecha">Fecha de pago</Label>
                <DatePicker id="pago-fecha" value={fechaPago} onChange={setFechaPago} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="pago-metodo">Método</Label>
                <Input
                  id="pago-metodo"
                  placeholder="Transferencia, efectivo…"
                  value={metodo}
                  onChange={(e) => setMetodo(e.target.value)}
                />
              </div>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pago-comprobante">Comprobante</Label>
            <Input
              id="pago-comprobante"
              placeholder="Folio de la transferencia o enlace"
              value={comprobante}
              onChange={(e) => setComprobante(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pago-notas">Notas</Label>
            <Input id="pago-notas" value={notas} onChange={(e) => setNotas(e.target.value)} />
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar="Registrar pago"
          onGuardar={guardar}
          onCancelar={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
