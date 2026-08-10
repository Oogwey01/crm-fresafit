"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  ajustarConsignacionMaquila,
  devolverInsumoMaquila,
  enviarInsumoMaquila,
} from "@/app/(app)/maquila/actions";
import type { InsumoMaquilaConSaldo } from "@/lib/types";

type Modo = "envio" | "devolucion" | "ajuste";

const TEXTOS: Record<Modo, { titulo: string; campo: string; guardar: string; ayuda: string }> = {
  envio: {
    titulo: "Mandarle material",
    campo: "¿Cuántas piezas le mandaste?",
    guardar: "Registrar envío",
    ayuda: "Si el insumo tiene ficha en el inventario, estas piezas salen de bodega.",
  },
  devolucion: {
    titulo: "Material que regresó",
    campo: "¿Cuántas piezas regresaron?",
    guardar: "Registrar devolución",
    ayuda: "Vuelven a bodega si el insumo tiene ficha ligada.",
  },
  ajuste: {
    titulo: "Ajustar el conteo",
    campo: "¿En cuánto quedó el conteo?",
    guardar: "Ajustar",
    ayuda: "Corrige el saldo sin tocar bodega: es un conteo, no un movimiento de material.",
  },
};

/* Los tres movimientos manuales de la consignación, en un solo diálogo: lo que
   cambia entre ellos es el verbo y si el número es una cantidad o un saldo
   final. El consumo no está porque no lo hace nadie: lo escribe el trigger
   cuando la pieza sale. */
export function MovimientoInsumoDialog({
  insumo,
  modo,
  onClose,
}: {
  insumo: InsumoMaquilaConSaldo;
  modo: Modo;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [cantidad, setCantidad] = useState(modo === "ajuste" ? String(insumo.saldo) : "");
  const [motivo, setMotivo] = useState("");

  const t = TEXTOS[modo];

  function guardar() {
    const n = Number(cantidad);
    const accion =
      modo === "envio"
        ? () => enviarInsumoMaquila(insumo.id, n, motivo)
        : modo === "devolucion"
          ? () => devolverInsumoMaquila(insumo.id, n, motivo)
          : () => ajustarConsignacionMaquila(insumo.id, n, motivo);

    ejecutar(accion, {
      ok: (r) => `${insumo.nombre}: quedan ${r.datos.saldo} en su bodega.`,
      error: "No se pudo registrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>{t.titulo}</DialogTitle>
        </DialogHeader>
        <p className="text-[13.5px] text-muted-foreground">
          <strong>{insumo.nombre}</strong> — hoy tiene {insumo.saldo} {insumo.unidad}
          {insumo.saldo === 1 ? "" : "s"}
          {insumo.comprometido > 0 ? `, ${insumo.comprometido} ya comprometidas` : ""}.
        </p>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="mov-cantidad">{t.campo}</Label>
            <Input
              id="mov-cantidad"
              type="number"
              inputMode="numeric"
              min={modo === "ajuste" ? undefined : 1}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
              autoFocus
            />
            <p className="text-[12px] text-muted-foreground">{t.ayuda}</p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="mov-motivo">
              {modo === "ajuste" ? "Por qué se ajusta" : "Nota (opcional)"}
            </Label>
            <Textarea
              id="mov-motivo"
              rows={2}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder={
                modo === "ajuste"
                  ? "Contamos juntos por videollamada y salieron 24"
                  : "Se fueron con la guía 1234…"
              }
            />
          </div>
        </div>
        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={t.guardar}
          onCancelar={onClose}
          onGuardar={guardar}
        />
      </DialogContent>
    </Dialog>
  );
}
