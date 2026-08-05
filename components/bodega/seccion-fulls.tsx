"use client";

import { useState } from "react";
import { Package, Plus, Trash2 } from "lucide-react";
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
import { Pastilla } from "@/components/compartido/pastilla";
import { DatePicker } from "@/components/compartido/date-picker";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  agregarCajaFull,
  agregarItemFull,
  borrarCajaFull,
  borrarEnvioFull,
  borrarItemFull,
  guardarCajaFull,
  guardarEnvioFull,
  marcarChecklistFull,
} from "@/app/(app)/inventario/bodega/actions";
import {
  DESTINOS_FULL,
  ESTADOS_ENVIO_FULL,
  obtenerEstadoEnvioFull,
} from "@/lib/catalogos";
import { matchProductoPorSku } from "@/lib/importar/tsv";
import { formatearFecha } from "@/lib/fecha";
import type { ProductoLigeroFila } from "@/app/(app)/inventario/bodega/page";
import type {
  DestinoFullId,
  EnvioFullConCajas,
  EstadoEnvioFullId,
} from "@/lib/types";

/* Envíos "full": el stock que se manda al centro de Amazon o Mercado Libre,
   caja por caja, con el checklist de «PASOS PARA UN FULL PERFECTO» de la hoja.
   El ASIN es solo un dato a la vista: el CRM no habla con Amazon. */
