"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { guardarEquipo } from "@/app/(app)/agencia/actions";
import { obtenerArea } from "@/lib/catalogos";
import type { AgenciaAsignacionConPersona, AgenciaEmpresa, Profile } from "@/lib/types";
import { cn, iniciales } from "@/lib/utils";

/* Quién del equipo atiende a esta empresa y con qué papel.

   Nutravia es puro TikTok Shop y no lleva programación; Bart Jerseys sí. Tener
   esto escrito es lo que permite después repartir el costo del equipo entre los
   contratos, en vez de mirarlo como un bloque. */
export function EquipoDialog({
  empresa,
  equipo,
  asignadas,
  onClose,
}: {
  empresa: AgenciaEmpresa;
  equipo: Profile[];
  asignadas: AgenciaAsignacionConPersona[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [seleccion, setSeleccion] = useState<Map<string, string>>(
    () => new Map(asignadas.map((a) => [a.profile_id, a.papel ?? ""])),
  );

  function alternar(id: string) {
    setSeleccion((prev) => {
      const m = new Map(prev);
      if (m.has(id)) m.delete(id);
      else m.set(id, "");
      return m;
    });
  }

  function cambiarPapel(id: string, papel: string) {
    setSeleccion((prev) => new Map(prev).set(id, papel));
  }

  function guardar() {
    const lista = [...seleccion.entries()].map(([profile_id, papel]) => ({ profile_id, papel }));
    ejecutar(() => guardarEquipo(empresa.id, lista), {
      ok: "Equipo actualizado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Equipo de {empresa.nombre}</DialogTitle>
        </DialogHeader>

        <div className="flex max-h-[55vh] flex-col gap-1.5 overflow-y-auto">
          {equipo.map((p) => {
            const puesto = seleccion.get(p.id);
            const marcado = puesto !== undefined;
            const area = obtenerArea(p.area ?? "");
            return (
              <div
                key={p.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl border px-3 py-2 transition-colors",
                  marcado ? "border-primary/40 bg-primary/5" : "bg-card",
                )}
              >
                <input
                  type="checkbox"
                  checked={marcado}
                  onChange={() => alternar(p.id)}
                  aria-label={`Asignar a ${p.nombre}`}
                  className="size-4 shrink-0 accent-primary"
                />
                <span
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{ backgroundColor: p.color }}
                >
                  {iniciales(p.nombre)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-medium">{p.nombre}</div>
                  <div className="truncate text-[11.5px] text-muted-foreground">
                    {area?.nombre ?? "Sin área"}
                  </div>
                </div>
                {/* El papel solo tiene sentido si la persona está asignada. */}
                {marcado && (
                  <Input
                    value={puesto}
                    onChange={(e) => cambiarPapel(p.id, e.target.value)}
                    placeholder="Qué hace aquí"
                    className="h-8 w-[150px] shrink-0 text-[12.5px]"
                  />
                )}
              </div>
            );
          })}
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar="Guardar equipo"
          onGuardar={guardar}
          onCancelar={onClose}
        />
      </DialogContent>
    </Dialog>
  );
}
