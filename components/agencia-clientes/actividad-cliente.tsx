"use client";

import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import { cargarActividad, type FilaActividad } from "@/app/(app)/agencia/clientes/acciones/actividad";
import { formatearFechaHora } from "@/lib/fecha";

/* El expediente: quién hizo qué y cuándo, inalterable. Solo dirección lo ve (la
   RLS lo impone; la pestaña ni se pinta para el resto).

   Se lee al abrir la pestaña, no con la página: crece sin tope —no se poda a
   propósito— y las otras pestañas no tienen por qué pagarlo. */

/* Las acciones con palabras. El vocabulario cerrado del expediente vive entre
   los triggers de la BD y lib/actividad.ts; esto solo lo traduce. */
const NOMBRE_ACCION: Record<string, string> = {
  login: "entró al portal",
  tarea_creada: "creó la tarea",
  tarea_estado: "movió la tarea",
  tarea_archivada: "mandó a papelera la tarea",
  tarea_restaurada: "restauró la tarea",
  visibilidad_cambiada: "cambió quién ve",
  documento_creado: "subió el documento",
  documento_version: "subió una versión de",
  documento_archivado: "archivó el documento",
  documento_restaurado: "restauró el documento",
  documento_descargado: "descargó el documento",
  documento_visto: "consultó el documento",
  comentario_compartido: "comentó en",
  bitacora_creada: "registró en bitácora",
  evento_creado: "agendó",
  incidencia_creada: "registró el bloqueo",
  incidencia_estado: "movió el bloqueo",
  acceso_portal_cambiado: "cambió el acceso de",
  reporte_exportado: "exportó el reporte",
};

export function ActividadCliente({ empresaId }: { empresaId: string }) {
  const [busqueda, setBusqueda] = useState("");
  const { datos, cargando, error } = useDetalleRemoto<FilaActividad[]>(
    () => cargarActividad(empresaId),
    empresaId,
  );

  const filas = useMemo(() => {
    const todas = datos ?? [];
    const q = busqueda.trim().toLowerCase();
    if (!q) return todas;
    return todas.filter((f) => {
      const titulo = String(f.detalle?.titulo ?? f.detalle?.nombre ?? f.detalle?.tarea ?? "");
      return (
        (f.actor_nombre ?? "").toLowerCase().includes(q) ||
        f.accion.includes(q) ||
        (NOMBRE_ACCION[f.accion] ?? "").includes(q) ||
        titulo.toLowerCase().includes(q)
      );
    });
  }, [datos, busqueda]);

  if (cargando) {
    return (
      <div className="flex items-center gap-2 py-10 text-[13.5px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Cargando el expediente…
      </div>
    );
  }
  if (error) {
    return <p className="py-6 text-[13.5px] text-destructive">{error}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar por persona o por qué pasó…"
          className="min-w-[240px] flex-1"
          conteo={{ visibles: filas.length, total: datos?.length ?? 0, unidad: "registros" }}
        />
        <p className="text-[12px] text-muted-foreground">
          Este registro no se puede editar ni borrar — tampoco desde dirección.
        </p>
      </div>

      {filas.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-[14px] text-muted-foreground">
          Sin registros todavía.
        </p>
      ) : (
        <ol className="flex flex-col border-l pl-4">
          {filas.map((f) => {
            const titulo = String(f.detalle?.titulo ?? f.detalle?.nombre ?? f.detalle?.tarea ?? "");
            const cambio =
              f.accion === "tarea_estado" || f.accion === "incidencia_estado"
                ? ` (${String(f.detalle?.antes ?? "")} → ${String(f.detalle?.despues ?? f.detalle?.estado ?? "")})`
                : f.accion === "visibilidad_cambiada"
                  ? ` (${String(f.detalle?.antes ?? "")} → ${String(f.detalle?.despues ?? "")})`
                  : "";
            return (
              <li key={f.id} className="relative pb-3">
                <span
                  className="absolute -left-[21px] top-1.5 size-2 rounded-full bg-muted-foreground/50"
                  aria-hidden="true"
                />
                <p className="text-[13.5px] leading-relaxed">
                  <span className="font-semibold">{f.actor_nombre ?? "Sistema"}</span>{" "}
                  {NOMBRE_ACCION[f.accion] ?? f.accion}
                  {titulo && <span className="font-medium"> «{titulo}»</span>}
                  {cambio && <span className="text-muted-foreground">{cambio}</span>}
                </p>
                {f.accion === "comentario_compartido" && f.detalle?.resumen ? (
                  <p className="text-[12.5px] italic text-muted-foreground">
                    “{String(f.detalle.resumen)}”
                  </p>
                ) : null}
                <span className="text-[11.5px] text-muted-foreground">
                  {formatearFechaHora(f.created_at)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
