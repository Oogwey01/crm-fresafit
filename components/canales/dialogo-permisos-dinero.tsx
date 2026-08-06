"use client";

import { useState } from "react";
import { KeyRound } from "lucide-react";
import { cambiarPermisoDineroCanal } from "@/app/(app)/canales/actions";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { PANELES_CANAL, puedeAdministrar } from "@/lib/catalogos";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { CanalId, DineroPermisoCanal, Profile } from "@/lib/types";

/* Quién ve los números de cada plataforma.

   Va dentro de Canales y no en una pantalla de ajustes por el mismo criterio
   que puso el permiso de insumos dentro de Bodega: quien lo reparte ya está
   mirando el canal. Solo lo abre dirección (lo decide la página).

   Calcado del `DialogoPermisos` de components/bodega/seccion-insumos.tsx, con
   una diferencia: aquí el permiso es por PAREJA persona-canal, así que cada
   renglón lleva una casilla por plataforma. */
export function DialogoPermisosDinero({
  equipo,
  permisos,
}: {
  equipo: Profile[];
  permisos: DineroPermisoCanal[];
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setAbierto(true)}
        className="h-9 gap-1.5 rounded-lg text-[13px] font-semibold"
      >
        <KeyRound className="size-[15px]" strokeWidth={1.9} />
        Quién ve los números
      </Button>
      {abierto && (
        <Contenido equipo={equipo} permisos={permisos} onClose={() => setAbierto(false)} />
      )}
    </>
  );
}

function Contenido({
  equipo,
  permisos,
  onClose,
}: {
  equipo: Profile[];
  permisos: DineroPermisoCanal[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const tiene = (id: string, canal: CanalId) =>
    permisos.some((p) => p.profile_id === id && p.canal === canal);

  /* Dirección y administración no salen en la lista, por motivos distintos:
     dirección ve todo el dinero de todas formas, y administración está fuera de
     los ingresos a propósito —darle un canal por esta puerta sería deshacerlo
     a medias, y hay que decidirlo aparte, no con una casilla—. */
  const candidatos = equipo.filter((p) => !puedeAdministrar(p.rol) && p.rol !== "externo");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Quién ve los números de cada plataforma</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Todo el equipo ve cómo va cada canal: sus plazos, su termómetro y lo que exige.
          Marca a quien además pueda ver el DINERO de una plataforma —lo vendido, la comisión
          y lo depositado— porque la lleva. El permiso es de esa plataforma y de ninguna otra:
          la suma del negocio sigue siendo de Dirección.
        </p>

        <div className="flex flex-col gap-1">
          {/* Cabecera con el nombre de cada plataforma, para no repetirlo en
              cada renglón. */}
          <div className="flex items-center gap-2.5 border-b px-2 pb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="min-w-0 flex-1">Persona</span>
            {PANELES_CANAL.map((p) => (
              <span key={p.id} className="w-[86px] shrink-0 text-center">
                {p.nombre}
              </span>
            ))}
          </div>

          {candidatos.map((persona) => (
            <div
              key={persona.id}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50"
            >
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: persona.color }}
              >
                {persona.nombre.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate">{persona.nombre}</span>
              {PANELES_CANAL.map((panel) => {
                const canal = panel.canal as CanalId;
                const marcado = tiene(persona.id, canal);
                return (
                  <span key={panel.id} className="flex w-[86px] shrink-0 justify-center">
                    <input
                      type="checkbox"
                      checked={marcado}
                      disabled={pending}
                      aria-label={`${persona.nombre} ve los números de ${panel.nombre}`}
                      onChange={(e) =>
                        ejecutar(
                          () => cambiarPermisoDineroCanal(persona.id, canal, e.target.checked),
                          {
                            ok: e.target.checked
                              ? `${persona.nombre} ya ve los números de ${panel.nombre}.`
                              : `${persona.nombre} dejó de ver los números de ${panel.nombre}.`,
                          },
                        )
                      }
                      className="size-4 accent-primary"
                    />
                  </span>
                );
              })}
            </div>
          ))}
          {candidatos.length === 0 && (
            <p className="py-2 text-[13px] text-muted-foreground">
              No hay nadie a quien dar el permiso.
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
