"use client";

import { useState } from "react";
import { DialogoPasos, Paso } from "@/components/compartido/dialogo-pasos";
import { CampoOpcion } from "@/components/compartido/campo-opcion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
    <DialogoPasos
      titulo={editar ? "Editar incidencia" : "Registrar bloqueo"}
      onCerrar={onCerrar}
      onGuardar={guardar}
      etiquetaGuardar={editar ? "Guardar cambios" : "Registrar"}
      pending={pending}
    >
      <Paso
        titulo="¿Qué está frenando?"
        valido={Boolean(titulo.trim())}
        motivoInvalido="Dile a la incidencia qué está pasando."
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inc-titulo">Qué pasa</Label>
          <Input
            id="inc-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Falta el acceso de administrador a TikTok Shop"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inc-desc">Detalle (opcional)</Label>
          <Textarea
            id="inc-desc"
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="inc-impacto">Qué se está deteniendo</Label>
          <Input
            id="inc-impacto"
            value={impacto}
            onChange={(e) => setImpacto(e.target.value)}
            placeholder="Sin el acceso no podemos publicar los lives"
          />
        </div>
      </Paso>

      <Paso
        titulo="¿A quién le toca?"
        ayuda="Es el campo que evita que el bloqueo se quede huérfano."
      >
        <CampoOpcion
          etiqueta="Lo desbloquea"
          opciones={lados}
          valor={desbloquea}
          onCambio={setDesbloquea}
        />
        {editar && (
          <CampoOpcion
            etiqueta="Estado"
            opciones={ESTADOS_INCIDENCIA}
            valor={estado}
            onCambio={setEstado}
          />
        )}
        <CampoOpcion
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
      </Paso>
    </DialogoPasos>
  );
}