export function SeccionFulls({
  envios,
  productos,
}: {
  envios: EnvioFullConCajas[];
  productos: ProductoLigeroFila[];
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [dialogo, setDialogo] = useState(false);
  const [abiertoId, setAbiertoId] = useState<string | null>(envios[0]?.id ?? null);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13.5px] text-muted-foreground">
          {envios.length} {envios.length === 1 ? "envío" : "envíos"} · el stock no se descuenta solo:
          márcalo en el checklist cuando lo hagas.
        </p>
        <div className="flex-1" />
        <Button onClick={() => setDialogo(true)}>
          <Plus className="size-4" /> Nuevo envío
        </Button>
      </div>

      {envios.length === 0 && (
        <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
          <p className="text-[15px] font-semibold">Todavía no hay envíos full.</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Un envío full agrupa las cajas que se mandan al centro de la plataforma, con su SKU,
            ASIN y cantidad.
          </p>
        </div>
      )}

      {envios.map((e) => {
        const estado = obtenerEstadoEnvioFull(e.estado);
        const destino = DESTINOS_FULL.find((d) => d.id === e.destino);
        const abierto = abiertoId === e.id;
        const totalPiezas = e.cajas.reduce(
          (acc, c) => acc + c.items.reduce((a, i) => a + i.cantidad, 0),
          0,
        );

        return (
          <div key={e.id} className="rounded-2xl border bg-card shadow-sm">
            <button
              type="button"
              onClick={() => setAbiertoId(abierto ? null : e.id)}
              className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left"
            >
              <Package className="size-4 text-muted-foreground" strokeWidth={1.9} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{e.nombre}</div>
                <div className="text-[12.5px] text-muted-foreground">
                  {destino?.nombre} · {e.cajas.length} {e.cajas.length === 1 ? "caja" : "cajas"} ·{" "}
                  {totalPiezas} piezas
                  {e.fecha_envio && ` · ${formatearFecha(e.fecha_envio)}`}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                {estado && <Pastilla nombre={estado.nombre} color={estado.color} />}
              </div>
            </button>

            {abierto && (
              <div className="border-t px-5 py-3">
                {e.cajas.map((caja) => (
                  <Caja
                    key={caja.id}
                    caja={caja}
                    productos={productos}
                    pending={pending}
                    ejecutar={ejecutar}
                  />
                ))}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending}
                    onClick={() => ejecutar(() => agregarCajaFull(e.id), { ok: "Caja agregada." })}
                  >
                    + Caja
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={pending}
                    onClick={() =>
                      ejecutar(() => borrarEnvioFull(e.id), {
                        confirmar: `¿Borrar el envío «${e.nombre}» con sus cajas?`,
                        ok: "Envío borrado.",
                      })
                    }
                  >
                    <Trash2 className="size-4" /> Borrar envío
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {dialogo && <DialogoEnvio onClose={() => setDialogo(false)} />}
    </div>
  );
}

/* --- Una caja con sus renglones y el checklist ---------------------------- */
type Ejecutar = ReturnType<typeof useAccionServidor>["ejecutar"];

function Caja({
  caja,
  productos,
  pending,
  ejecutar,
}: {
  caja: EnvioFullConCajas["cajas"][number];
  productos: ProductoLigeroFila[];
  pending: boolean;
  ejecutar: Ejecutar;
}) {
  const [dimensiones, setDimensiones] = useState(caja.dimensiones ?? "");
  const [peso, setPeso] = useState(caja.peso_kg?.toString() ?? "");
  const [sku, setSku] = useState("");
  const [asin, setAsin] = useState("");
  const [cantidad, setCantidad] = useState("1");

  return (
    <div className="mb-3 rounded-lg border bg-muted/20 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-bold">Caja {caja.numero}</span>
        <Input
          placeholder="Dimensiones"
          className="h-8 w-[150px]"
          value={dimensiones}
          onChange={(e) => setDimensiones(e.target.value)}
          onBlur={() =>
            ejecutar(() => guardarCajaFull(caja.id, dimensiones, Number(peso) || null))
          }
        />
        <Input
          type="number"
          min="0"
          step="0.01"
          placeholder="Peso kg"
          className="h-8 w-[110px]"
          value={peso}
          onChange={(e) => setPeso(e.target.value)}
          onBlur={() =>
            ejecutar(() => guardarCajaFull(caja.id, dimensiones, Number(peso) || null))
          }
        />
        <button
          type="button"
          onClick={() =>
            ejecutar(() => borrarCajaFull(caja.id), {
              confirmar: `¿Borrar la caja ${caja.numero} y su contenido?`,
            })
          }
          className="ml-auto text-muted-foreground hover:text-destructive"
          aria-label="Borrar caja"
        >
          <Trash2 className="size-4" />
        </button>
      </div>

      {caja.items.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="py-1.5 font-semibold">SKU</th>
                <th className="py-1.5 font-semibold">ASIN</th>
                <th className="py-1.5 text-right font-semibold">Cant.</th>
                <th className="py-1.5 text-center font-semibold">Empaquetado</th>
                <th className="py-1.5 text-center font-semibold">Cancelado</th>
                <th className="py-1.5 text-center font-semibold">Descontado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {caja.items.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="py-1.5 font-mono text-[12.5px]">{i.sku}</td>
                  <td className="py-1.5 font-mono text-[12px] text-muted-foreground">
                    {i.asin ?? "—"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{i.cantidad}</td>
                  {(["empaquetado", "cancelado", "descontado"] as const).map((campo) => (
                    <td key={campo} className="py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={i[campo]}
                        disabled={pending}
                        onChange={(e) =>
                          ejecutar(() => marcarChecklistFull(i.id, campo, e.target.checked))
                        }
                        className="size-4 accent-primary"
                        aria-label={campo}
                      />
                    </td>
                  ))}
                  <td className="py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => ejecutar(() => borrarItemFull(i.id))}
                      className="text-muted-foreground hover:text-destructive"
                      aria-label="Quitar renglón"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Input
          placeholder="SKU"
          className="h-8 w-[130px] font-mono"
          value={sku}
          onChange={(e) => setSku(e.target.value.toUpperCase())}
        />
        <Input
          placeholder="ASIN"
          className="h-8 w-[130px] font-mono"
          value={asin}
          onChange={(e) => setAsin(e.target.value.toUpperCase())}
        />
        <Input
          type="number"
          min="1"
          className="h-8 w-20"
          aria-label="Cantidad"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
        />
        <Button
          variant="outline"
          size="sm"
          disabled={pending || !sku.trim()}
          onClick={() =>
            ejecutar(
              () =>
                agregarItemFull({
                  caja_id: caja.id,
                  producto_id: matchProductoPorSku(sku, productos).producto?.id ?? null,
                  sku,
                  asin,
                  cantidad: Number(cantidad) || 0,
                }),
              {
                alExito: () => {
                  setSku("");
                  setAsin("");
                  setCantidad("1");
                },
              },
            )
          }
        >
          Agregar
        </Button>
      </div>
    </div>
  );
}

/* --- Alta de envío -------------------------------------------------------- */
function DialogoEnvio({ onClose }: { onClose: () => void }) {
  const { pending, ejecutar } = useAccionServidor();
  const [destino, setDestino] = useState<DestinoFullId>("amazon");
  const [nombre, setNombre] = useState("");
  const [estado, setEstado] = useState<EstadoEnvioFullId>("preparando");
  const [fecha, setFecha] = useState("");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Nuevo envío full</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ef-nombre">Nombre</Label>
            <Input
              id="ef-nombre"
              autoFocus
              placeholder="Full agosto · hebillas"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Destino</Label>
              <Select value={destino} onValueChange={(v) => v && setDestino(v as DestinoFullId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => DESTINOS_FULL.find((d) => d.id === v)?.nombre ?? "Destino"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {DESTINOS_FULL.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Estado</Label>
              <Select value={estado} onValueChange={(v) => v && setEstado(v as EstadoEnvioFullId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => obtenerEstadoEnvioFull(v)?.nombre ?? "Estado"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS_ENVIO_FULL.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ef-fecha">Fecha de envío</Label>
            <DatePicker id="ef-fecha" value={fecha} onChange={setFecha} limpiable />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              ejecutar(
                () =>
                  guardarEnvioFull(null, {
                    destino,
                    nombre,
                    estado,
                    fecha_envio: fecha || null,
                    notas: "",
                  }),
                { ok: "Envío creado.", error: "No se pudo crear. Revisa tu conexión.", alExito: onClose },
              )
            }
          >
            {pending ? "Guardando…" : "Crear envío"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
