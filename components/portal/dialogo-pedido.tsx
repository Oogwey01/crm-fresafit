"use client";

import { useState } from "react";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { DialogoPasos, Paso } from "@/components/compartido/dialogo-pasos";
import { CampoOpcion } from "@/components/compartido/campo-opcion";
import { DatePicker } from "@/components/compartido/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORIAS_TAREA } from "@/lib/catalogos";
import { crearPedido } from "@/app/(app)/portal/acciones/tareas";
import type { CategoriaTareaId } from "@/lib/types";

/* Pedirle algo a Fresafit.

   Cuatro campos y ni uno más. La versión interna de este formulario tiene doce
   —responsable, área, etiquetas, coasignados, recordatorio— y todos ellos son
   vocabulario NUESTRO: a quien está del otro lado no le toca aprenderse cómo
   organizamos el trabajo por dentro. Quién lo atiende y con qué prioridad
   interna se decide del lado de Fresafit, después.

   Lo abre solo el administrador de la empresa (`esExternoAdmin`), y la policy
   "tareas: crear (cliente admin)" lo vuelve a comprobar en la base. */
export function DialogoPedido({ onCerrar }: { onCerrar: () => void }) {
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoria, setCategoria] = useState<CategoriaTareaId>("otro");
  const [urgente, setUrgente] = useState(false);
  const [fecha, setFecha] = useState("");

  function guardar() {
    ejecutar(
      () => crearPedido({ titulo, descripcion, categoria, urgente, fecha_limite: fecha || null }),
      {
        ok: "Pedido enviado. Fresafit ya está enterado.",
        error: "No se pudo enviar el pedido.",
        alExito: onCerrar,
      },
    );
  }

  return (
    <DialogoPasos
      titulo="Pedir algo a Fresafit"
      onCerrar={onCerrar}
      onGuardar={guardar}
      etiquetaGuardar="Enviar pedido"
      pending={pending}
    >
      <Paso
        titulo="¿Qué necesitas?"
        ayuda="Con una línea basta; los detalles van abajo."
        valido={titulo.trim().length > 0}
        motivoInvalido="Escribe qué necesitas."
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pedido-titulo">Título</Label>
          <Input
            id="pedido-titulo"
            value={titulo}
            onChange={(e) => setTitulo(e.target.value)}
            placeholder="Reporte de ventas de la quincena"
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pedido-desc">Detalles</Label>
          <Textarea
            id="pedido-desc"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            rows={4}
            placeholder="Qué esperas recibir, en qué formato, para qué lo necesitas…"
          />
        </div>
      </Paso>

      <Paso titulo="¿De qué se trata?" ayuda="Sirve para agrupar y para saber qué hace falta al cerrarlo.">
        <CampoOpcion
          etiqueta="Categoría"
          opciones={CATEGORIAS_TAREA}
          valor={categoria}
          onCambio={setCategoria}
        />
      </Paso>

      <Paso titulo="¿Para cuándo?" ayuda="Opcional. Lo urgente avisa por correo en el momento.">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pedido-fecha">Fecha límite</Label>
          <DatePicker id="pedido-fecha" value={fecha} onChange={setFecha} />
        </div>
        <label className="flex items-start gap-2.5 rounded-xl border p-3 text-[14px]">
          <input
            type="checkbox"
            checked={urgente}
            onChange={(e) => setUrgente(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="font-semibold">Es urgente</span>
            <span className="block text-[13px] text-muted-foreground">
              Avisa de inmediato en vez de esperar al resumen del día.
            </span>
          </span>
        </label>
      </Paso>
    </DialogoPasos>
  );
}
