"use client";

import { useState } from "react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
  SeccionFormulario,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero } from "@/components/compartido/campo-hero";
import {
  PastillaDato,
  PastillaEntrada,
  PastillaFecha,
  PastillaInterruptor,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

  const hayFondoONotas = num(fondo) > 0 || Boolean(notas.trim());

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
    <DialogoFormulario
      titulo={`${contrato ? "Editar contrato" : "Nuevo contrato"} · ${empresa.nombre}`}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={contrato ? "Guardar cambios" : "Crear contrato"}
      pending={pending}
      onBorrar={contrato ? borrar : undefined}
    >
      <Hero pasoTitulo="¿Qué contrato es?">
        {/* La empresa ya viene decidida: se enseña como dato, no se elige. */}
        <div className="md:mb-1">
          <PastillaDato
            etiqueta="Empresa"
            valor={
              <span className="flex items-center gap-1.5">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: empresa.color }}
                  aria-hidden="true"
                />
                {empresa.nombre}
              </span>
            }
          />
        </div>
        <CampoHero
          id="con-nombre"
          etiqueta="Nombre del contrato"
          placeholder="Contrato mensual"
          valor={nombre}
          onCambio={setNombre}
        />
      </Hero>

      {/* La fórmula: fijo + % sobre una base */}
      <Propiedades pasoTitulo="La fórmula" pasoAyuda="Fijo + porcentaje sobre una base.">
        <PastillaEntrada
          etiqueta="Fijo al mes ($)"
          tipo="number"
          prefijo="$"
          placeholder="40000"
          valor={montoFijo}
          onCambio={setMontoFijo}
          idMovil="con-fijo"
        />
        <PastillaEntrada
          etiqueta="Porcentaje (%)"
          tipo="number"
          sufijo="%"
          placeholder="4"
          valor={porcentaje}
          onCambio={setPorcentaje}
          idMovil="con-pct"
        />
        {/* La definición exacta es lo que evita la discusión al cerrar el mes. */}
        <PastillaOpcion<string>
          etiqueta="El porcentaje se aplica sobre"
          opciones={BASES_CALCULO}
          valor={base}
          onCambio={setBase}
          ayuda={obtenerBaseCalculo(base)?.desc}
        />

        {/* Vista previa: la fórmula aplicada a un número redondo. */}
        <div className="w-full rounded-xl border bg-muted/40 px-4 py-3 text-[13px]">
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
      </Propiedades>

      <Propiedades pasoTitulo="Cobro y vigencia">
        <PastillaOpcion<string>
          etiqueta="Plataforma"
          opciones={PLATAFORMAS_AGENCIA}
          valor={plataforma}
          onCambio={setPlataforma}
        />
        <PastillaOpcion
          etiqueta="Periodicidad"
          opciones={PERIODICIDADES}
          valor={periodicidad}
          onCambio={setPeriodicidad}
        />
        <PastillaEntrada
          etiqueta="Día de corte"
          tipo="number"
          valor={diaCorte}
          onCambio={setDiaCorte}
          idMovil="con-dia"
        />
        <PastillaFecha
          etiqueta="Inicio"
          etiquetaVacia="Inicio"
          valor={inicio}
          onCambio={setInicio}
          limpiable
        />
        <PastillaFecha
          etiqueta="Fin (si lo tiene)"
          etiquetaVacia="Fin"
          valor={fin}
          onCambio={setFin}
          limpiable
        />
        <PastillaInterruptor etiqueta="Contrato vigente" valor={activo} onCambio={setActivo} />
        <span className="w-full text-[12.5px] leading-relaxed text-muted-foreground md:hidden">
          Solo los vigentes cuentan en el fijo mensual y aparecen para calcular cortes.
        </span>
      </Propiedades>

      <SeccionFormulario
        titulo="Fondo delegado y notas"
        pasoTitulo="Fondo delegado y notas"
        pasoAyuda="Opcional: dinero del cliente que solo pasa por la agencia, y lo pactado."
        abiertaPorDefecto={hayFondoONotas}
      >
        <Campo etiqueta="Fondo delegado ($ al mes)" htmlFor="con-fondo" className="w-full">
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
        </Campo>

        <Campo etiqueta="Notas del acuerdo" htmlFor="con-notas" className="w-full">
          <Textarea
            id="con-notas"
            rows={2}
            placeholder="Qué se descuenta, qué incluye, cómo se factura…"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
        </Campo>
      </SeccionFormulario>
    </DialogoFormulario>
  );
}
