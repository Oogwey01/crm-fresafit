"use client";

import { useState, useTransition } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  guardarProveedor,
  borrarProveedor,
  type ProveedorInput,
} from "@/app/(app)/inventario/actions";
import type { Supplier } from "@/lib/types";

/* Alta y edición de un proveedor. */
export function ProveedorDialog({
  proveedor,
  gestor,
  onClose,
}: {
  proveedor: Supplier | null; // null = alta
  gestor: boolean;
  onClose: () => void;
}) {
  const [pending, startTransition] = useTransition();
  const [nombre, setNombre] = useState(proveedor?.nombre ?? "");
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? "");
  const [correo, setCorreo] = useState(proveedor?.correo ?? "");
  const [notas, setNotas] = useState(proveedor?.notas ?? "");

  function guardar() {
    if (!nombre.trim()) {
      toast.error("El proveedor necesita un nombre.");
      return;
    }
    const input: ProveedorInput = { nombre, telefono, correo, notas };
    startTransition(async () => {
      try {
        const r = await guardarProveedor(proveedor?.id ?? null, input);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success(proveedor ? "Proveedor actualizado." : "Proveedor creado.");
        onClose();
      } catch {
        toast.error("No se pudo guardar. Revisa tu conexión.");
      }
    });
  }

  function borrar() {
    if (!proveedor) return;
    if (!window.confirm(`¿Borrar a «${proveedor.nombre}»? Sus pedidos se borran también.`)) return;
    startTransition(async () => {
      try {
        const r = await borrarProveedor(proveedor.id);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success("Proveedor borrado.");
        onClose();
      } catch {
        toast.error("No se pudo borrar. Revisa tu conexión.");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{proveedor ? "Editar proveedor" : "Nuevo proveedor"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prov-nombre">Nombre</Label>
            <Input
              id="prov-nombre"
              autoFocus
              placeholder="Nancy"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prov-telefono">Teléfono</Label>
              <Input
                id="prov-telefono"
                type="tel"
                placeholder="+52 …"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="prov-correo">Correo</Label>
              <Input
                id="prov-correo"
                type="email"
                placeholder="proveedor@correo.com"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="prov-notas">Notas (opcional)</Label>
            <Textarea
              id="prov-notas"
              rows={2}
              placeholder="Qué surte, tiempos de entrega, condiciones…"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <div>
            {proveedor && gestor && (
              <Button variant="destructive" onClick={borrar} disabled={pending}>
                Borrar
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button onClick={guardar} disabled={pending}>
              {pending ? "Guardando…" : proveedor ? "Guardar cambios" : "Crear proveedor"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
