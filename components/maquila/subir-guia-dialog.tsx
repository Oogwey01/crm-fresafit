"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { subirGuiaMaquila } from "@/app/(app)/maquila/actions";
import { PAQUETERIAS } from "@/lib/catalogos";
import type { GuiaMaquilaConPedidos } from "@/lib/types";

/* Logística surte la guía: el archivo que Eduardo imprime y el número que hace
   falta para que la BD lo deje marcar enviado. Los dos van juntos a propósito
   —una etiqueta sin número deja el pedido a medias— y el número baja solo a
   todos los renglones del paquete. */
export function SubirGuiaDialog({
  guia,
  onClose,
}: {
  guia: GuiaMaquilaConPedidos;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const archivoRef = useRef<HTMLInputElement>(null);
  const [paqueteria, setPaqueteria] = useState(guia.paqueteria ?? "");
  const [numGuia, setNumGuia] = useState(guia.num_guia ?? "");

  const primero = guia.pedidos[0];

  function guardar() {
    const file = archivoRef.current?.files?.[0];
    if (!file) {
      toast.error("Elige el archivo de la guía.");
      return;
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("paqueteria", paqueteria);
    fd.append("num_guia", numGuia);
    ejecutar(() => subirGuiaMaquila(guia.id, fd), {
      ok: (r) =>
        r.datos.pedidos > 0
          ? `Guía lista. Eduardo ya puede imprimirla (${r.datos.pedidos} renglón(es) actualizados).`
          : "Guía lista. Eduardo ya puede imprimirla.",
      error: "No se pudo subir la guía. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Subir guía</DialogTitle>
        </DialogHeader>
        <p className="text-[13.5px] text-muted-foreground">
          {guia.pedidos.map((p) => p.diseno ?? p.sku ?? "Pedido").join(" + ")}
          {primero?.numero_orden ? ` — orden ${primero.numero_orden}` : ""}
          {primero?.envio_nombre ? `, para ${primero.envio_nombre}` : ""}.
        </p>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="guia-archivo">Archivo de la guía (PDF o imagen)</Label>
            <Input
              id="guia-archivo"
              ref={archivoRef}
              type="file"
              accept="application/pdf,image/*"
              className="cursor-pointer"
            />
            {guia.archivo_nombre && (
              <p className="text-[12px] text-muted-foreground">
                Ahora tiene <strong>{guia.archivo_nombre}</strong>; si subes otro, lo reemplaza.
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="guia-paqueteria">Paquetería</Label>
            <Input
              id="guia-paqueteria"
              list="subir-guia-paqueterias"
              value={paqueteria}
              onChange={(e) => setPaqueteria(e.target.value)}
              placeholder="Estafeta, DHL…"
            />
            <datalist id="subir-guia-paqueterias">
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
            />
            <p className="text-[12px] text-muted-foreground">
              Sin este número la base no deja marcar el pedido como enviado.
            </p>
          </div>
        </div>
        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar="Subir y avisar"
          onCancelar={onClose}
          onGuardar={guardar}
        />
      </DialogContent>
    </Dialog>
  );
}
