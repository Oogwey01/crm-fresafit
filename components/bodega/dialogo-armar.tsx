"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Hammer, Info, Lock, Undo2 } from "lucide-react";
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
import { armarConjunto, desarmarConjunto } from "@/app/(app)/bodega/actions";
import { formatearFechaHora } from "@/lib/fecha";
import type { ProductoLigeroFila } from "@/app/(app)/bodega/page";
import type { ConjuntoArmado, ConjuntoConComponentes, Profile } from "@/lib/types";

/* Registrar lo que bodega armó: bajan las piezas, sube la ficha del conjunto.

   La vista previa no es adorno. Es un movimiento de stock real y difícil de
   auditar después (toca cuatro fichas a la vez), así que se enseña el antes y el
   después de cada una ANTES de confirmar, con los mismos números que va a
   escribir la base. */
export function DialogoArmar({
  conjunto,
  productos,
  armados,
  equipo,
  onClose,
}: {
  conjunto: ConjuntoConComponentes;
  productos: ProductoLigeroFila[];
  armados: ConjuntoArmado[];
  equipo: Profile[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [cantidad, setCantidad] = useState("");

  const n = Number(cantidad) || 0;
  const ficha = productos.find((p) => p.id === conjunto.producto_id) ?? null;

  /* La receta se agrega por ficha, igual que en la RPC: dos renglones pueden
     apuntar al mismo producto y contarlos por separado engañaría. */
  const piezas = useMemo(() => {
    const porFicha = new Map<string, { producto: ProductoLigeroFila; porUnidad: number }>();
    for (const c of conjunto.componentes) {
      if (!c.producto_id) continue;
      const producto = productos.find((p) => p.id === c.producto_id);
      if (!producto) continue;
      const previo = porFicha.get(c.producto_id);
      porFicha.set(c.producto_id, {
        producto,
        porUnidad: (previo?.porUnidad ?? 0) + c.cantidad,
      });
    }
    return [...porFicha.values()];
  }, [conjunto.componentes, productos]);

  const falta = piezas.find((p) => n > 0 && p.producto.stock < p.porUnidad * n);

  const nombrePor = (id: string | null) =>
    (id && equipo.find((p) => p.id === id)?.nombre) || "alguien";

  const revertidos = new Set(armados.map((a) => a.revierte_a).filter(Boolean) as string[]);
  const historial = armados.filter((a) => a.tipo === "armado").slice(0, 6);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Armar <span className="font-mono">{conjunto.sku}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3.5">
          <p className="flex items-start gap-2 rounded-xl bg-muted/50 p-3.5 text-[12.5px] leading-relaxed text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" strokeWidth={1.9} />
            <span>
              Registrar un armado <b className="font-semibold text-foreground">mueve stock de
              verdad</b>: se descuentan las piezas y se le suman al SKU del conjunto. Hazlo cuando
              los conjuntos <b className="font-semibold text-foreground">ya estén armados
              físicamente</b>, no cuando pienses armarlos.
            </span>
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="cj-cantidad">¿Cuántos armaste?</Label>
            <Input
              id="cj-cantidad"
              type="number"
              min="1"
              step="1"
              autoFocus
              className="w-32"
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </div>

          {n > 0 && (
            <div className="flex flex-col gap-2 rounded-xl border bg-card p-3.5 text-[12.5px]">
              <p className="font-semibold text-muted-foreground">Se descuentan</p>
              {piezas.map(({ producto, porUnidad }) => {
                const usa = porUnidad * n;
                const alcanza = producto.stock >= usa;
                return (
                  <div key={producto.id} className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate">{producto.nombre}</span>
                    <span className="font-mono text-muted-foreground">{producto.sku ?? "—"}</span>
                    <span
                      className={
                        alcanza ? "tabular-nums" : "font-semibold tabular-nums text-red-600"
                      }
                    >
                      {producto.stock} → {producto.stock - usa}
                    </span>
                  </div>
                );
              })}
              <p className="mt-1 font-semibold text-muted-foreground">Se acredita</p>
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate">{ficha?.nombre ?? conjunto.titulo}</span>
                <span className="font-mono text-muted-foreground">{ficha?.sku ?? conjunto.sku}</span>
                <span className="tabular-nums text-emerald-700 dark:text-emerald-500">
                  {ficha?.stock ?? 0} → {(ficha?.stock ?? 0) + n}
                </span>
              </div>
            </div>
          )}

          {falta && (
            <p className="rounded-lg bg-amber-500/10 px-3.5 py-2 text-[13px] text-amber-700 dark:text-amber-400">
              No alcanza: «{falta.producto.nombre}» necesita {falta.porUnidad * n} piezas y solo hay{" "}
              {falta.producto.stock}.
            </p>
          )}

          {historial.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-[12.5px] font-semibold text-muted-foreground">Últimos armados</p>
              {historial.map((a) => {
                const deshecho = revertidos.has(a.id);
                return (
                  <div key={a.id} className="flex items-center gap-2 text-[12.5px]">
                    <span className="text-muted-foreground">{formatearFechaHora(a.created_at)}</span>
                    <span>· Armé {a.cantidad} ·</span>
                    <span className="text-muted-foreground">{nombrePor(a.created_by)}</span>
                    <div className="flex-1" />
                    {deshecho ? (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11.5px] text-muted-foreground">
                        deshecho
                      </span>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={pending}
                        onClick={() =>
                          ejecutar(() => desarmarConjunto(a.id), {
                            confirmar:
                              `¿Deshacer este armado? Vuelven las piezas de cada componente al ` +
                              `inventario y ${ficha?.sku ?? conjunto.sku} baja ${a.cantidad}.`,
                            ok: "Armado deshecho.",
                            error: "No se pudo deshacer. Revisa tu conexión.",
                          })
                        }
                      >
                        <Undo2 className="size-3.5" /> Deshacer
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-col gap-1 text-[12px] leading-relaxed text-muted-foreground">
            <p>
              Queda firmado con tu nombre en el historial de inventario y se puede deshacer mientras
              los conjuntos no se hayan vendido.
            </p>
            <p className="flex items-start gap-1.5">
              <Lock className="mt-0.5 size-3 shrink-0" strokeWidth={2} />
              <span>
                El movimiento <b className="font-semibold text-foreground">se queda en el CRM</b>.
                Tienda Nube y Mercado Libre no se enteran: allá el stock se sube a mano, y hasta que
                lo hagas el conjunto aparece en «Por subir a los canales».
              </span>
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending || n <= 0 || !!falta}
            onClick={() =>
              ejecutar(() => armarConjunto(conjunto.id, n), {
                error: "No se pudo registrar el armado. Revisa tu conexión.",
                alExito: () => {
                  toast.success(
                    `Listo: ${n} ${n === 1 ? "conjunto armado" : "conjuntos armados"}. ` +
                      `${ficha?.sku ?? conjunto.sku} pasa de ${ficha?.stock ?? 0} a ${(ficha?.stock ?? 0) + n}.`,
                  );
                  onClose();
                },
              })
            }
          >
            <Hammer className="size-4" />
            {pending ? "Registrando…" : `Armé ${n > 0 ? n : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
