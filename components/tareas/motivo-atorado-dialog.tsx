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
import { Textarea } from "@/components/ui/textarea";

/* Captura el motivo al mover una tarea a "atorado", con la UI de la app (en vez
   del window.prompt del navegador). Controlado: se abre con `open`, y al
   confirmar llama a onConfirmar(motivo) — motivo puede ir vacío. */
export function MotivoAtoradoDialog({
  open,
  motivoInicial = "",
  onConfirmar,
  onCancelar,
}: {
  open: boolean;
  motivoInicial?: string;
  onConfirmar: (motivo: string) => void;
  onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState(motivoInicial);
  /* Al abrir (para otra tarea), arrancar con su motivo previo. Se ajusta en
     render —patrón recomendado por React— para no usar un efecto. */
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setMotivo(motivoInicial);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onCancelar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>¿Por qué se atoró?</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          <Textarea
            autoFocus
            rows={3}
            placeholder="Qué necesitas de vuelta para poder avanzar…"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
          />
          <span className="text-xs text-muted-foreground">
            Le llegará un aviso a quien delegó la tarea.
          </span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancelar}>
            Cancelar
          </Button>
          <Button onClick={() => onConfirmar(motivo.trim())}>Marcar atorada</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
