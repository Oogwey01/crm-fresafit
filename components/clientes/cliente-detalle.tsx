"use client";

import { Pencil } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { obtenerCanal } from "@/lib/catalogos";
import { formatearFecha } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { CustomerConStats, SaleConProducto } from "@/lib/types";

function nombreVenta(v: SaleConProducto): string {
  return v.producto
    ? `${v.producto.nombre}${v.producto.variante ? ` · ${v.producto.variante}` : ""}`
    : (v.descripcion ?? "—");
}

/* Ficha del cliente: datos, números y su historial de compras. */
export function ClienteDetalle({
  cliente,
  historial,
  cargandoHistorial = false,
  onEditar,
  onClose,
}: {
  cliente: CustomerConStats;
  historial: SaleConProducto[];
  cargandoHistorial?: boolean;
  onEditar: () => void;
  onClose: () => void;
}) {
  const canal = obtenerCanal(cliente.canal ?? "");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {cliente.nombre}
            {cliente.recurrente && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10.5px] font-bold text-primary">
                Recurrente
              </span>
            )}
            {cliente.tiendanube_customer_id && (
              <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                Tienda Nube
              </span>
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {/* Datos de contacto */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Contacto
              </div>
              <div className="mt-1">
                {cliente.correo ? (
                  <a href={`mailto:${cliente.correo}`} className="hover:underline">
                    {cliente.correo}
                  </a>
                ) : (
                  <span className="text-muted-foreground/60">Sin correo</span>
                )}
              </div>
              <div>
                {cliente.telefono ? (
                  <a href={`tel:${cliente.telefono}`} className="hover:underline">
                    {cliente.telefono}
                  </a>
                ) : (
                  <span className="text-muted-foreground/60">Sin teléfono</span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Canal de origen
              </div>
              <div className="mt-1">
                {canal ? (
                  <span
                    className="inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold"
                    style={{ backgroundColor: `${canal.color}1F`, color: canal.color }}
                  >
                    {canal.nombre}
                  </span>
                ) : (
                  <span className="text-muted-foreground/60">—</span>
                )}
              </div>
            </div>
          </div>

          {/* Números */}
          <div className="grid grid-cols-3 gap-3 rounded-xl border bg-muted/30 px-4 py-3 text-center">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Compras
              </div>
              <div className="text-lg font-bold tabular-nums">{cliente.compras}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Total gastado
              </div>
              <div className="text-lg font-bold tabular-nums">{formatearMXN(cliente.total)}</div>
            </div>
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Última compra
              </div>
              <div className="text-lg font-bold">
                {cliente.ultimaCompra ? formatearFecha(cliente.ultimaCompra) : "—"}
              </div>
            </div>
          </div>

          {/* Notas del equipo */}
          {cliente.notas && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Notas
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{cliente.notas}</p>
            </div>
          )}

          {/* Historial de compras */}
          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Historial de compras
            </div>
            {cargandoHistorial ? (
              <p className="text-sm italic text-muted-foreground">Cargando…</p>
            ) : historial.length === 0 ? (
              <p className="text-sm italic text-muted-foreground">
                Todavía no tiene compras registradas.
              </p>
            ) : (
              <ul className="max-h-64 overflow-y-auto rounded-xl border">
                {historial.map((v) => (
                  <li
                    key={v.id}
                    className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0"
                  >
                    <span className="w-16 shrink-0 text-muted-foreground">
                      {formatearFecha(v.fecha)}
                    </span>
                    <span className="flex-1 truncate" title={nombreVenta(v)}>
                      {nombreVenta(v)}
                    </span>
                    <span className="shrink-0 text-muted-foreground">×{v.cantidad}</span>
                    <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                      {formatearMXN(v.monto)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
          <Button onClick={onEditar}>
            <Pencil className="size-4" strokeWidth={2} />
            Editar datos
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
