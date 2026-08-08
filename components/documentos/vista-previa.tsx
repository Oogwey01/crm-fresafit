"use client";

import { useEffect, useState } from "react";
import { Download, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatearFechaHora } from "@/lib/fecha";
import type { EmpresaDocumentoConVersion } from "@/lib/types";

/* Ver el documento sin descargarlo.

   «No volver a buscar en WhatsApp» incluye no tener que bajar un PDF al
   teléfono para comprobar que era el que se buscaba. Los PDF van en un iframe y
   las imágenes en un <img>; lo demás (un .docx, un .xlsx) el navegador no lo
   sabe pintar, así que se ofrece la descarga sin fingir que hay vista previa.

   La URL la firma el servidor y de paso registra la consulta: por eso llega como
   una función `cargarUrl` y no como una cadena. */
const VISIBLES_EN_NAVEGADOR = /^(application\/pdf|image\/)/;

export function VistaPreviaDocumento({
  documento,
  cargarUrl,
  onCerrar,
}: {
  documento: EmpresaDocumentoConVersion;
  cargarUrl: () => Promise<{ url: string } | { error: string }>;
  onCerrar: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const version = documento.version_actual;
  const mime = version?.mime ?? "";
  const sePuedeVer = VISIBLES_EN_NAVEGADOR.test(mime);
  const esImagen = mime.startsWith("image/");

  useEffect(() => {
    let vivo = true;
    cargarUrl()
      .then((r) => {
        if (!vivo) return;
        if ("error" in r) setError(r.error);
        else setUrl(r.url);
      })
      .catch(() => vivo && setError("No se pudo abrir el archivo."));
    return () => {
      vivo = false;
    };
    /* Se pide UNA vez por apertura: `cargarUrl` viene de una closure nueva en
       cada render del padre y meterla en las dependencias volvería a firmar —y
       a registrar una consulta— en cada repintado. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documento.id]);

  return (
    <Dialog open onOpenChange={(abierto) => !abierto && onCerrar()}>
      <DialogContent className="max-h-[92dvh] overflow-hidden md:max-w-3xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <DialogTitle className="truncate text-[16px]">{documento.nombre}</DialogTitle>
            <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
              {version?.nombre_archivo}
              {version && ` · versión ${version.version}`}
              {version && ` · ${formatearFechaHora(version.created_at)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onCerrar}
            aria-label="Cerrar"
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="mt-3 min-h-[240px]">
          {error && <p className="text-[13.5px] text-destructive">{error}</p>}

          {!error && !url && (
            <div className="flex items-center gap-2 py-10 text-[13.5px] text-muted-foreground">
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              Abriendo el archivo…
            </div>
          )}

          {url && sePuedeVer && esImagen && (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={url}
              alt={documento.nombre}
              className="mx-auto max-h-[65dvh] w-auto rounded-lg object-contain"
            />
          )}

          {url && sePuedeVer && !esImagen && (
            <iframe
              src={url}
              title={documento.nombre}
              className="h-[65dvh] w-full rounded-lg border"
            />
          )}

          {url && !sePuedeVer && (
            <p className="py-8 text-center text-[13.5px] text-muted-foreground">
              Este tipo de archivo no se puede ver aquí. Descárgalo para abrirlo.
            </p>
          )}
        </div>

        {url && (
          <div className="mt-3 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              render={
                <a
                  href={url}
                  download={version?.nombre_archivo}
                  target="_blank"
                  rel="noopener"
                />
              }
            >
              <Download className="size-4" strokeWidth={1.9} />
              Descargar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
