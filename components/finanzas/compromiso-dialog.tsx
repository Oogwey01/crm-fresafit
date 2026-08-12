"use client";

import { useState } from "react";
import { CalendarClock } from "lucide-react";
import { DialogoFormulario, Hero, Propiedades } from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaDato,
  PastillaEntrada,
  PastillaInterruptor,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { CATEGORIAS_PERSONALES, PERIODICIDADES_PERSONALES } from "@/lib/catalogos";
import { costoMensual } from "@/lib/finanzas/personales";
import { formatearMXN } from "@/lib/moneda";
import { aNumero } from "@/lib/validacion";
import {
  borrarCompromisoPersonal,
  guardarCompromisoPersonal,
  type CompromisoPersonalInput,
} from "@/app/(app)/finanzas/actions";
import type {
  CategoriaPersonalId,
  CompromisoPersonal,
  PeriodicidadPersonalId,
} from "@/lib/types";

/* Alta y edición de un pago fijo personal. Mucho más corto que el diálogo de
   gastos: aquí no hay comprobantes que adjuntar (el bucket `facturas` lo lee
   administración entera, así que un recibo de casa no cabe ahí) ni sugerencias
   que proponer. */
export function CompromisoDialog({
  compromiso,
  plantilla,
  onClose,
}: {
  compromiso: CompromisoPersonal | null; // null = alta
  /* Prefill de los chips del estado vacío («Luz · bimestral»). No guarda nada:
     solo arranca el formulario con algo escrito. */
  plantilla?: Partial<CompromisoPersonalInput> | null;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();

  const [concepto, setConcepto] = useState(compromiso?.concepto ?? plantilla?.concepto ?? "");
  const [monto, setMonto] = useState(compromiso?.monto?.toString() ?? "");
  const [periodicidad, setPeriodicidad] = useState<PeriodicidadPersonalId>(
    compromiso?.periodicidad ?? plantilla?.periodicidad ?? "mensual",
  );
  const [diaPago, setDiaPago] = useState(compromiso?.dia_pago?.toString() ?? "");
  const [categoria, setCategoria] = useState<CategoriaPersonalId>(
    compromiso?.categoria ?? plantilla?.categoria ?? "servicios",
  );
  const [activo, setActivo] = useState(compromiso?.activo ?? true);
  const [notas, setNotas] = useState(compromiso?.notas ?? "");

  const montoNumero = Math.round((Number(monto) || 0) * 100) / 100;

  function guardar() {
    const input: CompromisoPersonalInput = {
      concepto,
      monto: montoNumero,
      periodicidad,
      dia_pago: aNumero(diaPago),
      categoria,
      activo,
      notas,
    };
    ejecutar(() => guardarCompromisoPersonal(compromiso?.id ?? null, input), {
      ok: compromiso ? "Pago actualizado." : "Pago registrado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!compromiso) return;
    ejecutar(() => borrarCompromisoPersonal(compromiso.id), {
      confirmar: `¿Borrar «${compromiso.concepto}»? Se va del total del mes.`,
      ok: "Pago borrado.",
      error: "No se pudo borrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <DialogoFormulario
      titulo={compromiso ? "Editar pago fijo" : "Nuevo pago fijo"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={compromiso ? "Guardar cambios" : "Agregar"}
      pending={pending}
      onBorrar={compromiso ? borrar : undefined}
      anchoEscritorio="md:max-w-lg"
    >
      <Hero
        pasoTitulo="¿Qué pagas?"
        valido={!!concepto.trim()}
        motivoInvalido="Ponle nombre al pago: «Luz», «Internet», «Plan Telcel»."
      >
        <Campo etiqueta="Concepto" htmlFor="personal-concepto">
          <CampoHero
            id="personal-concepto"
            etiqueta="Concepto"
            placeholder="Luz, internet, plan Telcel…"
            valor={concepto}
            onCambio={setConcepto}
          />
        </Campo>

        {/* El monto protagonista, igual que en el gasto. Lo que se escribe es lo
            de CADA recibo, no lo del mes: sin ese renglón de apoyo, un recibo
            bimestral de $1,800 se captura como $900 y el total sale a la mitad
            para siempre. */}
        <div className="flex items-baseline gap-1 md:mt-1">
          <span className="text-lg font-semibold md:text-xl" aria-hidden="true">
            $
          </span>
          <input
            id="personal-monto"
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            aria-label="Monto de cada cobro"
            placeholder="0.00"
            value={monto}
            onChange={(e) => setMonto(e.target.value)}
            className="w-full border-0 bg-transparent px-0 text-lg font-semibold outline-none placeholder:text-muted-foreground/50 md:text-xl"
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Lo de <b className="font-semibold text-foreground">cada recibo</b>, no lo del mes: si la
          luz llega cada dos meses, aquí va el recibo completo.
        </p>

        <DescripcionHero
          id="personal-notas"
          etiqueta="Notas"
          placeholder="Nº de servicio, con qué tarjeta se domicilia… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades
        pasoTitulo="¿Cada cuándo?"
        pasoAyuda="La luz llega cada dos meses: el total de arriba ya lo reparte solo."
      >
        <PastillaOpcion
          etiqueta="Cada cuándo"
          opciones={PERIODICIDADES_PERSONALES}
          valor={periodicidad}
          onCambio={setPeriodicidad}
        />
        <PastillaEntrada
          etiqueta="Día de pago"
          tipo="number"
          placeholder="15"
          valor={diaPago}
          onCambio={setDiaPago}
          opcional
          ayuda="Del 1 al 31. Si no lo sabes, déjalo en blanco."
          idMovil="personal-dia"
        />
        <PastillaOpcion
          etiqueta="Categoría"
          opciones={CATEGORIAS_PERSONALES}
          valor={categoria}
          onCambio={setCategoria}
        />
        <PastillaInterruptor etiqueta="Sigue activo" valor={activo} onCambio={setActivo} />

        {/* El pago de la pantalla: escribe 1,800 bimestral y ve $900.00 antes de
            guardar. PastillaDato solo existe en escritorio, así que en el
            teléfono el mismo dato va como renglón suelto. */}
        <PastillaDato
          etiqueta="Te cuesta al mes"
          icono={CalendarClock}
          valor={formatearMXN(costoMensual(montoNumero, periodicidad))}
          contenidoMovil={
            <p className="text-[13px] text-muted-foreground">
              Te cuesta{" "}
              <b className="text-foreground">
                {formatearMXN(costoMensual(montoNumero, periodicidad))}
              </b>{" "}
              al mes.
            </p>
          }
        />
      </Propiedades>
    </DialogoFormulario>
  );
}
