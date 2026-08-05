"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { TaskDetail } from "@/components/tareas/task-detail";
import { marcarTareaLeida } from "@/app/(app)/tareas/actions";
import type { Profile, RolId, TaskConResponsable } from "@/lib/types";

/* Envoltura cliente de la página /tareas/[id]: reutiliza el mismo detalle del
   tablero en modo página, y aprovecha la visita para dejar la tarea marcada como
   leída (así desaparece su punto de "hay algo nuevo"). */
export function DetalleTareaPagina({
  tarea,
  equipo,
  rol,
  currentUserId,
  enfocarComentario,
  empresas = [],
  volverA = "/tareas",
}: {
  tarea: TaskConResponsable;
  equipo: Profile[];
  rol: RolId;
  currentUserId: string;
  enfocarComentario: boolean;
  empresas?: { id: string; nombre: string; color: string }[];
  /* Tablero al que se regresa al cerrar: el de Fresafit o el de la Agencia. */
  volverA?: string;
}) {
  const router = useRouter();

  /* Abrir la tarea ES haberla visto. Se hace al montar y no al salir para que
     funcione aunque se cierre la pestaña. Si falla, no pasa nada: el punto
     seguirá ahí hasta la próxima visita. */
  useEffect(() => {
    void marcarTareaLeida(tarea.id);
  }, [tarea.id]);

  return (
    <TaskDetail
      tarea={tarea}
      equipo={equipo}
      rol={rol}
      currentUserId={currentUserId}
      comoPagina
      enfocarComentario={enfocarComentario}
      empresas={empresas}
      onClose={() => router.push(volverA)}
    />
  );
}
