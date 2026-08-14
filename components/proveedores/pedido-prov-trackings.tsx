"use client";

import { useState } from "react";
import { ExternalLink, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SeccionFormulario } from "@/components/compartido/dialogo-formulario";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { PAQUETERIAS } from "@/lib/catalogos";
import {
  agregarTrackingPedido,
  borrarTrackingPedido,
} from "@/app/(app)/proveedores/actions";
import type { SupplierOrderTracking } from "@/lib/types";

/* Las guías del pedido. Un pedido a China casi nunca viaja completo en un solo
   envío: el proveedor lo parte en varios tracking numbers y de cada uno avisa
   qué trae. Antes había UNA guía en el pedido; ahora son renglones (junta
   13/08). Solo sobre pedido ya guardado: necesita su id, igual que los pagos. */
export function TrackingsPedido({
  pedidoId,
  trackings,
  onCambio,
}: {
  pedidoId: string;
  trackings: SupplierOrderTracking[];
  onCambio: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [paqueteria, setPaqueteria] = useState("");
  const [numGuia, setNumGuia] = useState("");
  const [urlRastreo, setUrlRastreo] = useState("");
  const [contenido, setContenido] = useState("");

  function agregar() {
    if (!numGuia.trim()) return;
    ejecutar(
      () => agregarTrackingPedido(pedidoId, { paqueteria, num_guia: numGuia, url_rastreo: urlRastreo, contenido }),
      {
        ok: "Guía registrada.",
        alExito: () => {
          setPaqueteria("");
          setNumGuia("");
          setUrlRastreo("");
          setContenido("");
          onCambio();
        },
      },
    );
  }

  return (
    <SeccionFormulario
      titulo="Guías del envío"
      pasoTitulo="Guías del envío"
      pasoAyuda="El proveedor puede partir el pedido en varios envíos: una guía por renglón, con qué trae cada una."
      contador={trackings.length || null}
      abiertaPorDefecto={trackings.length > 0}
    >
      <div className="flex flex-col gap-1">
        {trackings.map((t) => (
          <div key={t.id} className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm">
            <span className="font-mono text-[12.5px] font-semibold">{t.num_guia}</span>
            {t.paqueteria && <span className="text-muted-foreground">{t.paqueteria}</span>}
            {t.contenido && (
              <span className="min-w-0 truncate text-muted-foreground" title={t.contenido}>
                · {t.contenido}
              </span>
            )}
            {t.url_rastreo && (
              <a
                href={t.url_rastreo}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline"
                title="Rastrear"
              >
                <ExternalLink className="size-3.5" />
              </a>
            )}
            <button
              type="button"
              onClick={() =>
                ejecutar(() => borrarTrackingPedido(t.id), { ok: "Guía borrada.", alExito: onCambio })
              }
              className="ml-auto text-muted-foreground hover:text-destructive"
              aria-label="Borrar guía"
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
        {trackings.length === 0 && (
          <p className="text-[13px] text-muted-foreground">Sin guías registradas todavía.</p>
        )}
      </div>

      {/* Alta: paquetería · guía · link · contenido. */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          list="paqueterias-pedido"
          placeholder="Paquetería"
          className="w-32"
          value={paqueteria}
          onChange={(e) => setPaqueteria(e.target.value)}
        />
        <datalist id="paqueterias-pedido">
          {PAQUETERIAS.map((p) => (
            <option key={p} value={p} />
          ))}
        </datalist>
        <Input
          placeholder="Nº de guía"
          className="w-40 font-mono"
          value={numGuia}
          onChange={(e) => setNumGuia(e.target.value)}
        />
        <Input
          placeholder="Link de rastreo (opcional)"
          className="min-w-[140px] flex-1"
          value={urlRastreo}
          onChange={(e) => setUrlRastreo(e.target.value)}
        />
        <Input
          placeholder="Qué viene en esta guía («los straps y 20 cintos»)"
          className="min-w-[200px] flex-[2]"
          value={contenido}
          onChange={(e) => setContenido(e.target.value)}
        />
        <Button variant="outline" size="sm" onClick={agregar} disabled={pending || !numGuia.trim()}>
          Agregar guía
        </Button>
      </div>
    </SeccionFormulario>
  );
}
