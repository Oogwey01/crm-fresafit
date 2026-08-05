"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Pastilla } from "@/components/compartido/pastilla";
import { DatePicker } from "@/components/compartido/date-picker";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  borrarPersonalizado,
  guardarPersonalizado,
  subirFotoPersonalizado,
} from "@/app/(app)/personalizados/actions";
import {
  CANALES,
  ESTADOS_PERSONALIZADO,
  MODELOS_PERSONALIZADO,
  TIPOS_PERSONALIZADO,
  obtenerCanal,
  obtenerEstadoPersonalizado,
} from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import type {
  EstadoPersonalizadoId,
  ModeloPersonalizadoId,
  Personalizado,
  TipoPersonalizadoId,
} from "@/lib/types";

const SIN_VALOR = "sin_valor";

/* Alta y edición de un personalizado. Todo es captura manual —así se pidió—,
   incluida la foto del diseño que el cliente aprobó. */
export function PersonalizadoDialog({
  personalizado,
  onClose,
}: {
  personalizado: Personalizado | null;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const fotoRef = useRef<HTMLInputElement>(null);

  const [cliente, setCliente] = useState(personalizado?.cliente ?? "");
  const [tipo, setTipo] = useState<TipoPersonalizadoId | null>(personalizado?.tipo ?? null);
  const [modelo, setModelo] = useState<ModeloPersonalizadoId | null>(personalizado?.modelo ?? null);
  const [talla, setTalla] = useState(personalizado?.talla ?? "");
  const [noVenta, setNoVenta] = useState(personalizado?.no_venta ?? "");
  const [canal, setCanal] = useState<string | null>(personalizado?.canal ?? null);
  const [fechaCompra, setFechaCompra] = useState(personalizado?.fecha_compra ?? hoyISO());
  const [fechaProduccion, setFechaProduccion] = useState(personalizado?.fecha_produccion ?? "");
  const [fechaLimite, setFechaLimite] = useState(personalizado?.fecha_limite ?? "");
  const [url, setUrl] = useState(personalizado?.url ?? "");
  const [estado, setEstado] = useState<EstadoPersonalizadoId>(personalizado?.estado ?? "recibido");
  const [notas, setNotas] = useState(personalizado?.notas ?? "");

  function guardar() {
    ejecutar(
      () =>
        guardarPersonalizado(personalizado?.id ?? null, {
          cliente,
          tipo,
          modelo,
          talla,
          no_venta: noVenta,
          canal: canal as "tienda_nube" | "mercado_libre" | "tiktok_shop" | "otro" | null,
          fecha_compra: fechaCompra || null,
          fecha_produccion: fechaProduccion || null,
          fecha_limite: fechaLimite || null,
          url,
          estado,
          notas,
        }),
      {
        error: "No se pudo guardar. Revisa tu conexión.",
        alExito: async (r) => {
          const id = "datos" in r ? r.datos.id : personalizado?.id;
          const file = fotoRef.current?.files?.[0];
          /* La foto se sube después de tener el id: la ruta del bucket cuelga
             de él, y así una ficha nueva puede traer su diseño de una vez. */
          if (id && file) {
            const fd = new FormData();
            fd.append("file", file);
            const sub = await subirFotoPersonalizado(id, fd);
            if ("error" in sub) {
              toast.error(`Se guardó la ficha, pero la imagen no: ${sub.error}`);
              onClose();
              return;
            }
          }
          toast.success(personalizado ? "Personalizado actualizado." : "Personalizado registrado.");
          onClose();
        },
      },
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{personalizado ? "Editar personalizado" : "Nuevo personalizado"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="pz-cliente">Cliente</Label>
              <Input
                id="pz-cliente"
                autoFocus
                value={cliente}
                onChange={(e) => setCliente(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tipo de cinto</Label>
              <Select
                value={modelo ?? SIN_VALOR}
                onValueChange={(v) =>
                  setModelo(v === SIN_VALOR ? null : (v as ModeloPersonalizadoId))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      MODELOS_PERSONALIZADO.find((m) => m.id === v)?.nombre ?? "Sin definir"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_VALOR}>Sin definir</SelectItem>
                  {MODELOS_PERSONALIZADO.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Técnica</Label>
              <Select
                value={tipo ?? SIN_VALOR}
                onValueChange={(v) => setTipo(v === SIN_VALOR ? null : (v as TipoPersonalizadoId))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      TIPOS_PERSONALIZADO.find((t) => t.id === v)?.nombre ?? "Sin definir"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_VALOR}>Sin definir</SelectItem>
                  {TIPOS_PERSONALIZADO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pz-talla">Talla</Label>
              <Input
                id="pz-talla"
                placeholder="CHM, G, GEG…"
                value={talla}
                onChange={(e) => setTalla(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pz-venta">Nº de venta</Label>
              <Input id="pz-venta" value={noVenta} onChange={(e) => setNoVenta(e.target.value)} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label>Canal</Label>
              <Select
                value={canal ?? SIN_VALOR}
                onValueChange={(v) => setCanal(v === SIN_VALOR ? null : v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === SIN_VALOR ? "Sin definir" : (obtenerCanal(v)?.nombre ?? "Canal")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_VALOR}>Sin definir</SelectItem>
                  {CANALES.filter((c) => c.id !== "punto_fisico").map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pz-compra">Fecha de compra</Label>
              <DatePicker id="pz-compra" value={fechaCompra} onChange={setFechaCompra} limpiable />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pz-prod">Mandado a producción</Label>
              <DatePicker
                id="pz-prod"
                value={fechaProduccion}
                onChange={setFechaProduccion}
                limpiable
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pz-limite">Fecha límite</Label>
              <DatePicker id="pz-limite" value={fechaLimite} onChange={setFechaLimite} limpiable />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Estado</Label>
              <Select
                value={estado}
                onValueChange={(v) => v && setEstado(v as EstadoPersonalizadoId)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => obtenerEstadoPersonalizado(v)?.nombre ?? "Estado"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS_PERSONALIZADO.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pz-url">Link (diseño, conversación, publicación…)</Label>
            <Input
              id="pz-url"
              placeholder="https://…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input ref={fotoRef} type="file" accept="image/*" className="hidden" />
            <Button variant="outline" size="sm" onClick={() => fotoRef.current?.click()}>
              <Upload className="size-3.5" />
              {personalizado?.foto_path ? "Reemplazar diseño" : "Subir diseño aprobado"}
            </Button>
            <span className="text-[12.5px] text-muted-foreground">
              La imagen del diseño que el cliente aprobó (la sube quien diseña).
            </span>
            {personalizado?.foto_path && <Pastilla nombre="Ya tiene imagen" color="#22c55e" />}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pz-notas">Notas</Label>
            <Textarea
              id="pz-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={personalizado ? "Guardar cambios" : "Registrar"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={
            personalizado
              ? () =>
                  ejecutar(() => borrarPersonalizado(personalizado.id, personalizado.foto_path), {
                    confirmar: `¿Borrar el personalizado de ${personalizado.cliente}?`,
                    ok: "Personalizado borrado.",
                    alExito: onClose,
                  })
              : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}
