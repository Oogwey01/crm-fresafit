"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
  const fecha = new Date().toISOString().slice(0, 10);

  function exportarCSV() {
    const filas = tareas.map((t) => [
      t.titulo,
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
      ["Título", "Responsable", "Área", "Prioridad", "Estado", "Fecha límite", "Vencida", "Etiquetas", "Descripción", "Creada"],
      filas,
    );
    descargar(`tareas-fresafit-${fecha}.csv`, csv, "text/csv;charset=utf-8");
  }

  async function exportarJSON() {
    setDescargando(true);
    try {
      const r = await exportarRespaldo();
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      descargar(
        `respaldo-fresafit-crm-${fecha}.json`,
        JSON.stringify(r.datos, null, 2),
        "application/json",
      );
    } catch {
      toast.error("No se pudo generar el respaldo. Revisa tu conexión.");
    } finally {
      setDescargando(false);
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="outline" disabled={descargando} title="Descargar respaldo">
            💾 {descargando ? "Generando…" : "Respaldar"}
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
