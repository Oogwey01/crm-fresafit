"use client";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";

/* Pie estándar de los diálogos CRUD: Borrar a la izquierda (solo si procede),
   Cancelar + Guardar a la derecha con el "Guardando…" de pending. Era el mismo
   bloque copiado en cliente/proveedor/producto/gasto/venta/pedido-dialog. */
export function PieDialogoCRUD({
  pending,
  etiquetaGuardar,
  onGuardar,
  onCancelar,
  onBorrar,
}: {
  pending: boolean;
  /** "Crear cliente" / "Guardar cambios" / etc. */
  etiquetaGuardar: string;
  onGuardar: () => void;
  onCancelar: () => void;
  /** Presente solo cuando se puede borrar (edición + permiso). */
  onBorrar?: () => void;
}) {
  return (
    <DialogFooter className="gap-2 sm:justify-between">
      <div>
        {onBorrar && (
          <Button variant="destructive" onClick={onBorrar} disabled={pending}>
            Borrar
          </Button>
        )}
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={onCancelar} disabled={pending}>
          Cancelar
        </Button>
        <Button onClick={onGuardar} disabled={pending}>
          {pending ? "Guardando…" : etiquetaGuardar}
        </Button>
      </div>
    </DialogFooter>
  );
}
