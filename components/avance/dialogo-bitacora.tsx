"use client";

import { useState } from "react";
import { DialogoPasos, Paso } from "@/components/compartido/dialogo-pasos";
import { CampoOpcion } from "@/components/compartido/campo-opcion";
import { DatePicker } from "@/components/compartido/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
    <DialogoPasos
      titulo="Nueva entrada de bitácora"
      onCerrar={onCerrar}
      onGuardar={guardar}
      etiquetaGuardar="Registrar"
      pending={pending}
    >
      <Paso
        titulo="¿Qué se hizo?"
        valido={Boolean(titulo.trim())}
        motivoInvalido="Ponle un título a la entrada."
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bit-titulo">Título</Label>
          <Input
            id="bit-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Se grabó el contenido de la semana"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bit-desc">Detalle (opcional)</Label>
          <Textarea
            id="bit-desc"
            rows={3}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="Qué se entregó, números, enlaces…"
          />
        </div>
      </Paso>

      <Paso titulo="¿Cuándo y quién lo ve?">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bit-fecha">Fecha del hecho</Label>
          <DatePicker id="bit-fecha" value={fecha} onChange={setFecha} />
        </div>
        <CampoOpcion
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
      </Paso>
    </DialogoPasos>
  );
}
