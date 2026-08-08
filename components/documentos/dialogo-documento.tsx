"use client";

import { useState } from "react";
import { toast } from "sonner";
import { DialogoPasos, Paso } from "@/components/compartido/dialogo-pasos";
import { CampoOpcion } from "@/components/compartido/campo-opcion";
import { DatePicker } from "@/components/compartido/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  editarDocumento,
  subirDocumento,
  subirVersion,
} from "@/app/(app)/agencia/clientes/acciones/documentos";
import { CATEGORIAS_DOCUMENTO, VISIBILIDADES, obtenerCategoriaDocumento } from "@/lib/catalogos";
import type {
  CategoriaDocumentoId,
  EmpresaDocumentoConVersion,
  VisibilidadId,
} from "@/lib/types";

/* Subir un documento nuevo, o editar la ficha de uno que ya está.

   En edición el archivo es OPCIONAL: si se elige uno, entra como versión nueva
   —la anterior no se pierde, se queda en el histórico— y si no, solo se guardan
   los datos. Es la diferencia entre «corregí el nombre» y «llegó la constancia
   de este año», y las dos cosas pasan desde la misma pantalla porque para quien
   la usa es el mismo gesto: actualizar el documento. */
export function DialogoDocumento({
  empresaId,
  empresaNombre,
  puedeGestionar,
  documento,
  onCerrar,
}: {
  empresaId: string;
  empresaNombre: string;
  puedeGestionar: boolean;
  documento?: EmpresaDocumentoConVersion;
  onCerrar: () => void;
}) {
  const editar = Boolean(documento);
  const { pending, ejecutar } = useAccionServidor();

  const [nombre, setNombre] = useState(documento?.nombre ?? "");
  const [categoria, setCategoria] = useState<CategoriaDocumentoId>(
    documento?.categoria ?? "otros",
  );
  const [descripcion, setDescripcion] = useState(documento?.descripcion ?? "");
  const [etiquetas, setEtiquetas] = useState((documento?.etiquetas ?? []).join(", "));
  const [vigencia, setVigencia] = useState(documento?.vigente_hasta ?? "");
  const [visibilidad, setVisibilidad] = useState<VisibilidadId>(
    documento?.visibilidad ?? "interno",
  );
  const [archivo, setArchivo] = useState<File | null>(null);
  const [nota, setNota] = useState("");

  /* Las categorías que caducan piden la fecha en primer plano; el resto la
     ofrecen igual, pero sin insistir. Es lo que hace que la alerta sirva: una
     constancia sin fecha capturada no avisa nunca. */
  const cat = obtenerCategoriaDocumento(categoria);
  const caduca = Boolean(cat && "caduca" in cat && cat.caduca);

  function guardar() {
    if (!nombre.trim()) {
      toast.error("El documento necesita un nombre.");
      return;
    }

    if (editar && documento) {
      /* Primero la ficha; si además hay archivo, la versión. Dos llamadas y no
         una: la mayoría de las ediciones no traen archivo, y así ese caso no
         paga el viaje del binario. */
      ejecutar(
        () =>
          editarDocumento(documento.id, {
            nombre,
            categoria,
            descripcion,
            etiquetas: etiquetas
              .split(",")
              .map((e) => e.trim().toLowerCase())
              .filter(Boolean),
            vigente_hasta: vigencia || null,
            visibilidad,
          }),
        {
          error: "No se pudieron guardar los cambios.",
          ok: archivo ? undefined : "Documento actualizado.",
          alExito: async () => {
            if (!archivo) {
              onCerrar();
              return;
            }
            const fd = new FormData();
            fd.set("documento_id", documento.id);
            fd.set("file", archivo);
            fd.set("nota", nota);
            if (vigencia) fd.set("vigente_hasta", vigencia);
            ejecutar(() => subirVersion(fd), {
              ok: `Guardado como versión ${(documento.version_actual?.version ?? 0) + 1}. La anterior sigue en el histórico.`,
              error: "Se guardaron los datos, pero el archivo no subió.",
              alExito: onCerrar,
            });
          },
        },
      );
      return;
    }

    if (!archivo) {
      toast.error("Elige el archivo que quieres guardar.");
      return;
    }

    const fd = new FormData();
    fd.set("empresa_id", empresaId);
    fd.set("nombre", nombre);
    fd.set("categoria", categoria);
    fd.set("descripcion", descripcion);
    fd.set("etiquetas", etiquetas);
    fd.set("visibilidad", visibilidad);
    if (vigencia) fd.set("vigente_hasta", vigencia);
    fd.set("file", archivo);

    ejecutar(() => subirDocumento(fd), {
      ok: "Documento guardado.",
      error: "No se pudo subir el documento.",
      alExito: onCerrar,
    });
  }

  return (
    <DialogoPasos
      titulo={editar ? "Editar documento" : `Subir documento de ${empresaNombre}`}
      onCerrar={onCerrar}
      onGuardar={guardar}
      etiquetaGuardar={editar ? "Guardar cambios" : "Subir documento"}
      pending={pending}
    >
      <Paso
        titulo="¿Qué documento es?"
        valido={Boolean(nombre.trim())}
        motivoInvalido="Ponle un nombre al documento."
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-nombre">Nombre</Label>
          <Input
            id="doc-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Constancia de situación fiscal 2026"
          />
        </div>
        <CampoOpcion
          etiqueta="Categoría"
          opciones={CATEGORIAS_DOCUMENTO}
          valor={categoria}
          onCambio={setCategoria}
        />
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-desc">Notas (opcional)</Label>
          <Textarea
            id="doc-desc"
            rows={2}
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
            placeholder="De qué es, para qué sirve, quién lo pidió…"
          />
        </div>
      </Paso>

      <Paso
        titulo="El archivo"
        ayuda={
          editar
            ? "Solo si llegó uno nuevo. El anterior se conserva en el histórico."
            : "PDF, imagen o lo que sea. Hasta 25 MB."
        }
        valido={editar || Boolean(archivo)}
        motivoInvalido="Elige el archivo que quieres guardar."
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-file">
            {editar ? "Reemplazar por una versión nueva" : "Archivo"}
          </Label>
          <input
            id="doc-file"
            type="file"
            onChange={(e) => setArchivo(e.target.files?.[0] ?? null)}
            className="text-[13.5px] file:mr-3 file:rounded-lg file:border file:bg-muted file:px-3 file:py-1.5 file:text-[13px] file:font-medium"
          />
          {archivo && (
            <span className="text-[12.5px] text-muted-foreground">
              {archivo.name} · {(archivo.size / 1024 / 1024).toFixed(1)} MB
            </span>
          )}
        </div>

        {editar && archivo && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="doc-nota">Qué cambió (opcional)</Label>
            <Input
              id="doc-nota"
              value={nota}
              onChange={(e) => setNota(e.target.value)}
              placeholder="La que mandaron el 3 de agosto"
            />
          </div>
        )}
      </Paso>

      <Paso
        titulo="Vigencia y quién lo ve"
        ayuda={
          caduca
            ? "Con la fecha capturada, el CRM avisa 30 días antes de que caduque."
            : "La fecha solo si aplica."
        }
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-vigencia">Vigente hasta</Label>
          <DatePicker id="doc-vigencia" value={vigencia} onChange={setVigencia} limpiable />
          {caduca && !vigencia && (
            <span className="text-[12.5px] text-amber-700 dark:text-amber-500">
              Sin fecha, este documento no avisará nunca de que venció.
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="doc-etiquetas">Etiquetas (separadas por comas)</Label>
          <Input
            id="doc-etiquetas"
            value={etiquetas}
            onChange={(e) => setEtiquetas(e.target.value)}
            placeholder="sat, 2026, matriz"
          />
        </div>

        {/* El cliente no elige: lo que sube nace compartido —para eso nos lo
            manda— y la acción lo impone igual aunque este campo no se pinte. */}
        {puedeGestionar && (
          <CampoOpcion
            etiqueta="Quién lo ve"
            opciones={VISIBILIDADES}
            valor={visibilidad}
            onCambio={setVisibilidad}
            ayuda={
              visibilidad === "compartido"
                ? `${empresaNombre} podrá verlo y descargarlo.`
                : visibilidad === "privado"
                  ? "Solo dirección."
                  : "Solo el equipo de Fresafit."
            }
          />
        )}
      </Paso>
    </DialogoPasos>
  );
}
