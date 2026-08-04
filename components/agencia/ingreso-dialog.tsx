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
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { Pastilla } from "@/components/compartido/pastilla";
import {
  borrarIngreso,
  editarIngreso,
  registrarIngreso,
} from "@/app/(app)/agencia/actions";
import {
  TIPOS_INGRESO,
  nombrePeriodo,
  obtenerEstadoIngreso,
  obtenerTipoIngreso,
  type TipoIngresoId,
} from "@/lib/agencia";
import { formatearMXN } from "@/lib/moneda";
import { formatearFecha } from "@/lib/fecha";
import { aNumero } from "@/lib/validacion";
import type { AgenciaEmpresa, AgenciaIngresoConEmpresa } from "@/lib/types";

/* Alta de un cobro que NO sale de un contrato (migración de plataforma,
   comisión por referido) y edición de cualquiera.

   Los cortes de contrato no se editan de fondo: su desglose está congelado y
   rehacerlo a mano rompería la explicación del cobro. De esos solo se tocan el
   concepto, la factura y las notas. */
export function IngresoDialog({
  ingreso,
  empresas,
  onClose,
}: {
  ingreso: AgenciaIngresoConEmpresa | null; // null = alta
  empresas: AgenciaEmpresa[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const esCorte = ingreso?.tipo === "contrato";

  const [tipo, setTipo] = useState<TipoIngresoId>(ingreso?.tipo ?? "migracion");
  const [empresaId, setEmpresaId] = useState<string>(ingreso?.empresa_id ?? "");
  const [concepto, setConcepto] = useState(ingreso?.concepto ?? "");
  const [total, setTotal] = useState(ingreso ? String(ingreso.total) : "");
  const [socio, setSocio] = useState(ingreso?.socio ?? "");
  const [factura, setFactura] = useState(ingreso?.factura ?? "");
  const [notas, setNotas] = useState(ingreso?.notas ?? "");

  const estado = ingreso ? obtenerEstadoIngreso(ingreso.estado) : null;

  function guardar() {
    const monto = Math.max(0, aNumero(total) ?? 0);
    if (ingreso) {
      ejecutar(
        () =>
          editarIngreso(ingreso.id, {
            concepto,
            /* Un corte conserva su monto calculado: cambiarlo aquí dejaría el
               desglose sin cuadrar con el total. */
            ...(esCorte ? {} : { total: monto }),
            factura,
            notas,
          }),
        { ok: "Cobro actualizado.", error: "No se pudo guardar.", alExito: onClose },
      );
      return;
    }
    ejecutar(
      () =>
        registrarIngreso({
          empresa_id: empresaId || null,
          tipo,
          concepto,
          total: monto,
          socio,
          notas,
        }),
      { ok: "Cobro registrado.", error: "No se pudo guardar.", alExito: onClose },
    );
  }

  function borrar() {
    if (!ingreso) return;
    ejecutar(() => borrarIngreso(ingreso.id), {
      confirmar: "¿Borrar este cobro? No se puede deshacer.",
      ok: "Cobro borrado.",
      error: "No se pudo borrar.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {ingreso ? (esCorte ? "Corte de contrato" : "Editar cobro") : "Nuevo cobro"}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* Un corte se muestra explicado, no editable: es el resultado de una
              fórmula con datos de su momento. */}
          {esCorte && ingreso && (
            <div className="rounded-xl border bg-muted/40 px-4 py-3 text-[13px]">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                {ingreso.empresa && (
                  <Pastilla nombre={ingreso.empresa.nombre} color={ingreso.empresa.color} />
                )}
                {estado && <Pastilla nombre={estado.nombre} color={estado.color} />}
                {ingreso.periodo_desde && ingreso.periodo_hasta && (
                  <span className="text-muted-foreground">
                    {nombrePeriodo(ingreso.periodo_desde, ingreso.periodo_hasta)}
                  </span>
                )}
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Ventas capturadas</span>
                <span className="tabular-nums">{formatearMXN(ingreso.ventas_base)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">Fijo</span>
                <span className="tabular-nums">{formatearMXN(ingreso.monto_fijo)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-muted-foreground">{ingreso.porcentaje}% variable</span>
                <span className="tabular-nums">{formatearMXN(ingreso.monto_variable)}</span>
              </div>
              {ingreso.fondo_delegado > 0 && (
                <div className="flex justify-between gap-3">
                  <span className="text-muted-foreground">Fondo delegado</span>
                  <span className="tabular-nums">{formatearMXN(ingreso.fondo_delegado)}</span>
                </div>
              )}
              <div className="mt-1.5 flex justify-between gap-3 border-t pt-1.5 font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatearMXN(ingreso.total)}</span>
              </div>
              {ingreso.ventas_nota && (
                <p className="mt-2 text-[12px] italic text-muted-foreground">
                  Origen del dato: {ingreso.ventas_nota}
                </p>
              )}
              {ingreso.cobrado_at && (
                <p className="mt-1 text-[12px] text-muted-foreground">
                  Facturado el {formatearFecha(ingreso.cobrado_at.slice(0, 10))}
                  {ingreso.pagado_at
                    ? ` · pagado el ${formatearFecha(ingreso.pagado_at.slice(0, 10))}`
                    : ""}
                </p>
              )}
            </div>
          )}

          {!ingreso && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>Tipo de cobro</Label>
                <Select value={tipo} onValueChange={(v) => v && setTipo(v as TipoIngresoId)}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string) => obtenerTipoIngreso(v)?.nombre ?? "Tipo"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {TIPOS_INGRESO.filter((t) => t.id !== "contrato").map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Los cortes de contrato se crean con «Calcular corte», para que quede el
                  desglose de cómo se llegó al monto.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label>Empresa (opcional)</Label>
                <Select value={empresaId} onValueChange={(v) => setEmpresaId(v ?? "")}>
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string) =>
                        empresas.find((e) => e.id === v)?.nombre ?? "Sin empresa"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Sin empresa</SelectItem>
                    {empresas.map((e) => (
                      <SelectItem key={e.id} value={e.id}>
                        {e.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ing-concepto">Concepto</Label>
            <Input
              id="ing-concepto"
              autoFocus={!ingreso}
              placeholder="Migración de Shopify a Tienda Nube, comisión del contador…"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
            />
          </div>

          {!esCorte && (
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="ing-total">Monto ($)</Label>
                <Input
                  id="ing-total"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="0.00"
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                />
              </div>
              {!ingreso && (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="ing-socio">Con quién</Label>
                  <Input
                    id="ing-socio"
                    placeholder="Contador, Kubo, Revie…"
                    value={socio}
                    onChange={(e) => setSocio(e.target.value)}
                  />
                </div>
              )}
            </div>
          )}

          {ingreso && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ing-factura">Factura</Label>
              <Input
                id="ing-factura"
                placeholder="Folio o enlace"
                value={factura}
                onChange={(e) => setFactura(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ing-notas">Notas</Label>
            <Textarea
              id="ing-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={ingreso ? "Guardar cambios" : "Registrar cobro"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={ingreso ? borrar : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
