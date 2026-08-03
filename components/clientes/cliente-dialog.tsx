"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { CANALES } from "@/lib/catalogos";
import { guardarCliente, borrarCliente, type ClienteInput } from "@/app/(app)/clientes/actions";
import type { CanalId, Customer } from "@/lib/types";

const SIN_CANAL = "none";

/* Alta y edición de un cliente. Los que vienen de Tienda Nube se refrescan con
   cada importación: su nombre y contacto se administran en la tienda. */
export function ClienteDialog({
  cliente,
  gestor,
  onClose,
}: {
  cliente: Customer | null; // null = alta
  gestor: boolean;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const deTiendaNube = cliente?.tiendanube_customer_id != null;

  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [correo, setCorreo] = useState(cliente?.correo ?? "");
  const [canal, setCanal] = useState<string>(cliente?.canal ?? SIN_CANAL);
  const [notas, setNotas] = useState(cliente?.notas ?? "");

  function guardar() {
    if (!nombre.trim()) {
      toast.error("El cliente necesita un nombre.");
      return;
    }
    const input: ClienteInput = {
      nombre,
      telefono,
      correo,
      canal: canal === SIN_CANAL ? null : (canal as CanalId),
      notas,
    };
    ejecutar(() => guardarCliente(cliente?.id ?? null, input), {
      ok: cliente ? "Cliente actualizado." : "Cliente creado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!cliente) return;
    ejecutar(() => borrarCliente(cliente.id), {
      confirmar: `¿Borrar a «${cliente.nombre}»? Sus compras se conservan, pero quedan sin cliente.`,
      ok: "Cliente borrado.",
      error: "No se pudo borrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{cliente ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {deTiendaNube && (
            <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">
              Cliente de Tienda Nube: su nombre y contacto se actualizan con cada importación (se
              administran en la tienda). Las notas sí son tuyas y no se pisan.
            </p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cli-nombre">Nombre</Label>
            <Input
              id="cli-nombre"
              autoFocus={!cliente}
              disabled={deTiendaNube}
              placeholder="Nombre y apellido"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cli-telefono">Teléfono</Label>
              <Input
                id="cli-telefono"
                type="tel"
                disabled={deTiendaNube}
                placeholder="+52 …"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cli-correo">Correo</Label>
              <Input
                id="cli-correo"
                type="email"
                disabled={deTiendaNube}
                placeholder="cliente@correo.com"
                value={correo}
                onChange={(e) => setCorreo(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Canal de origen</Label>
            <Select value={canal} onValueChange={(v) => setCanal(v ?? SIN_CANAL)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) =>
                    v === SIN_CANAL
                      ? "Sin canal"
                      : (CANALES.find((c) => c.id === v)?.nombre ?? "Canal")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CANAL}>Sin canal</SelectItem>
                {CANALES.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cli-notas">Notas (mayoreo, atención especial…)</Label>
            <Textarea
              id="cli-notas"
              rows={3}
              placeholder="Compra al mayoreo; pedir factura; contactar por WhatsApp…"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={cliente ? "Guardar cambios" : "Crear cliente"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={cliente && gestor ? borrar : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
