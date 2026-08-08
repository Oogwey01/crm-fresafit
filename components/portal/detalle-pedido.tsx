"use client";

import { useState } from "react";
import { Paperclip, Send, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Pastilla } from "@/components/compartido/pastilla";
import { Seccion } from "@/components/compartido/seccion";
import { CampoOpcion } from "@/components/compartido/campo-opcion";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import { cargarDetalle, comentar, subirAdjunto, urlAdjunto } from "@/app/(app)/tareas/actions";
import { moverPedido } from "@/app/(app)/portal/acciones/tareas";
import { ESTADOS, obtenerCategoriaTarea, obtenerEstado } from "@/lib/catalogos";
import { esVencida, formatearFechaHora, formatearFechaLarga } from "@/lib/fecha";
import type { EstadoId, TaskConResponsable, TaskDetalle } from "@/lib/types";

/* Los estados que el cliente puede poner. `en_revision` no está: es un paso del
   trabajo interno de Fresafit y de este lado no significa nada. */
const ESTADOS_CLIENTE = ESTADOS.filter((e) => e.id !== "en_revision");

/* El detalle de una tarea, del lado del cliente: de qué va, en qué estado está,
   el hilo de conversación y los archivos. Sin checklist, sin etiquetas, sin
   coasignados ni historial — eso es cómo nos organizamos por dentro, y no es lo
   que alguien de fuera entra a ver. */
export function DetallePedido({
  tarea,
  currentUserId,
  onCerrar,
}: {
  tarea: TaskConResponsable;
  currentUserId: string;
  onCerrar: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [texto, setTexto] = useState("");
  const [estado, setEstado] = useState<EstadoId>(tarea.estado);

  const { datos, error, recargar } = useDetalleRemoto<TaskDetalle>(
    () => cargarDetalle(tarea.id),
    tarea.id,
  );

  const categoria = obtenerCategoriaTarea(tarea.categoria);
  const est = obtenerEstado(tarea.estado);
  const vencida = esVencida(tarea.fecha_limite, tarea.estado);

  function cambiarEstado(nuevo: EstadoId) {
    const anterior = estado;
    ejecutar(() => moverPedido(tarea.id, nuevo), {
      optimista: () => setEstado(nuevo),
      ok: "Estado actualizado.",
      error: "No se pudo cambiar el estado.",
      /* Si el servidor lo rechaza —por ejemplo porque falta el archivo que su
         categoría exige— el toast lo explica, pero el select se quedaría
         mintiendo. Se devuelve a como estaba. */
      siempre: () => setEstado((v) => (v === nuevo ? v : anterior)),
    });
  }

  function enviarComentario() {
    if (!texto.trim()) return;
    ejecutar(() => comentar(tarea.id, texto), {
      error: "No se pudo publicar el comentario.",
      alExito: async () => {
        setTexto("");
        recargar();
      },
    });
  }

  function subir(archivo: File) {
    const fd = new FormData();
    fd.set("file", archivo);
    ejecutar(() => subirAdjunto(tarea.id, fd), {
      ok: "Archivo subido.",
      error: "No se pudo subir el archivo.",
      alExito: () => recargar(),
    });
  }

  async function abrirArchivo(storagePath: string) {
    const r = await urlAdjunto(storagePath);
    if ("error" in r) return;
    window.open(r.url, "_blank", "noopener");
  }

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto md:max-w-2xl">
        <div className="flex items-start justify-between gap-3">
          <DialogTitle className="text-[17px] leading-snug">{tarea.titulo}</DialogTitle>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-muted-foreground">
          {est && <Pastilla nombre={est.nombre} color={est.color} />}
          {categoria && <span>{categoria.nombre}</span>}
          {tarea.fecha_limite && (
            <span className={vencida ? "font-semibold text-destructive" : ""}>
              {vencida ? "Venció el " : "Para el "}
              {formatearFechaLarga(tarea.fecha_limite)}
            </span>
          )}
          {tarea.responsable && <span>Con {tarea.responsable.nombre}</span>}
        </div>

        {tarea.descripcion && (
          <p className="mt-3 whitespace-pre-wrap text-[14.5px] leading-relaxed">
            {tarea.descripcion}
          </p>
        )}

        <div className="mt-4 flex flex-col gap-4">
          <Seccion titulo="Estado">
            <CampoOpcion
              etiqueta=""
              opciones={ESTADOS_CLIENTE}
              valor={estado}
              onCambio={cambiarEstado}
              ayuda={
                categoria?.exigeAdjunto
                  ? "Esta tarea se cierra con el archivo adjunto."
                  : categoria?.exigeComentario
                    ? "Esta tarea se cierra con un comentario que diga cómo quedó."
                    : undefined
              }
            />
          </Seccion>

          <Seccion titulo="Archivos">
            {error && <p className="text-[13px] text-destructive">{error}</p>}
            {datos?.adjuntos.length ? (
              <ul className="flex flex-col gap-1.5">
                {datos.adjuntos.map((a) => (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => abrirArchivo(a.storage_path)}
                      className="inline-flex items-center gap-2 text-[13.5px] text-primary hover:underline"
                    >
                      <Paperclip className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                      {a.nombre}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">Todavía no hay archivos.</p>
            )}
            <label className="mt-1 inline-flex w-fit cursor-pointer items-center gap-2 rounded-lg border px-3 py-1.5 text-[13.5px] font-medium hover:bg-accent">
              <Paperclip className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
              Subir archivo
              <input
                type="file"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) subir(f);
                  e.target.value = "";
                }}
              />
            </label>
          </Seccion>

          <Seccion titulo="Conversación">
            {datos?.comentarios.length ? (
              <ul className="flex flex-col gap-2.5">
                {datos.comentarios.map((c) => (
                  <li
                    key={c.id}
                    className={
                      c.autor === currentUserId
                        ? "self-end rounded-xl rounded-br-sm bg-primary/10 px-3 py-2 text-[14px]"
                        : "self-start rounded-xl rounded-bl-sm bg-muted px-3 py-2 text-[14px]"
                    }
                  >
                    <p className="whitespace-pre-wrap">{c.texto}</p>
                    <span className="mt-1 block text-[11.5px] text-muted-foreground">
                      {formatearFechaHora(c.created_at)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[13px] text-muted-foreground">
                Nadie ha escrito aquí todavía. Es el mejor sitio para dejar constancia de lo que se
                acordó.
              </p>
            )}

            <div className="mt-1 flex items-end gap-2">
              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
                rows={2}
                placeholder="Escribe un comentario…"
                className="flex-1"
              />
              <Button
                type="button"
                onClick={enviarComentario}
                disabled={pending || !texto.trim()}
                size="sm"
                className="gap-1.5"
              >
                <Send className="size-3.5" strokeWidth={2} />
                Enviar
              </Button>
            </div>
          </Seccion>
        </div>
      </DialogContent>
    </Dialog>
  );
}
