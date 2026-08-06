"use client";

import { useState, useTransition } from "react";
import { Trash2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AREAS } from "@/lib/catalogos";
import { restaurarTarea, eliminarDefinitivo } from "@/app/(app)/tareas/actions";
import type { TaskConResponsable } from "@/lib/types";

/* Papelera: tareas con borrado suave. Restaurar o eliminar definitivo.
   Las `borradas` llegan ya cargadas desde la página, donde RLS ya acotó cuáles
   ve cada quien: un gestor las de todo el tablero, y los demás las suyas.
   Restaurar y eliminar los sigue gobernando el server action (gestor o quien
   creó la tarea). */
export function Papelera({ borradas }: { borradas: TaskConResponsable[] }) {
  const [abierto, setAbierto] = useState(false);
  const [pending, startTransition] = useTransition();

  function accion(fn: () => Promise<{ ok: true } | { error: string }>, okMsg: string) {
    startTransition(async () => {
      try {
        const r = await fn();
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success(okMsg);
      } catch {
        toast.error("Algo falló. Revisa tu conexión.");
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setAbierto(true)}
        className="h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold"
      >
        <Trash2 className="size-4" strokeWidth={2} />
        Papelera{borradas.length ? ` (${borradas.length})` : ""}
      </Button>

      {abierto && (
        <Dialog open onOpenChange={(v) => !v && setAbierto(false)}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Papelera</DialogTitle>
            </DialogHeader>

            {borradas.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                La papelera está vacía.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {borradas.map((t) => (
                  <div
                    key={t.id}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">{t.titulo}</div>
                      <div className="text-xs text-muted-foreground">
                        {AREAS.find((a) => a.id === t.area)?.nombre}
                        {t.responsable ? ` · ${t.responsable.nombre}` : ""}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={pending}
                      onClick={() => accion(() => restaurarTarea(t.id), "Tarea restaurada.")}
                    >
                      <RotateCcw className="size-3.5" strokeWidth={2} />
                      Restaurar
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:text-destructive"
                      disabled={pending}
                      onClick={() => {
                        if (!confirm("Eliminar definitivo. Esto no se puede deshacer.")) return;
                        accion(() => eliminarDefinitivo(t.id), "Tarea eliminada.");
                      }}
                    >
                      Eliminar
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
