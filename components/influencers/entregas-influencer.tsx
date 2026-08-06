"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/compartido/date-picker";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  guardarEntrega,
  borrarEntrega,
  guardarEvaluacion,
} from "@/app/(app)/influencers/actions";
import { obtenerTierInfluencer } from "@/lib/catalogos";
import { formatearFecha, hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { VistaDinero } from "@/lib/permisos-dinero";
import { cn } from "@/lib/utils";
import { aNumero } from "@/lib/validacion";
import type { Influencer, InfluencerEntrega, InfluencerEvaluacion } from "@/lib/types";
import type { ProductoLigero } from "@/components/influencers/panel";

const PRODUCTO_LIBRE = "libre";

/* Ficha de trabajo de una persona: qué material se le mandó (contra su crédito
   mensual) y la evaluación del mes. Es lo que en la hoja «Embajadores FF» eran
   dos bloques sueltos por persona. */
export function EntregasInfluencer({
  influencer,
  entregas,
  evaluaciones,
  productos,
  dinero,
  onClose,
}: {
  influencer: Influencer;
  entregas: InfluencerEntrega[];
  evaluaciones: InfluencerEvaluacion[];
  productos: ProductoLigero[];
  /* El valor de lo entregado es egreso; lo que vendió su código, ingreso. */
  dinero: VistaDinero;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();

  /* Alta de entrega */
  const [fecha, setFecha] = useState(hoyISO());
  const [productoId, setProductoId] = useState<string | null>(null);
  const [descripcion, setDescripcion] = useState("");
  const [talla, setTalla] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [valor, setValor] = useState("");

  /* Evaluación del mes */
  const [periodo, setPeriodo] = useState(hoyISO().slice(0, 7));
  const evaluacionDelMes = evaluaciones.find((e) => e.periodo.startsWith(periodo));
  const [usos, setUsos] = useState("");
  const [ventas, setVentas] = useState("");
  const [videos, setVideos] = useState("");
  const [stories, setStories] = useState("");
  const [participaciones, setParticipaciones] = useState("");
  const [observaciones, setObservaciones] = useState("");

  const tier = obtenerTierInfluencer(influencer.tier);
  const credito = influencer.credito_mensual ?? tier?.creditoMensual ?? null;
  const mesActual = hoyISO().slice(0, 7);
  const entregadoEsteMes = entregas
    .filter((e) => e.fecha.startsWith(mesActual))
    .reduce((acc, e) => acc + (e.valor ?? 0) * e.cantidad, 0);

  function agregarEntrega() {
    ejecutar(
      () =>
        guardarEntrega(null, {
          influencer_id: influencer.id,
          fecha,
          producto_id: productoId,
          descripcion,
          talla,
          cantidad: Number(cantidad) || 0,
          valor: aNumero(valor),
          notas: "",
        }),
      {
        ok: "Entrega registrada.",
        error: "No se pudo registrar. Revisa tu conexión.",
        alExito: () => {
          setProductoId(null);
          setDescripcion("");
          setTalla("");
          setCantidad("1");
          setValor("");
        },
      },
    );
  }

  function guardarEvaluacionDelMes() {
    ejecutar(
      () =>
        guardarEvaluacion({
          influencer_id: influencer.id,
          periodo: `${periodo}-01`,
          usos_codigo: aNumero(usos),
          ventas_monto: aNumero(ventas),
          videos: aNumero(videos),
          stories: aNumero(stories),
          participaciones: aNumero(participaciones),
          contenido_organico: false,
          observaciones,
        }),
      { ok: "Evaluación guardada.", error: "No se pudo guardar. Revisa tu conexión." },
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{influencer.nombre}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          {credito != null && (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground">
              Crédito del mes: <b className="text-foreground">{formatearMXN(credito)}</b> · entregado
              este mes{" "}
              <b className={entregadoEsteMes > credito ? "text-amber-600" : "text-foreground"}>
                {formatearMXN(entregadoEsteMes)}
              </b>
            </p>
          )}

          {/* --- Material entregado --- */}
          <div>
            <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Material entregado
            </h3>
            <div className="flex flex-col gap-1">
              {entregas.map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-sm"
                >
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {formatearFecha(e.fecha)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    {e.cantidad > 1 && `${e.cantidad}× `}
                    {productos.find((p) => p.id === e.producto_id)?.nombre ?? e.descripcion ?? "—"}
                    {e.talla && ` · ${e.talla}`}
                  </span>
                  {e.valor != null && (
                    <span className="shrink-0 tabular-nums">{formatearMXN(e.valor * e.cantidad)}</span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      ejecutar(() => borrarEntrega(e.id), { ok: "Entrega borrada." })
                    }
                    className="text-muted-foreground hover:text-destructive"
                    aria-label="Borrar entrega"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
              {entregas.length === 0 && (
                <p className="text-[13px] text-muted-foreground">Todavía no se le manda nada.</p>
              )}
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-6">
              <div className="col-span-2 sm:col-span-2">
                <Select
                  value={productoId ?? PRODUCTO_LIBRE}
                  onValueChange={(v) => setProductoId(!v || v === PRODUCTO_LIBRE ? null : v)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(v: string) => {
                        if (v === PRODUCTO_LIBRE) return "Otro (describir)";
                        const p = productos.find((x) => x.id === v);
                        return p ? `${p.nombre}${p.variante ? ` · ${p.variante}` : ""}` : "Producto";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PRODUCTO_LIBRE}>Otro (describir)</SelectItem>
                    {productos.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.nombre}
                        {p.variante ? ` · ${p.variante}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {productoId === null && (
                <Input
                  className="col-span-2"
                  placeholder="Qué se entregó"
                  value={descripcion}
                  onChange={(e) => setDescripcion(e.target.value)}
                />
              )}
              <Input placeholder="Talla" value={talla} onChange={(e) => setTalla(e.target.value)} />
              <Input
                type="number"
                min="1"
                aria-label="Cantidad"
                value={cantidad}
                onChange={(e) => setCantidad(e.target.value)}
              />
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="$ c/u"
                value={valor}
                onChange={(e) => setValor(e.target.value)}
              />
              <div className="col-span-2 sm:col-span-1">
                <DatePicker value={fecha} onChange={setFecha} />
              </div>
              <Button
                variant="outline"
                onClick={agregarEntrega}
                disabled={pending}
                className="col-span-2 sm:col-span-1"
              >
                Registrar
              </Button>
            </div>
          </div>

          {/* --- Evaluación del mes --- */}
          <div className="border-t pt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Evaluación mensual
              </h3>
              <Input
                type="month"
                className="w-[160px]"
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value)}
              />
            </div>

            {evaluacionDelMes && (
              <p className="mb-2 text-[13px] text-muted-foreground">
                Ya hay evaluación de este mes ({evaluacionDelMes.usos_codigo ?? 0} usos del código
                {dinero.ingresos ? `, ${formatearMXN(evaluacionDelMes.ventas_monto ?? 0)}` : ""}).
                Guardar la sobreescribe.
              </p>
            )}

            {/* «Ventas $» solo para quien las ve: el campo llegaría vacío y
                reevaluar el mes dejaría el importe en cero. El servidor conserva
                el anterior de todas formas (ver guardarEvaluacion). */}
            <div
              className={cn(
                "grid grid-cols-2 gap-2",
                dinero.ingresos ? "sm:grid-cols-5" : "sm:grid-cols-4",
              )}
            >
              <div className="flex flex-col gap-1">
                <Label className="text-[12px]">Usos del código</Label>
                <Input type="number" min="0" value={usos} onChange={(e) => setUsos(e.target.value)} />
              </div>
              {dinero.ingresos && (
                <div className="flex flex-col gap-1">
                  <Label className="text-[12px]">Ventas $</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={ventas}
                    onChange={(e) => setVentas(e.target.value)}
                  />
                </div>
              )}
              <div className="flex flex-col gap-1">
                <Label className="text-[12px]">Videos</Label>
                <Input type="number" min="0" value={videos} onChange={(e) => setVideos(e.target.value)} />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[12px]">Stories</Label>
                <Input
                  type="number"
                  min="0"
                  value={stories}
                  onChange={(e) => setStories(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label className="text-[12px]">Participaciones</Label>
                <Input
                  type="number"
                  min="0"
                  value={participaciones}
                  onChange={(e) => setParticipaciones(e.target.value)}
                />
              </div>
            </div>
            <Textarea
              className="mt-2"
              rows={2}
              placeholder="Observaciones del mes…"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={guardarEvaluacionDelMes}
              disabled={pending}
            >
              Guardar evaluación
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
