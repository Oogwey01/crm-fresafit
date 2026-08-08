"use client";

import { useMemo, useState } from "react";
import { Archive, FileText, History, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pastilla } from "@/components/compartido/pastilla";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { DialogoDocumento } from "@/components/documentos/dialogo-documento";
import { VistaPreviaDocumento } from "@/components/documentos/vista-previa";
import {
  archivarDocumento,
  abrirArchivoDocumento,
} from "@/app/(app)/agencia/clientes/acciones/documentos";
import {
  CATEGORIAS_DOCUMENTO,
  DIAS_AVISO_VENCIMIENTO,
  obtenerCategoriaDocumento,
  obtenerVisibilidad,
} from "@/lib/catalogos";
import { diasDeVigencia } from "@/lib/documentos/consulta";
import { formatearFechaLarga, hoyISO } from "@/lib/fecha";
import { cn } from "@/lib/utils";
import type { EmpresaDocumentoConVersion } from "@/lib/types";

/* ============================================================================
   El archivo de documentos, para los dos lados
   ----------------------------------------------------------------------------
   La misma lista sirve al equipo y a la empresa cliente: lo que cambia es lo que
   la RLS deja llegar y un par de botones (`puedeGestionar`). Mantenerla en un
   solo componente es lo que garantiza que las dos partes vean lo mismo — que es
   justo el punto del módulo.
   ============================================================================ */

type Vigencia = "todos" | "por_vencer" | "vencidos";

