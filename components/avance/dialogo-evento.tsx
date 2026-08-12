"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import { PastillaFechaHora, PastillaOpcion } from "@/components/compartido/pastillas-campo";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { guardarEvento } from "@/app/(app)/agencia/clientes/acciones/avance";
import { VISIBILIDADES } from "@/lib/catalogos";
import { localInputAIso } from "@/lib/fecha";
import type { VisibilidadId } from "@/lib/types";

/* Agendar algo que viene: un live, una entrega, un corte de pago. Con hora,
   porque un live se agenda a una hora — el input datetime-local ya existe en el
   CRM para los recordatorios de tarea y aquí se usa igual (lib/fecha.ts hace el
   puente local ↔ ISO). */
export function DialogoEvento({
  empresaId,
  onCerrar,
}: {
  empresaId: string;
  onCerrar: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [cuando, setCuando] = useState("");
  const [visibilidad, setVisibilidad] = useState<VisibilidadId>("interno");

  function guardar() {
    const iso = localInputAIso(cuando);
    if (!iso) {
      toast.error("Dile al evento cuándo es.");
      return;
    }
    ejecutar(
      () =>
        guardarEvento({
          empresa_id: empresaId,
          titulo,
          descripcion,
          inicia_en: iso,
          visibilidad,
        }),
      {
        ok: "Evento agendado.",
        error: "No se pudo agendar.",
        alExito: onCerrar,
      },
    );
  }

  return (
    <DialogoFormulario
      titulo="Agendar evento"
      onCerrar={onCerrar}
      onGuardar={guardar}
      etiquetaGuardar="Agendar"
      pending={pending}
    >
      <Hero
        pasoTitulo="¿Qué viene?"
        valido={Boolean(titulo.trim()) && Boolean(cuando)}
        motivoInvalido="Ponle título y fecha al evento."
      >
        <CampoHero
          id="ev-titulo"
          etiqueta="Título"
          placeholder="Live del viernes"
          valor={titulo}
          onCambio={setTitulo}
        />
        <DescripcionHero
          id="ev-desc"
          etiqueta="Detalle"
          placeholder="Detalle… (opcional)"
          valor={descripcion}
          onCambio={setDescripcion}
        />
        <div className="md:mt-1">
          <PastillaFechaHora
            etiqueta="Cuándo"
            etiquetaVacia="Cuándo"
            valor={cuando}
            onCambio={setCuando}
            opcional={false}
          />
        </div>
      </Hero>

      <Propiedades pasoTitulo="¿Quién lo ve?">
        <PastillaOpcion
          etiqueta="Quién lo ve"
          opciones={VISIBILIDADES}
          valor={visibilidad}
          onCambio={setVisibilidad}
          ayuda={
            visibilidad === "compartido"
              ? "Aparecerá en el calendario del cliente."
              : "Nace interno: se comparte cuando se decida."
          }
        />
      </Propiedades>
    </DialogoFormulario>
  );
}
