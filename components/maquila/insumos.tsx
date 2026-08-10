"use client";

import { useState } from "react";
import { PackagePlus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pastilla } from "@/components/compartido/pastilla";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { MovimientoInsumoDialog } from "@/components/maquila/movimiento-insumo-dialog";
import { obtenerTipoMovConsignacion } from "@/lib/catalogos";
import { formatearFechaHora } from "@/lib/fecha";
import { cn } from "@/lib/utils";
import type { InsumoMaquilaConSaldo, MovConsignacionMaquila } from "@/lib/types";

/* Lo que Fresa Fit le tiene a Eduardo en su bodega. Arriba, el saldo de cada
   insumo con lo que ya está comprometido por los pedidos que no han salido;
   abajo, la bitácora de cómo llegó ahí.

   El saldo puede salir negativo y NO es un error de la pantalla: significa que
   se gastó material que el CRM creía agotado. Se pinta en rojo para que se
   corrija con un ajuste, no se esconde. */
export function InsumosMaquila({
  insumos,
  movimientos,
  puedeMover,
  puedeAjustar,
}: {
  insumos: InsumoMaquilaConSaldo[];
  movimientos: MovConsignacionMaquila[];
  puedeMover: boolean;
  puedeAjustar: boolean;
}) {
  const [mover, setMover] = useState<{
    insumo: InsumoMaquilaConSaldo;
    modo: "envio" | "devolucion" | "ajuste";
  } | null>(null);

  const columnas: Columna<MovConsignacionMaquila>[] = [
    {
      clave: "insumo",
      label: "Insumo",
      esTitulo: true,
      celda: (m) => <span className="font-medium">{m.insumo_nombre ?? "—"}</span>,
    },
    {
      clave: "tipo",
      label: "Qué pasó",
      celda: (m) => {
        const t = obtenerTipoMovConsignacion(m.tipo);
        return t ? <Pastilla nombre={t.nombre} color={t.color} /> : <span>{m.tipo}</span>;
      },
    },
    {
      clave: "cantidad",
      label: "Piezas",
      celda: (m) => (
        <span
          className={cn(
            "font-semibold tabular-nums",
            m.tipo === "consumo" ? "text-orange-600" : m.tipo === "envio" ? "text-emerald-600" : "",
          )}
        >
          {m.tipo === "consumo" || m.tipo === "devolucion" ? "−" : m.tipo === "envio" ? "+" : "±"}
          {m.cantidad}
        </span>
      ),
    },
    {
      clave: "saldo",
      label: "Quedó en",
      celda: (m) => (
        <span className="tabular-nums text-muted-foreground">{m.saldo_resultante}</span>
      ),
    },
    {
      clave: "cuando",
      label: "Cuándo",
      celda: (m) => (
        <div className="min-w-0">
          <div className="truncate text-muted-foreground">{formatearFechaHora(m.created_at)}</div>
          <div className="truncate text-[11.5px] text-muted-foreground/80">
            {m.autor_nombre ?? "Sistema"}
            {m.motivo ? ` · ${m.motivo}` : ""}
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-5">
      <div>
        <h2 className="mb-1 text-[15px] font-semibold">Material en su bodega</h2>
        <p className="mb-3 text-[13.5px] text-muted-foreground">
          Lo que le mandamos y él guarda. Se descuenta solo cuando sale un pedido que lo lleva:
          las palancas de los Powerlift y, en los combos, muñequeras y straps.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {insumos.map((i) => {
            const bajo = i.saldo <= i.minimo;
            const negativo = i.saldo < 0;
            const alcanza = i.saldo - i.comprometido;
            return (
              <div
                key={i.id}
                className={cn(
                  "rounded-[13px] border bg-card p-4",
                  negativo
                    ? "border-red-500/40"
                    : bajo
                      ? "border-amber-500/40"
                      : "border-border",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-medium text-muted-foreground">{i.nombre}</span>
                  {!i.activo && <Pastilla nombre="Apagado" color="#64748b" />}
                </div>
                <div
                  className={cn(
                    "mt-1 text-[28px] font-bold leading-none tabular-nums",
                    negativo ? "text-red-600" : bajo ? "text-amber-600" : "",
                  )}
                >
                  {i.saldo}
                </div>
                <div className="mt-1.5 text-[12px] text-muted-foreground">
                  {i.comprometido > 0
                    ? `${i.comprometido} comprometidas · quedan ${alcanza} libres`
                    : `mínimo ${i.minimo} ${i.unidad}s`}
                </div>
                {negativo && (
                  <div className="mt-1.5 text-[12px] font-medium text-red-600">
                    Gastó más de lo que el CRM tenía contado: hay que ajustar.
                  </div>
                )}
                {i.producto_id === null && (
                  <div className="mt-1.5 text-[11.5px] text-muted-foreground/80">
                    Sin ficha en el inventario: mandarle piezas no baja bodega.
                  </div>
                )}
                {puedeMover && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Button
                      size="sm"
                      className="gap-1.5"
                      onClick={() => setMover({ insumo: i, modo: "envio" })}
                    >
                      <PackagePlus className="size-3.5" />
                      Mandarle
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => setMover({ insumo: i, modo: "devolucion" })}
                    >
                      <Undo2 className="size-3.5" />
                      Regresó
                    </Button>
                    {puedeAjustar && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setMover({ insumo: i, modo: "ajuste" })}
                      >
                        Ajustar
                      </Button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <TablaSimple
        cols="grid-cols-[minmax(180px,1fr)_150px_110px_110px_minmax(180px,1fr)]"
        columnas={columnas}
        datos={movimientos}
        filaKey={(m) => m.id}
        titulo="Movimientos"
        minW="min-w-[860px]"
        vacio="Todavía no se le ha mandado material."
      />

      {mover && (
        <MovimientoInsumoDialog
          insumo={mover.insumo}
          modo={mover.modo}
          onClose={() => setMover(null)}
        />
      )}
    </div>
  );
}
