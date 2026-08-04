"use client";

import { useState } from "react";
import { ExternalLink, MapPin } from "lucide-react";
import { direccionEnUnaLinea } from "@/lib/canales/direccion";
import { urlRastreo } from "@/lib/pedidos/rastreo";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { PAQUETERIAS } from "@/lib/catalogos";
import { guardarEnvio } from "@/app/(app)/pedidos/actions";
import type { PedidoEnvio } from "@/lib/types";

const DATALIST_ID = "paqueterias-sugeridas";

/* Paquetería y número de guía de un pedido. Ambos son texto libre; las
   paqueterías se sugieren con un datalist pero se puede escribir cualquiera. */
export function EnvioDialog({
  pedido,
  gestor,
  onClose,
}: {
  pedido: PedidoEnvio;
  gestor: boolean;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [paqueteria, setPaqueteria] = useState(pedido.paqueteria ?? "");
  const [numGuia, setNumGuia] = useState(pedido.num_guia ?? "");
  const rastreo = urlRastreo(pedido.paqueteria, pedido.num_guia, pedido.url_rastreo);

  function guardar() {
    ejecutar(() => guardarEnvio(pedido.id, paqueteria, numGuia), {
      ok: "Datos de envío guardados.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  const nombre = pedido.producto
    ? `${pedido.producto.nombre}${pedido.producto.variante ? ` · ${pedido.producto.variante}` : ""}`
    : (pedido.descripcion ?? "Pedido");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Envío del pedido</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="font-medium">{nombre}</span>
            {pedido.cliente?.nombre && (
              <span className="text-muted-foreground"> — {pedido.cliente.nombre}</span>
            )}
          </p>

          {/* Dirección de entrega tal como la mandó el canal. Es de solo lectura
              a propósito: la fuente de verdad es la plataforma, y aquí solo se
              necesita para empacar sin tener que ir a buscarla allá. */}
          {pedido.envio_direccion && (
            <div className="rounded-lg border px-3 py-2 text-[13px]">
              <div className="mb-1 flex items-start gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <MapPin className="size-3.5" aria-hidden="true" />
                Enviar a
              </div>
              {pedido.envio_direccion.nombre && (
                <div className="font-medium">{pedido.envio_direccion.nombre}</div>
              )}
              <div className="text-muted-foreground">
                {direccionEnUnaLinea(pedido.envio_direccion)}
              </div>
              {pedido.envio_direccion.telefono && (
                <div className="text-muted-foreground">Tel. {pedido.envio_direccion.telefono}</div>
              )}
              {pedido.envio_direccion.referencias && (
                <div className="mt-1 text-[12px] italic text-muted-foreground">
                  {pedido.envio_direccion.referencias}
                </div>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="envio-paqueteria">Paquetería</Label>
            <Input
              id="envio-paqueteria"
              list={DATALIST_ID}
              autoFocus={!gestor ? undefined : true}
              placeholder="Estafeta, DHL, FedEx…"
              value={paqueteria}
              onChange={(e) => setPaqueteria(e.target.value)}
            />
            <datalist id={DATALIST_ID}>
              {PAQUETERIAS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="envio-guia">Número de guía / rastreo</Label>
            <Input
              id="envio-guia"
              placeholder="Ej. 1234 5678 9012"
              value={numGuia}
              onChange={(e) => setNumGuia(e.target.value)}
            />
            {/* Se ofrece sobre lo GUARDADO, no sobre lo que se está escribiendo:
                el enlace lleva al paquete que de verdad está registrado. */}
            {rastreo && (
              <a
                href={rastreo}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex w-fit items-center gap-1 text-[12.5px] font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3.5" />
                Ver dónde va el paquete
              </a>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={pending}>
            {pending ? "Guardando…" : "Guardar envío"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
