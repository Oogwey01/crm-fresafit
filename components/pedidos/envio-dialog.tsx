"use client";

import { useState } from "react";
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
