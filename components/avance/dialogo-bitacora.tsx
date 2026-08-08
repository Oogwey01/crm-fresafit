"use client";

import { useState } from "react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import { PastillaFecha, PastillaOpcion } from "@/components/compartido/pastillas-campo";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { guardarEntradaBitacora } from "@/app/(app)/agencia/clientes/acciones/avance";
import { VISIBILIDADES } from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import type { VisibilidadId } from "@/lib/types";

/* Una entrada de la bitácora: qué se hizo y cuándo. La fecha es la del HECHO
   —se apunta el lunes lo que pasó el viernes— y por eso se pregunta. */
export function DialogoBitacora({
  empresaId,
  onCerrar,
}: {
  empresaId: string;
  onCerrar: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [visibilidad, setVisibilidad] = useState<VisibilidadId>("interno");

  function guardar() {
    ejecutar(
      () =>
        guardarEntradaBitacora({
          empresa_id: empresaId,
          fecha,
          titulo,
          descripcion,
          visibilidad,
        }),
      {
        ok: "Entrada registrada.",
        error: "No se pudo guardar la entrada.",
        alExito: onCerrar,
      },
    );
  }

  return (
    <DialogoFormulario
      titulo="Nueva entrada de bitácora"
      onCerrar={onCerrar}
      onGuardar={guardar}
      etiquetaGuardar="Registrar"
      pending={pending}
    >
      <Hero
        pasoTitulo="¿Qué se hizo?"
        valido={Boolean(titulo.trim())}
        motivoInvalido="Ponle un título a la entrada."
      >
        <CampoHero
          id="bit-titulo"
          etiqueta="Título"
          placeholder="Se grabó el contenido de la semana"
          valor={titulo}
          onCambio={setTitulo}
        />
        <DescripcionHero
          id="bit-desc"
          etiqueta="Detalle"
          placeholder="Qué se entregó, números, enlaces… (opcional)"
          valor={descripcion}
          onCambio={setDescripcion}
          rows={3}
        />
      </Hero>

      <Propiedades pasoTitulo="¿Cuándo y quién lo ve?">
        <PastillaFecha etiqueta="Fecha del hecho" valor={fecha} onCambio={setFecha} />
        <PastillaOpcion
          etiqueta="Quién la ve"
          opciones={VISIBILIDADES}
          valor={visibilidad}
          onCambio={setVisibilidad}
          ayuda={
            visibilidad === "compartido"
              ? "El cliente la verá en su portal y en el reporte de periodo."
              : "Nace interna: se comparte cuando se decida."
          }
        />
      </Propiedades>
    </DialogoFormulario>
  );
}
