"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Printer } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pastilla } from "@/components/compartido/pastilla";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  cancelarPedidoMaquila,
  editarPedidoMaquila,
  listarEventosMaquila,
} from "@/app/(app)/maquila/actions";
import {
  ACABADOS_MAQUILA,
  COLORES_PALANCA,
  COMBOS_MAQUILA,
  obtenerAcabadoMaquila,
  obtenerComboMaquila,
  obtenerEstadoMaquila,
  obtenerModeloMaquila,
  obtenerSubestadoMaquila,
} from "@/lib/catalogos";
import { direccionEnUnaLinea } from "@/lib/canales/direccion";
import { formatearFecha, formatearFechaHora } from "@/lib/fecha";
import type {
  AcabadoMaquilaId,
  ColorPalancaId,
  ComboMaquilaId,
  EventoMaquila,
  PedidoMaquila,
} from "@/lib/types";

const SIN_VALOR = "sin_valor";

/* Texto legible de un evento del historial. */
function textoEvento(e: EventoMaquila): string {
  const nombre = (id: string | null) =>
    obtenerEstadoMaquila(id)?.nombre ?? obtenerSubestadoMaquila(id)?.nombre ?? id ?? "—";
  switch (e.tipo) {
    case "creacion":
      return `entró al tablero (${e.detalle ?? "alta"})`;
    case "pago":
      return `pago aprobado — ${e.detalle ?? ""}`;
    case "estado":
    case "cancelacion":
      return `movió de «${nombre(e.de)}» a «${nombre(e.a)}»`;
    case "subestado":
      return `tercero: «${nombre(e.a)}»`;
    case "guia":
      return `capturó la guía ${e.a ?? ""}${e.detalle ? ` (${e.detalle})` : ""}`;
    case "reclasificacion":
      return `la promesa cambió de ${e.de ?? "—"} a ${e.a ?? "—"}`;
  }
}

/* El detalle de un pedido: todo el snapshot, el historial auditado y —para el
   equipo— la corrección de armado (palanca, combo, talla) que Tienda Nube no
   trae. Eduardo lo abre para ver dirección e historial; sus movimientos de
   estado viven en el tablero. */
