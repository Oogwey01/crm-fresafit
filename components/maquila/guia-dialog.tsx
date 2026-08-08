"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { capturarGuiaMaquila } from "@/app/(app)/maquila/actions";
import { PAQUETERIAS } from "@/lib/catalogos";
import type { PedidoMaquila } from "@/lib/types";

/* Capturar la guía ES marcar enviado (paso 5 del flujo): un solo diálogo, dos
   campos, y el action propaga la guía a los renglones hermanos de la misma
   orden que ya estén terminados. */
export function GuiaMaquilaDialog({
  pedido,
  onClose,
}: {
  pedido: PedidoMaquila;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [paqueteria, setPaqueteria] = useState(pedido.paqueteria ?? "");
  const [numGuia, setNumGuia] = useState(pedido.num_guia ?? "");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>Guía de envío</DialogTitle>
        </DialogHeader>
        <p className="text-[13.5px] text-muted-foreground">
          {pedido.diseno ?? "Pedido"}
          {pedido.numero_orden ? ` — orden ${pedido.numero_orden}` : ""}. Al guardar, el pedido
          queda como <strong>enviado</strong>.
        </p>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="guia-paqueteria">Paquetería</Label>
            <Input
              id="guia-paqueteria"
              list="guia-paqueterias"
              value={paqueteria}
              onChange={(e) => setPaqueteria(e.target.value)}
              placeholder="Estafeta, DHL…"
            />
            <datalist id="guia-paqueterias">
              {PAQUETERIAS.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="guia-numero">Número de guía</Label>
            <Input
              id="guia-numero"
              value={numGuia}
              onChange={(e) => setNumGuia(e.target.value)}
              placeholder="Lo que diga la etiqueta"
              autoFocus
            />
          </div>
        </div>
        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar="Guardar y marcar enviado"
          onCancelar={onClose}
          onGuardar={() =>
            ejecutar(() => capturarGuiaMaquila(pedido.id, paqueteria, numGuia), {
              ok: (r) =>
                r.datos.hermanos > 0
                  ? `Enviado, junto con ${r.datos.hermanos} renglón(es) más de la orden.`
                  : "Enviado.",
              alExito: onClose,
            })
          }
        />
      </DialogContent>
    </Dialog>
  );
}
