"use client";

import { useState } from "react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaEntrada,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
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
  type TipoIngresoId,
} from "@/lib/agencia";
import { formatearMXN } from "@/lib/moneda";
import { formatearFecha } from "@/lib/fecha";
import { aNumero } from "@/lib/validacion";
import type { AgenciaEmpresa, AgenciaIngresoConEmpresa } from "@/lib/types";

const SIN_EMPRESA = "";

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
  const [empresaId, setEmpresaId] = useState<string>(ingreso?.empresa_id ?? SIN_EMPRESA);
  const [concepto, setConcepto] = useState(ingreso?.concepto ?? "");
  const [total, setTotal] = useState(ingreso ? String(ingreso.total) : "");
  const [socio, setSocio] = useState(ingreso?.socio ?? "");
  const [factura, setFactura] = useState(ingreso?.factura ?? "");
  const [notas, setNotas] = useState(ingreso?.notas ?? "");

  const estado = ingreso ? obtenerEstadoIngreso(ingreso.estado) : null;

  const opcionesEmpresa = [
    { id: SIN_EMPRESA, nombre: "Sin empresa" },
    ...empresas.map((e) => ({ id: e.id, nombre: e.nombre, color: e.color })),
  ];

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
    <DialogoFormulario
      titulo={ingreso ? (esCorte ? "Corte de contrato" : "Editar cobro") : "Nuevo cobro"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={ingreso ? "Guardar cambios" : "Registrar cobro"}
      pending={pending}
      onBorrar={ingreso ? borrar : undefined}
    >
      <Hero pasoTitulo={esCorte ? "El corte, explicado" : "¿Qué se cobró?"}>
        {/* Un corte se muestra explicado, no editable: es el resultado de una
            fórmula con datos de su momento. */}
        {esCorte && ingreso && (
          <div className="rounded-xl border bg-muted/40 px-4 py-3 text-[13px] md:mb-2">
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

        <CampoHero
          id="ing-concepto"
          etiqueta="Concepto"
          placeholder="Migración de Shopify a Tienda Nube, comisión del contador…"
          valor={concepto}
          onCambio={setConcepto}
        />

        {/* El monto protagonista, grande y sin caja. Un corte no lo enseña
            editable: conserva su monto calculado. */}
        {!esCorte && (
          <div className="flex items-baseline gap-1">
            <span className="text-lg font-semibold md:text-xl" aria-hidden="true">
              $
            </span>
            <input
              id="ing-total"
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              aria-label="Monto"
              placeholder="0.00"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
              className="w-full border-0 bg-transparent px-0 text-lg font-semibold outline-none placeholder:text-muted-foreground/50 md:text-xl"
            />
          </div>
        )}

        <DescripcionHero
          id="ing-notas"
          etiqueta="Notas"
          placeholder="Detalles, contexto… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades pasoTitulo={ingreso ? "La factura" : "¿De qué tipo y con quién?"}>
        {!ingreso && (
          <>
            <PastillaOpcion<TipoIngresoId>
              etiqueta="Tipo de cobro"
              opciones={TIPOS_INGRESO.filter((t) => t.id !== "contrato")}
              valor={tipo}
              onCambio={setTipo}
              ayuda="Los cortes de contrato se crean con «Calcular corte», para que quede el desglose de cómo se llegó al monto."
            />
            <PastillaOpcion
              etiqueta="Empresa"
              opciones={opcionesEmpresa}
              valor={empresaId}
              onCambio={setEmpresaId}
            />
            <PastillaEntrada
              etiqueta="Con quién"
              valor={socio}
              onCambio={setSocio}
              placeholder="Contador, Kubo, Revie…"
              idMovil="ing-socio"
            />
          </>
        )}

        {ingreso && (
          <PastillaEntrada
            etiqueta="Factura"
            valor={factura}
            onCambio={setFactura}
            placeholder="Folio o enlace"
            opcional
            idMovil="ing-factura"
          />
        )}
      </Propiedades>
    </DialogoFormulario>
  );
}
