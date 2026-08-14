"use client";

import { useRef, useState } from "react";
import { Paperclip, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { SeccionFormulario } from "@/components/compartido/dialogo-formulario";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { TIPOS_ARCHIVO_PEDIDO, obtenerTipoArchivoPedido } from "@/lib/catalogos";
import {
  borrarArchivoPedido,
  subirArchivoPedido,
  urlComprobantePedido,
} from "@/app/(app)/proveedores/actions";
import type { SupplierOrderFile, TipoArchivoPedidoId } from "@/lib/types";

/* Los archivos del pedido (junta 13/08): la factura de China, el screenshot del
   pago internacional y las fotos que manda el proveedor de lo que va a enviar
   («tengo como 50 fotos»). Se suben DE UNA EN UNA aunque el selector acepte
   varias: una server action con 50 fotos revienta el límite de payload; en
   serie, la que falle se reporta sola y las demás quedan. */
export function ArchivosPedido({
  pedidoId,
  archivos,
  onCambio,
}: {
  pedidoId: string;
  archivos: SupplierOrderFile[];
  onCambio: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const inputRef = useRef<HTMLInputElement>(null);
  const [tipo, setTipo] = useState<TipoArchivoPedidoId>("factura");
  const [subiendo, setSubiendo] = useState(false);

  async function subirSeleccion(files: FileList | null) {
    if (!files?.length) return;
    setSubiendo(true);
    let subidos = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append("file", file);
      const r = await subirArchivoPedido(pedidoId, tipo, fd);
      if ("error" in r) {
        toast.error(`${file.name}: ${r.error}`);
        break;
      }
      subidos += 1;
    }
    if (subidos > 0) {
      toast.success(`${subidos} ${subidos === 1 ? "archivo subido" : "archivos subidos"}.`);
      onCambio();
    }
    setSubiendo(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function ver(path: string) {
    const r = await urlComprobantePedido(path);
    if ("error" in r) return toast.error(r.error);
    window.open(r.url, "_blank");
  }

  /* Agrupados por tipo, en el orden del catálogo, para que la factura no se
     pierda entre cincuenta fotos. */
  const grupos = TIPOS_ARCHIVO_PEDIDO.map((t) => ({
    ...t,
    archivos: archivos.filter((a) => a.tipo === t.id),
  })).filter((g) => g.archivos.length > 0);

  return (
    <SeccionFormulario
      titulo="Archivos"
      pasoTitulo="Archivos del pedido"
      pasoAyuda="La factura de China, el screenshot del pago internacional y las fotos que manda el proveedor."
      contador={archivos.length || null}
      abiertaPorDefecto={archivos.length > 0}
    >
      {grupos.map((g) => (
        <div key={g.id}>
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            {g.nombre} · {g.archivos.length}
          </p>
          <div className="flex flex-col gap-1">
            {g.archivos.map((a) => (
              <div key={a.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
                <button
                  type="button"
                  onClick={() => ver(a.storage_path)}
                  className="inline-flex min-w-0 items-center gap-1.5 text-primary hover:underline"
                  title={a.nombre ?? "Ver archivo"}
                >
                  <Paperclip className="size-3.5 shrink-0" />
                  <span className="truncate">{a.nombre ?? a.storage_path}</span>
                </button>
                {a.nota && <span className="truncate text-muted-foreground">· {a.nota}</span>}
                <button
                  type="button"
                  onClick={() =>
                    ejecutar(() => borrarArchivoPedido(a.id, a.storage_path), {
                      ok: "Archivo borrado.",
                      alExito: onCambio,
                    })
                  }
                  className="ml-auto text-muted-foreground hover:text-destructive"
                  aria-label="Borrar archivo"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
      {archivos.length === 0 && (
        <p className="text-[13px] text-muted-foreground">Sin archivos todavía.</p>
      )}

      {/* Alta: qué es + elegir archivos (varios a la vez para las fotos). */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoArchivoPedidoId)}
          className="h-9 rounded-md border bg-card px-2 text-sm"
          aria-label="Qué es el archivo"
        >
          {TIPOS_ARCHIVO_PEDIDO.map((t) => (
            <option key={t.id} value={t.id}>
              {t.nombre}
            </option>
          ))}
        </select>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/*"
          className="hidden"
          onChange={(e) => void subirSeleccion(e.target.files)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={pending || subiendo}
          onClick={() => inputRef.current?.click()}
        >
          <Upload className="size-4" />
          {subiendo
            ? "Subiendo…"
            : `Subir ${obtenerTipoArchivoPedido(tipo)?.nombre.toLowerCase() ?? "archivo"}`}
        </Button>
        <span className="text-[12px] text-muted-foreground">
          PDF o imágenes, hasta 20 MB cada uno. Puedes elegir varias fotos a la vez.
        </span>
      </div>
    </SeccionFormulario>
  );
}
