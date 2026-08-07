"use client";

import { useState } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { obtenerArea, obtenerEstado, obtenerEtiqueta, obtenerPrioridad } from "@/lib/catalogos";
import { aCSV } from "@/lib/csv";
import { esVencida } from "@/lib/fecha";
import { exportarRespaldo } from "@/app/(app)/tareas/actions";
import type { TaskConResponsable } from "@/lib/types";

/* Descarga un texto como archivo desde el navegador. */
function descargar(nombre: string, contenido: string, tipo: string) {
  const blob = new Blob([contenido], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* Respaldo descargable en dos sabores:
   - Tareas (.csv): lo visible en pantalla, para abrir en Excel. Todos los roles.
   - Respaldo completo (.json): TODO el módulo con comentarios/subtareas/enlaces
     (server action, solo gestores). */
export function ExportButton({
  tareas,
  gestor,
}: {
  tareas: TaskConResponsable[];
  gestor: boolean;
}) {
  const [descargando, setDescargando] = useState(false);
  const { ejecutar } = useAccionServidor();
  const fecha = new Date().toISOString().slice(0, 10);

  function exportarCSV() {
    /* La columna de cliente solo se agrega si hay tareas de la agencia en lo
       exportado: en Fresafit sería una columna vacía en todos los renglones. */
    const conCliente = tareas.some((t) => t.espacio === "agencia");
    const filas = tareas.map((t) => [
      t.titulo,
      ...(conCliente ? [t.empresa?.nombre ?? ""] : []),
      t.responsable?.nombre ?? "",
      obtenerArea(t.area)?.nombre ?? t.area,
      obtenerPrioridad(t.prioridad)?.nombre ?? t.prioridad,
      obtenerEstado(t.estado)?.nombre ?? t.estado,
      t.fecha_limite ?? "",
      esVencida(t.fecha_limite, t.estado) ? "Sí" : "No",
      t.etiquetas.map((e) => obtenerEtiqueta(e)?.nombre ?? e).join(" | "),
      t.descripcion ?? "",
      t.created_at.slice(0, 10),
    ]);
    const csv = aCSV(
      [
        "Título",
        ...(conCliente ? ["Cliente"] : []),
        "Responsable",
        "Área",
        "Prioridad",
        "Estado",
        "Fecha límite",
        "Vencida",
        "Etiquetas",
        "Descripción",
        "Creada",
      ],
      filas,
    );
    descargar(`tareas-fresafit-${fecha}.csv`, csv, "text/csv;charset=utf-8");
  }

  function exportarJSON() {
    setDescargando(true);
    /* Sin `ok`: la descarga que arranca sola ya es el acuse. */
    ejecutar(() => exportarRespaldo(), {
      error: "No se pudo generar el respaldo. Revisa tu conexión.",
      alExito: (r) =>
        descargar(
          `respaldo-fresafit-crm-${fecha}.json`,
          JSON.stringify(r.datos, null, 2),
          "application/json",
        ),
      siempre: () => setDescargando(false),
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="outline"
            disabled={descargando}
            title="Descargar respaldo"
            className="h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold"
          >
            <Save className="size-[15px]" strokeWidth={1.8} />
            {descargando ? "Generando…" : "Respaldar"}
          </Button>
        }
      />
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={exportarCSV}>
          Tareas en pantalla (.csv para Excel)
        </DropdownMenuItem>
        {gestor && (
          <DropdownMenuItem onClick={exportarJSON}>
            Respaldo completo (.json)
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
