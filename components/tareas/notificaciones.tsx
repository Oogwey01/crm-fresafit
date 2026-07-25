"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { marcarNotificacionLeida, marcarTodasLeidas } from "@/app/(app)/tareas/actions";
import type { Notificacion } from "@/lib/types";
import { cn } from "@/lib/utils";

function fmt(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/* Campana de notificaciones: badge de no-leídas + feed. Vive en el pie del
   sidebar (y su versión móvil). El origen de los datos es la tabla
   `notifications`, cargada en app/(app)/layout.tsx. */
export function Notificaciones({ notificaciones }: { notificaciones: Notificacion[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const noLeidas = notificaciones.filter((n) => !n.leida).length;

  function abrir(n: Notificacion) {
    startTransition(async () => {
      if (!n.leida) await marcarNotificacionLeida(n.id);
      router.push("/tareas");
      router.refresh();
    });
  }

  function todas() {
    startTransition(async () => {
      await marcarTodasLeidas();
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Notificaciones${noLeidas ? ` (${noLeidas} sin leer)` : ""}`}
        className="relative flex size-9 items-center justify-center rounded-lg text-foreground/70 transition-colors hover:bg-muted hover:text-foreground"
      >
        <Bell className="size-[18px]" strokeWidth={1.9} aria-hidden="true" />
        {noLeidas > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-4 text-primary-foreground">
            {noLeidas > 9 ? "9+" : noLeidas}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-semibold">Notificaciones</span>
          {noLeidas > 0 && (
            <button
              type="button"
              onClick={todas}
              className="text-xs font-medium text-primary hover:underline"
            >
              Marcar todas leídas
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {notificaciones.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Sin novedades por ahora.
            </p>
          ) : (
            notificaciones.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => abrir(n)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 border-b px-3 py-2.5 text-left transition-colors hover:bg-muted/60 last:border-b-0",
                  !n.leida && "bg-primary/5",
                )}
              >
                <div className="flex w-full items-start gap-2">
                  {!n.leida && (
                    <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />
                  )}
                  <span className={cn("flex-1 text-sm", !n.leida && "font-medium")}>{n.texto}</span>
                </div>
                <span className="pl-4 text-[11px] text-muted-foreground">{fmt(n.created_at)}</span>
              </button>
            ))
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
