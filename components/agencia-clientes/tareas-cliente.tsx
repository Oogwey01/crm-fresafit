"use client";

import { useState } from "react";
import { Eye, EyeOff, Lock, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pastilla } from "@/components/compartido/pastilla";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { TaskDialog } from "@/components/tareas/dialogo-tarea";
import { TaskDetail } from "@/components/tareas/detalle-tarea";
import { cambiarVisibilidad } from "@/app/(app)/agencia/clientes/acciones/visibilidad";
import {
  obtenerCategoriaTarea,
  obtenerEstado,
  obtenerVisibilidad,
} from "@/lib/catalogos";
import { esVencida, formatearFecha } from "@/lib/fecha";
import { mandaEnLaTarea } from "@/lib/tareas/reglas";
import { cn } from "@/lib/utils";
import type { AgenciaEmpresa, Profile, RolId, TaskConResponsable, VisibilidadId } from "@/lib/types";

/* La lista de tareas de un cliente, con lo que NO tiene el tablero: el nivel de
   visibilidad de cada una, a la vista y cambiable de un clic.

   Ese interruptor es la pieza importante de la pantalla. Compartir tiene que ser
   una decisión que se toma mirando la tarea —no un campo escondido en un
   formulario de doce— y tiene que poder deshacerse igual de rápido. */
export function TareasCliente({
  tareas,
  equipo,
  empresa,
  delCliente,
  comentariosPorTarea,
  currentUserId,
  rol,
}: {
  tareas: TaskConResponsable[];
  equipo: Profile[];
  empresa: Pick<AgenciaEmpresa, "id" | "nombre" | "color">;
  delCliente: Set<string>;
  comentariosPorTarea: Record<string, number>;
  currentUserId: string;
  rol: RolId;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [creando, setCreando] = useState(false);
  const [abierta, setAbierta] = useState<TaskConResponsable | null>(null);

  function alternar(t: TaskConResponsable) {
    const nueva: VisibilidadId = t.visibilidad === "compartido" ? "interno" : "compartido";
    ejecutar(() => cambiarVisibilidad(t.id, nueva), {
      ok:
        nueva === "compartido"
          ? `${empresa.nombre} ya puede ver esta tarea.`
          : "La tarea vuelve a ser solo nuestra.",
      error: "No se pudo cambiar la visibilidad.",
      confirmar:
        nueva === "compartido"
          ? `Se va a compartir «${t.titulo}» con ${empresa.nombre}. Verán el título, la descripción, los comentarios y los archivos. ¿Seguimos?`
          : undefined,
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex justify-end">
        <Button onClick={() => setCreando(true)} size="sm" className="gap-2">
          <Plus className="size-4" strokeWidth={2.2} />
          Nueva tarea
        </Button>
      </div>

      {tareas.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-[14px] text-muted-foreground">
          Nada por aquí todavía.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {tareas.map((t) => {
            const estado = obtenerEstado(t.estado);
            const categoria = obtenerCategoriaTarea(t.categoria);
            const visibilidad = obtenerVisibilidad(t.visibilidad);
            const compartida = t.visibilidad === "compartido";
            const privada = t.visibilidad === "privado";
            const vencida = esVencida(t.fecha_limite, t.estado);
            const laPidieron = delCliente.has(t.created_by ?? "");

            return (
              <li
                key={t.id}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border bg-card p-3.5 sm:flex-row sm:items-center sm:gap-4",
                  compartida && "border-cyan-600/35",
                  vencida && "border-destructive/40",
                )}
              >
                <button
                  type="button"
                  onClick={() => setAbierta(t)}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14.5px] font-semibold">{t.titulo}</span>
                    {estado && (
                      <Pastilla nombre={estado.nombre} color={estado.color} className="text-[11px]" />
                    )}
                    {privada && (
                      <span
                        className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[#7f1d1d]"
                        title="Solo dirección puede verla"
                      >
                        <Lock className="size-3" strokeWidth={2.2} aria-hidden="true" />
                        Privado
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
                    <span>{laPidieron ? `Lo pidió ${empresa.nombre}` : "Lo pedimos nosotros"}</span>
                    {t.prioridad === "urgente" && (
                      <span className="font-bold uppercase text-[#b91c1c]">Urgente</span>
                    )}
                    {t.fecha_limite && (
                      <span className={vencida ? "font-semibold text-destructive" : ""}>
                        {vencida ? "Venció el " : "Para el "}
                        {formatearFecha(t.fecha_limite)}
                      </span>
                    )}
                    {categoria && <span>{categoria.nombre}</span>}
                    {t.responsable && <span>{t.responsable.nombre}</span>}
                    {(comentariosPorTarea[t.id] ?? 0) > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <MessageSquare className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                        {comentariosPorTarea[t.id]}
                      </span>
                    )}
                  </div>
                </button>

                {/* El interruptor de compartir. Solo para quien manda en la tarea
                    (gestor o quien la creó): es la misma regla que aplica el
                    trigger `restringir_update_tarea`, así que enseñárselo a
                    alguien más sería ofrecerle un botón que va a rebotar. */}
                {mandaEnLaTarea(t, rol, currentUserId) && !privada && (
                  <button
                    type="button"
                    onClick={() => alternar(t)}
                    disabled={pending}
                    className={cn(
                      "inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12.5px] font-semibold transition-colors",
                      compartida
                        ? "border-cyan-600/40 bg-cyan-600/10 text-cyan-700 dark:text-cyan-400"
                        : "text-muted-foreground hover:bg-accent",
                    )}
                    title={
                      compartida
                        ? `${empresa.nombre} la ve. Clic para dejar de compartirla.`
                        : `Solo la vemos nosotros. Clic para compartirla con ${empresa.nombre}.`
                    }
                  >
                    {compartida ? (
                      <Eye className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    ) : (
                      <EyeOff className="size-3.5" strokeWidth={2} aria-hidden="true" />
                    )}
                    {visibilidad?.nombre}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {creando && (
        <TaskDialog
          equipo={equipo}
          currentUserId={currentUserId}
          onClose={() => setCreando(false)}
          espacio="agencia"
          empresas={[{ id: empresa.id, nombre: empresa.nombre, color: empresa.color }]}
          empresaInicial={empresa.id}
        />
      )}

      {abierta && (
        <TaskDetail
          tarea={abierta}
          equipo={equipo}
          currentUserId={currentUserId}
          rol={rol}
          onClose={() => setAbierta(null)}
        />
      )}
    </div>
  );
}
