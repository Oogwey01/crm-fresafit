"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DialogoPasos, Paso } from "@/components/compartido/dialogo-pasos";
import { CampoOpcion } from "@/components/compartido/campo-opcion";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
    <DialogoPasos
      titulo="Agendar evento"
      onCerrar={onCerrar}
      onGuardar={guardar}
      etiquetaGuardar="Agendar"
      pending={pending}
    >
      <Paso
        titulo="¿Qué viene?"
        valido={Boolean(titulo.trim()) && Boolean(cuando)}
        motivoInvalido="Ponle título y fecha al evento."
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ev-titulo">Título</Label>
          <Input
            id="ev-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Live del viernes"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ev-cuando">Cuándo</Label>
          <Input
            id="ev-cuando"
            type="datetime-local"
            value={cuando}
            onChange={(e) => setCuando(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="ev-desc">Detalle (opcional)</Label>
          <Textarea
            id="ev-desc"
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </div>
      </Paso>

      <Paso titulo="¿Quién lo ve?">
        <CampoOpcion
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
      </Paso>
    </DialogoPasos>
  );
}