export function ListaDocumentos({
  documentos,
  empresaId,
  empresaNombre,
  puedeGestionar,
}: {
  documentos: EmpresaDocumentoConVersion[];
  empresaId: string;
  empresaNombre: string;
  /* El equipo: puede editar la ficha, archivar y decidir qué se comparte. El
     cliente solo sube y consulta. */
  puedeGestionar: boolean;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [busqueda, setBusqueda] = useState("");
  const [categoria, setCategoria] = useState<string>("todas");
  const [vigencia, setVigencia] = useState<Vigencia>("todos");
  const [subiendo, setSubiendo] = useState(false);
  const [editando, setEditando] = useState<EmpresaDocumentoConVersion | null>(null);
  const [viendo, setViendo] = useState<EmpresaDocumentoConVersion | null>(null);

  const hoy = hoyISO();

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return documentos.filter((d) => {
      if (categoria !== "todas" && d.categoria !== categoria) return false;

      const dias = diasDeVigencia(d.vigente_hasta, hoy);
      if (vigencia === "por_vencer" && !(dias !== null && dias >= 0 && dias <= DIAS_AVISO_VENCIMIENTO))
        return false;
      if (vigencia === "vencidos" && !(dias !== null && dias < 0)) return false;

      if (!q) return true;
      return (
        d.nombre.toLowerCase().includes(q) ||
        (d.descripcion ?? "").toLowerCase().includes(q) ||
        d.etiquetas.some((e) => e.includes(q)) ||
        (d.version_actual?.nombre_archivo ?? "").toLowerCase().includes(q)
      );
    });
  }, [documentos, busqueda, categoria, vigencia, hoy]);

  /* Solo se ofrecen las categorías que existen en este archivo: un filtro con
     ocho opciones de las que seis están vacías es ruido. */
  const categoriasPresentes = useMemo(() => {
    const usadas = new Set(documentos.map((d) => d.categoria));
    return CATEGORIAS_DOCUMENTO.filter((c) => usadas.has(c.id));
  }, [documentos]);

  async function abrir(d: EmpresaDocumentoConVersion) {
    if (!d.version_actual) return;
    setViendo(d);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2.5">
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar por nombre, etiqueta o archivo…"
          className="min-w-[220px] flex-1"
          conteo={{ visibles: visibles.length, total: documentos.length, unidad: "documentos" }}
        />
        <Button onClick={() => setSubiendo(true)} size="sm" className="gap-2">
          <Plus className="size-4" strokeWidth={2.2} />
          Subir documento
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <ControlSegmentado
          opciones={
            [
              ["todos", "Todos"],
              ["por_vencer", "Por vencer"],
              ["vencidos", "Vencidos"],
            ] as const
          }
          valor={vigencia}
          onCambio={setVigencia}
        />
        {categoriasPresentes.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setCategoria("todas")}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                categoria === "todas" ? "bg-accent" : "text-muted-foreground hover:bg-muted",
              )}
            >
              Todas
            </button>
            {categoriasPresentes.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setCategoria(c.id)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-[12.5px] font-medium transition-colors",
                  categoria === c.id ? "bg-accent" : "text-muted-foreground hover:bg-muted",
                )}
              >
                {c.nombre}
              </button>
            ))}
          </div>
        )}
      </div>

      {visibles.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-[14px] text-muted-foreground">
          {documentos.length === 0
            ? "Todavía no hay documentos. Aquí van las constancias, contratos y todo lo que hoy se busca en WhatsApp."
            : "Nada que coincida con el filtro."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibles.map((d) => {
            const cat = obtenerCategoriaDocumento(d.categoria);
            const vis = obtenerVisibilidad(d.visibilidad);
            const dias = diasDeVigencia(d.vigente_hasta, hoy);
            const vencido = dias !== null && dias < 0;
            const porVencer = dias !== null && dias >= 0 && dias <= DIAS_AVISO_VENCIMIENTO;
            const compartido = d.visibilidad === "compartido";

            return (
              <li
                key={d.id}
                className={cn(
                  "flex flex-col gap-2 rounded-xl border bg-card p-3.5 sm:flex-row sm:items-center sm:gap-4",
                  compartido && "border-cyan-600/35",
                  vencido && "border-destructive/45",
                  d.archivado_at && "opacity-60",
                )}
              >
                <button
                  type="button"
                  onClick={() => abrir(d)}
                  disabled={!d.version_actual}
                  className="flex min-w-0 flex-1 items-start gap-3 text-left disabled:cursor-default"
                >
                  <FileText
                    className="mt-0.5 size-5 shrink-0 text-muted-foreground"
                    strokeWidth={1.8}
                    aria-hidden="true"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[14.5px] font-semibold">{d.nombre}</span>
                      {cat && (
                        <Pastilla nombre={cat.nombre} color={cat.color} className="text-[11px]" />
                      )}
                      {d.total_versiones > 1 && (
                        <span
                          className="inline-flex items-center gap-1 text-[11.5px] text-muted-foreground"
                          title={`${d.total_versiones} versiones guardadas`}
                        >
                          <History className="size-3" strokeWidth={2} aria-hidden="true" />v
                          {d.version_actual?.version}
                        </span>
                      )}
                      {d.archivado_at && (
                        <span className="text-[11.5px] font-medium text-muted-foreground">
                          archivado
                        </span>
                      )}
                    </span>
                    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted-foreground">
                      {vencido && (
                        <span className="font-semibold text-destructive">
                          Venció el {formatearFechaLarga(d.vigente_hasta!)}
                        </span>
                      )}
                      {porVencer && (
                        <span className="font-semibold text-amber-700 dark:text-amber-500">
                          Vence en {dias} {dias === 1 ? "día" : "días"}
                        </span>
                      )}
                      {d.vigente_hasta && !vencido && !porVencer && (
                        <span>Vigente hasta el {formatearFechaLarga(d.vigente_hasta)}</span>
                      )}
                      {d.autor && <span>Subió {d.autor.nombre}</span>}
                      {d.etiquetas.length > 0 && <span>{d.etiquetas.join(" · ")}</span>}
                      {!d.version_actual && (
                        <span className="font-medium text-destructive">Sin archivo</span>
                      )}
                    </span>
                  </span>
                </button>

                <div className="flex shrink-0 items-center gap-1.5">
                  {puedeGestionar && vis && (
                    <span
                      className={cn(
                        "rounded-lg border px-2 py-1 text-[12px] font-semibold",
                        compartido
                          ? "border-cyan-600/40 bg-cyan-600/10 text-cyan-700 dark:text-cyan-400"
                          : "text-muted-foreground",
                      )}
                    >
                      {vis.nombre}
                    </span>
                  )}
                  {puedeGestionar && (
                    <>
                      <Button variant="outline" size="sm" onClick={() => setEditando(d)}>
                        Editar
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        title={d.archivado_at ? "Devolver al archivo activo" : "Archivar"}
                        onClick={() =>
                          ejecutar(() => archivarDocumento(d.id, !d.archivado_at), {
                            ok: d.archivado_at ? "Documento restaurado." : "Documento archivado.",
                            error: "No se pudo archivar.",
                          })
                        }
                      >
                        <Archive className="size-4" strokeWidth={1.9} />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {subiendo && (
        <DialogoDocumento
          empresaId={empresaId}
          empresaNombre={empresaNombre}
          puedeGestionar={puedeGestionar}
          onCerrar={() => setSubiendo(false)}
        />
      )}
      {editando && (
        <DialogoDocumento
          empresaId={empresaId}
          empresaNombre={empresaNombre}
          puedeGestionar={puedeGestionar}
          documento={editando}
          onCerrar={() => setEditando(null)}
        />
      )}
      {viendo && viendo.version_actual && (
        <VistaPreviaDocumento
          documento={viendo}
          onCerrar={() => setViendo(null)}
          cargarUrl={() => abrirArchivoDocumento(viendo.id, viendo.version_actual!.storage_path)}
        />
      )}
    </div>
  );
}
