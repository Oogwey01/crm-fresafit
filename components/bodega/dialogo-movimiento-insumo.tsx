"use client";

/* Entrada, salida o ajuste de existencias de un insumo.
   Salió de seccion-insumos.tsx, que eran 894 líneas con la tabla y sus tres
   diálogos dentro. */

import { useState } from "react";
import { toast } from "sonner";
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
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  moverInsumo,
} from "@/app/(app)/bodega/actions";
import type {
  InsumoConPresentaciones,
} from "@/lib/types";

/* --- Entrada / salida / ajuste -------------------------------------------- */
const TIPOS_MOVIMIENTO = [
  ["entrada", "Entrada"],
  ["salida", "Salida"],
  ["ajuste", "Ajuste"],
] as const;

type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number][0];

export function DialogoMovimiento({
  insumo,
  onClose,
}: {
  insumo: InsumoConPresentaciones;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [tipo, setTipo] = useState<TipoMovimiento>("salida");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{insumo.nombre}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Hay{" "}
            <b className="text-foreground">
              {insumo.stock} {insumo.unidad}
            </b>
            .
          </p>
          <ControlSegmentado opciones={TIPOS_MOVIMIENTO} valor={tipo} onCambio={setTipo} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mov-cant">{tipo === "ajuste" ? "Cuánto hay realmente" : "Cuánto"}</Label>
            <Input
              id="mov-cant"
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mov-motivo">Motivo</Label>
            <Input
              id="mov-motivo"
              placeholder={tipo === "salida" ? "Para qué se usó" : "De dónde salió"}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending || cantidad.trim() === ""}
            onClick={() =>
              ejecutar(() => moverInsumo(insumo.id, tipo, Number(cantidad), motivo), {
                error: "No se pudo mover. Revisa tu conexión.",
                alExito: (r) => {
                  const datos = "datos" in r ? r.datos : { stock: 0 };
                  toast.success(`Listo: quedan ${datos.stock} ${insumo.unidad}.`);
                  onClose();
                },
              })
            }
          >
            {pending ? "Guardando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
