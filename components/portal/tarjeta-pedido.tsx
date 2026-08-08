"use client";

import { MessageSquare, Paperclip } from "lucide-react";
import { Pastilla } from "@/components/compartido/pastilla";
import { obtenerCategoriaTarea, obtenerEstado } from "@/lib/catalogos";
import { esVencida, formatearFecha } from "@/lib/fecha";
import { cn } from "@/lib/utils";
import type { TaskConResponsable } from "@/lib/types";

/* Un renglón de la bandeja. Pensado para leerse de un vistazo desde el
   teléfono: el título grande, y debajo lo único que decide si hay que actuar hoy
   —si venció, si corre prisa y para cuándo era—.

   Lo vencido se pinta en rojo y con la palabra: solo el color deja fuera a quien
   no distingue bien los rojos, y este aviso es justo el que no se puede perder. */
export function TarjetaPedido({
  tarea,
  comentarios,
  onAbrir,
}: {
  tarea: TaskConResponsable;
  comentarios: number;
  onAbrir: () => void;
}) {
  const estado = obtenerEstado(tarea.estado);
  const categoria = obtenerCategoriaTarea(tarea.categoria);
  const vencida = esVencida(tarea.fecha_limite, tarea.estado);
  const urgente = tarea.prioridad === "urgente";

  return (
    <button
      type="button"
      onClick={onAbrir}
      className={cn(
        "flex w-full flex-col gap-2 rounded-xl border bg-card p-3.5 text-left transition-colors hover:bg-accent/40",
        vencida && "border-destructive/40",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[15px] font-semibold leading-snug">{tarea.titulo}</span>
        {estado && <Pastilla nombre={estado.nombre} color={estado.color} className="shrink-0" />}
      </div>

      {tarea.descripcion && (
        <p className="line-clamp-2 text-[13.5px] leading-relaxed text-muted-foreground">
          {tarea.descripcion}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px] text-muted-foreground">
        {urgente && (
          <span className="font-bold uppercase tracking-wide text-[#b91c1c]">Urgente</span>
        )}
        {vencida && tarea.fecha_limite && (
          <span className="font-semibold text-destructive">
            Venció el {formatearFecha(tarea.fecha_limite)}
          </span>
        )}
        {!vencida && tarea.fecha_limite && <span>Para el {formatearFecha(tarea.fecha_limite)}</span>}
        {categoria && <span>{categoria.nombre}</span>}
        {tarea.responsable && <span>Con {tarea.responsable.nombre}</span>}
        {comentarios > 0 && (
          <span className="inline-flex items-center gap-1">
            <MessageSquare className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
            {comentarios}
          </span>
        )}
        {categoria?.exigeAdjunto && (
          <span
            className="inline-flex items-center gap-1"
            title="Esta tarea se cierra con un archivo adjunto"
          >
            <Paperclip className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
            Pide archivo
          </span>
        )}
      </div>
    </button>
  );
}
