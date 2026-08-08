"use client";

import { useState } from "react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import { PastillaOpcion } from "@/components/compartido/pastillas-campo";
import { Input } from "@/components/ui/input";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { guardarIncidencia } from "@/app/(app)/agencia/clientes/acciones/avance";
import { ESTADOS_INCIDENCIA, LADOS_INCIDENCIA, VISIBILIDADES } from "@/lib/catalogos";
import type { EmpresaIncidencia, EstadoIncidenciaId, VisibilidadId } from "@/lib/types";

/* Registrar (o editar) un bloqueo. El campo que importa es «quién lo
   desbloquea»: un bloqueo sin dueño se queda semanas, y la spec lo marca como
   el dato clave de la sección. */
export function DialogoIncidencia({
  empresaId,
  empresaNombre,
  incidencia,
  onCerrar,
}: {
  empresaId: string;
  empresaNombre: string;
  incidencia?: EmpresaIncidencia;
  onCerrar: () => void;
}) {
  const editar = Boolean(incidencia);
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState(incidencia?.titulo ?? "");
  const [descripcion, setDescripcion] = useState(incidencia?.descripcion ?? "");
  const [impacto, setImpacto] = useState(incidencia?.impacto ?? "");
  const [desbloquea, setDesbloquea] = useState<"fresafit" | "cliente">(
    incidencia?.desbloquea ?? "fresafit",
  );
  const [estado, setEstado] = useState<EstadoIncidenciaId>(incidencia?.estado ?? "abierta");
  const [visibilidad, setVisibilidad] = useState<VisibilidadId>(
    incidencia?.visibilidad ?? "interno",
  );

  function guardar() {
    ejecutar(
      () =>
        guardarIncidencia({
          id: incidencia?.id,
          empresa_id: empresaId,
          titulo,
          descripcion,
          desbloquea,
          impacto,
          estado,
          visibilidad,
        }),
      {
        ok: editar ? "Incidencia actualizada." : "Bloqueo registrado.",
        error: "No se pudo guardar.",
        alExito: onCerrar,
      },
    );
  }

  /* Los lados con nombre propio: elegir entre «Fresafit» y «El cliente» a secas
     obliga a pensar; con el nombre de la empresa se responde solo. */
  const lados = LADOS_INCIDENCIA.map((l) =>
    l.id === "cliente" ? { ...l, nombre: empresaNombre } : l,
  );

  return (
    <DialogoFormulario
      titulo={editar ? "Editar incidencia" : "Registrar bloqueo"}
      onCerrar={onCerrar}
      onGuardar={guardar}
      etiquetaGuardar={editar ? "Guardar cambios" : "Registrar"}
      pending={pending}
    >
      <Hero
        pasoTitulo="¿Qué está frenando?"
        valido={Boolean(titulo.trim())}
        motivoInvalido="Dile a la incidencia qué está pasando."
      >
        <CampoHero
          id="inc-titulo"
          etiqueta="Qué pasa"
          placeholder="Falta el acceso de administrador a TikTok Shop"
          valor={titulo}
          onCambio={setTitulo}
        />
        <DescripcionHero
          id="inc-desc"
          etiqueta="Detalle"
          placeholder="Detalle… (opcional)"
          valor={descripcion}
          onCambio={setDescripcion}
        />
        <Campo etiqueta="Qué se está deteniendo" htmlFor="inc-impacto" className="md:mt-1">
          <Input
            id="inc-impacto"
            value={impacto}
            onChange={(e) => setImpacto(e.target.value)}
            placeholder="Sin el acceso no podemos publicar los lives"
          />
        </Campo>
      </Hero>

      <Propiedades
        pasoTitulo="¿A quién le toca?"
        pasoAyuda="Es el campo que evita que el bloqueo se quede huérfano."
      >
        <PastillaOpcion
          etiqueta="Lo desbloquea"
          opciones={lados}
          valor={desbloquea}
          onCambio={setDesbloquea}
        />
        {editar && (
          <PastillaOpcion
            etiqueta="Estado"
            opciones={ESTADOS_INCIDENCIA}
            valor={estado}
            onCambio={setEstado}
          />
        )}
        <PastillaOpcion
          etiqueta="Quién la ve"
          opciones={VISIBILIDADES}
          valor={visibilidad}
          onCambio={setVisibilidad}
          ayuda={
            visibilidad === "compartido"
              ? desbloquea === "cliente"
                ? `${empresaNombre} la verá resaltada: es su parte.`
                : `${empresaNombre} verá que estamos frenados y por qué.`
              : "Nace interna: se comparte cuando se decida."
          }
        />
      </Propiedades>
    </DialogoFormulario>
  );
}
