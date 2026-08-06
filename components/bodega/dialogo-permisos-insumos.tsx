"use client";

/* Quién del equipo puede descontar insumos.
   Salió de seccion-insumos.tsx, que eran 894 líneas con la tabla y sus tres
   diálogos dentro. */

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  cambiarPermisoInsumos,
} from "@/app/(app)/bodega/actions";
import { puedeAdministrar } from "@/lib/catalogos";
import type {
  InsumoPermiso,
  Profile,
} from "@/lib/types";

/* --- Quién puede descontar (solo administración) -------------------------- */
export function DialogoPermisos({
  equipo,
  permisos,
  onClose,
}: {
  equipo: Profile[];
  permisos: InsumoPermiso[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const tiene = (id: string) => permisos.some((p) => p.profile_id === id && p.puede_descontar);

  /* Dirección y administración pueden siempre: no tiene caso ofrecerles un
     interruptor que no hace nada. */
  const candidatos = equipo.filter((p) => !puedeAdministrar(p.rol) && p.rol !== "externo");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quién puede descontar insumos</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Todo el equipo interno ve el inventario. Marca a quien además pueda registrar entradas y
          salidas. Dirección y administración pueden siempre.
        </p>
        <div className="flex flex-col gap-1">
          {candidatos.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={tiene(p.id)}
                disabled={pending}
                onChange={(e) =>
                  ejecutar(() => cambiarPermisoInsumos(p.id, e.target.checked), {
                    ok: e.target.checked
                      ? `${p.nombre} ya puede descontar.`
                      : `${p.nombre} ya solo puede consultar.`,
                  })
                }
                className="size-4 accent-primary"
              />
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: p.color }}
              >
                {p.nombre.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
            </label>
          ))}
          {candidatos.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              No hay nadie más a quien dar el permiso.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