export function PedidoMaquilaDialog({
  pedido,
  esEquipo,
  esAdmin,
  onClose,
}: {
  pedido: PedidoMaquila;
  esEquipo: boolean;
  esAdmin: boolean;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [eventos, setEventos] = useState<EventoMaquila[] | null>(null);

  const [acabado, setAcabado] = useState<AcabadoMaquilaId>(pedido.acabado);
  const [palanca, setPalanca] = useState<ColorPalancaId | null>(pedido.palanca_color);
  const [combo, setCombo] = useState<ComboMaquilaId>(pedido.combo);
  const [comboDiseno, setComboDiseno] = useState(pedido.combo_diseno ?? "");
  const [talla, setTalla] = useState(pedido.talla ?? "");
  const [color, setColor] = useState(pedido.color ?? "");
  const [notas, setNotas] = useState(pedido.notas ?? "");

  useEffect(() => {
    let vivo = true;
    void listarEventosMaquila(pedido.id).then((r) => {
      if (vivo && !("error" in r)) setEventos(r.datos.eventos);
    });
    return () => {
      vivo = false;
    };
  }, [pedido.id]);

  const estado = obtenerEstadoMaquila(pedido.estado);
  const datos: [string, string][] = [
    ["Modelo", obtenerModeloMaquila(pedido.modelo)?.nombre ?? pedido.modelo],
    ["Acabado", obtenerAcabadoMaquila(pedido.acabado)?.nombre ?? pedido.acabado],
    ["SKU", pedido.sku ?? "—"],
    ["Cantidad", String(pedido.cantidad)],
    ["Pagado", pedido.pagado_en ? formatearFechaHora(pedido.pagado_en) : "sin pago"],
    [
      "Promesa",
      pedido.fecha_prometida
        ? `${formatearFecha(pedido.fecha_prometida)}${pedido.corte_fecha ? ` (corte del ${formatearFecha(pedido.corte_fecha)})` : " (directa)"}`
        : "—",
    ],
    ...(esEquipo
      ? ([["Costo de maquila", pedido.costo_maquila != null ? `$${pedido.costo_maquila.toFixed(2)} + IVA` : "sin tarifa"]] as [string, string][])
      : []),
    ["Cliente", pedido.envio_nombre ?? "—"],
    ["Teléfono", pedido.envio_telefono ?? "—"],
    ["Dirección", direccionEnUnaLinea(pedido.envio_direccion) || "—"],
  ];

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {pedido.diseno ?? "Pedido de maquila"}
            {estado && <Pastilla nombre={estado.nombre} color={estado.color} />}
            {pedido.subestado && (
              <Pastilla
                nombre={obtenerSubestadoMaquila(pedido.subestado)?.nombre ?? pedido.subestado}
                color={obtenerSubestadoMaquila(pedido.subestado)?.color ?? "#94a3b8"}
              />
            )}
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13.5px]">
          {datos.map(([k, v]) => (
            <div key={k} className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {k}
              </div>
              <div className="truncate" title={v}>
                {v}
              </div>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={`/maquila/ficha/${pedido.id}`}
            target="_blank"
            className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-primary hover:underline"
          >
            <Printer className="size-4" /> Ficha de producción
          </Link>
        </div>

        {esEquipo && (
          <div className="grid gap-3 rounded-xl border bg-muted/30 p-3.5">
            <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
              Armado (lo que Tienda Nube no trae)
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* En los "Personalizado" de Tienda Nube el acabado lo elige el
                  cliente por pedido (sublimado o bordado con gamuza; prensado
                  no existe en personalizados): la ficha solo pone el default y
                  aquí se corrige. Si cambia, la tarifa —y la promesa, si
                  aplica— se recalculan al guardar. */}
              <div className="grid gap-1.5">
                <Label>Acabado</Label>
                <Select value={acabado} onValueChange={(v) => v && setAcabado(v as AcabadoMaquilaId)}>
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string) => obtenerAcabadoMaquila(v)?.nombre ?? "Acabado"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ACABADOS_MAQUILA.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {pedido.requiere_palanca && (
                <div className="grid gap-1.5">
                  <Label>Color de palanca</Label>
                  <Select
                    value={palanca ?? SIN_VALOR}
                    onValueChange={(v) => setPalanca(v === SIN_VALOR ? null : (v as ColorPalancaId))}
                  >
                    <SelectTrigger>
                      <SelectValue>
                        {(v: string) =>
                          COLORES_PALANCA.find((c) => c.id === v)?.nombre ?? "Sin definir"
                        }
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={SIN_VALOR}>Sin definir</SelectItem>
                      {COLORES_PALANCA.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="grid gap-1.5">
                <Label>Combo</Label>
                <Select value={combo} onValueChange={(v) => v && setCombo(v as ComboMaquilaId)}>
                  <SelectTrigger>
                    <SelectValue>
                      {(v: string) => obtenerComboMaquila(v)?.nombre ?? "Combo"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {COMBOS_MAQUILA.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {combo !== "ninguno" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="pm-combo-diseno">Diseño del accesorio</Label>
                  <Input
                    id="pm-combo-diseno"
                    value={comboDiseno}
                    onChange={(e) => setComboDiseno(e.target.value)}
                    placeholder="Debe coordinar con el cinturón"
                  />
                </div>
              )}
              <div className="grid gap-1.5">
                <Label htmlFor="pm-talla">Talla</Label>
                <Input id="pm-talla" value={talla} onChange={(e) => setTalla(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pm-color">Color</Label>
                <Input id="pm-color" value={color} onChange={(e) => setColor(e.target.value)} />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pm-notas">Notas</Label>
              <Textarea
                id="pm-notas"
                value={notas}
                onChange={(e) => setNotas(e.target.value)}
                rows={2}
              />
            </div>
          </div>
        )}

        <div>
          <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
            Historial
          </div>
          {eventos === null ? (
            <div className="text-[13px] text-muted-foreground">Cargando…</div>
          ) : eventos.length === 0 ? (
            <div className="text-[13px] text-muted-foreground">Sin movimientos.</div>
          ) : (
            <ul className="grid max-h-48 gap-1 overflow-y-auto text-[13px]">
              {eventos.map((e) => (
                <li key={e.id} className="flex items-baseline gap-2">
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatearFechaHora(e.created_at)}
                  </span>
                  <span className="min-w-0">
                    <strong>{e.autor_nombre ?? "Sistema"}</strong> {textoEvento(e)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {esEquipo ? (
          <>
            {esAdmin && !["cancelado", "devuelto"].includes(pedido.estado) && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    ejecutar(() => cancelarPedidoMaquila(pedido.id, false), {
                      confirmar:
                        "¿Cancelar este pedido? Eduardo lo verá cancelado en su tablero.",
                      ok: "Pedido cancelado.",
                      alExito: onClose,
                    })
                  }
                >
                  Cancelar pedido
                </Button>
                {["enviado", "entregado"].includes(pedido.estado) && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      ejecutar(() => cancelarPedidoMaquila(pedido.id, true), {
                        confirmar: "¿Marcar como devuelto? (La pieza regresó del cliente.)",
                        ok: "Marcado como devuelto.",
                        alExito: onClose,
                      })
                    }
                  >
                    Devuelto
                  </Button>
                )}
              </div>
            )}
            <PieDialogoCRUD
              pending={pending}
              etiquetaGuardar="Guardar cambios"
              onCancelar={onClose}
              onGuardar={() =>
                ejecutar(
                  () =>
                    editarPedidoMaquila(pedido.id, {
                      acabado,
                      palanca_color: palanca,
                      combo,
                      combo_diseno: comboDiseno,
                      talla,
                      color,
                      notas,
                    }),
                  { ok: "Pedido actualizado.", alExito: onClose },
                )
              }
            />
          </>
        ) : (
          <div className="flex justify-end">
            <Button variant="outline" onClick={onClose}>
              Cerrar
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
