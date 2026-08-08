"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { crearPedidoMaquila } from "@/app/(app)/maquila/actions";
import {
  ACABADOS_MAQUILA,
  COLORES_PALANCA,
  COMBOS_MAQUILA,
  MODELOS_MAQUILA,
  obtenerAcabadoMaquila,
  obtenerComboMaquila,
  obtenerModeloMaquila,
} from "@/lib/catalogos";
import { localInputAIso } from "@/lib/fecha";
import type { AcabadoMaquilaId, ColorPalancaId, ComboMaquilaId, ModeloMaquilaId } from "@/lib/types";

const SIN_VALOR = "sin_valor";

/* Captura manual: la venta que llegó por WhatsApp o DM y no pasa por ningún
   canal. Si ya está pagada se marca aquí mismo con su fecha y hora, y el
   action calcula ruta, corte y promesa con las mismas reglas que la ingesta. */
export function NuevoPedidoMaquilaDialog({ onClose }: { onClose: () => void }) {
  const { pending, ejecutar } = useAccionServidor();
  const [diseno, setDiseno] = useState("");
  const [modelo, setModelo] = useState<ModeloMaquilaId>("powerlift");
  const [acabado, setAcabado] = useState<AcabadoMaquilaId>("prensado");
  const [sku, setSku] = useState("");
  const [talla, setTalla] = useState("");
  const [color, setColor] = useState("");
  const [cantidad, setCantidad] = useState("1");
  const [palanca, setPalanca] = useState<ColorPalancaId | null>(null);
  const [combo, setCombo] = useState<ComboMaquilaId>("ninguno");
  const [comboDiseno, setComboDiseno] = useState("");
  const [nombre, setNombre] = useState("");
  const [telefono, setTelefono] = useState("");
  const [direccion, setDireccion] = useState("");
  const [notas, setNotas] = useState("");
  const [pagado, setPagado] = useState(true);
  const [pagadoEn, setPagadoEn] = useState(""); // datetime-local; vacío = ahora

  const llevaPalanca = obtenerModeloMaquila(modelo)?.llevaPalanca ?? false;

  function guardar() {
    const iso = pagado
      ? pagadoEn
        ? localInputAIso(pagadoEn)
        : new Date().toISOString()
      : null;
    ejecutar(
      () =>
        crearPedidoMaquila({
          diseno,
          modelo,
          acabado,
          sku,
          talla,
          color,
          cantidad: Number(cantidad) || 1,
          palanca_color: llevaPalanca ? palanca : null,
          combo,
          combo_diseno: comboDiseno,
          envio_nombre: nombre,
          envio_telefono: telefono,
          envio_direccion: direccion,
          notas,
          pagado_en: iso,
        }),
      {
        ok: pagado
          ? "Pedido creado y mandado a producción."
          : "Pedido creado; queda esperando el pago.",
        alExito: onClose,
      },
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Pedido manual (WhatsApp / DM)</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 grid gap-1.5">
            <Label htmlFor="nm-diseno">Diseño *</Label>
            <Input
              id="nm-diseno"
              value={diseno}
              onChange={(e) => setDiseno(e.target.value)}
              placeholder="Nombre del diseño del cinturón"
              autoFocus
            />
          </div>
          <div className="grid gap-1.5">
            <Label>Modelo</Label>
            <Select value={modelo} onValueChange={(v) => v && setModelo(v as ModeloMaquilaId)}>
              <SelectTrigger>
                <SelectValue>{(v: string) => obtenerModeloMaquila(v)?.nombre ?? v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {MODELOS_MAQUILA.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Acabado</Label>
            <Select value={acabado} onValueChange={(v) => v && setAcabado(v as AcabadoMaquilaId)}>
              <SelectTrigger>
                <SelectValue>{(v: string) => obtenerAcabadoMaquila(v)?.nombre ?? v}</SelectValue>
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
          <div className="grid gap-1.5">
            <Label htmlFor="nm-talla">Talla</Label>
            <Input id="nm-talla" value={talla} onChange={(e) => setTalla(e.target.value)} placeholder="S / M / L / XL" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nm-color">Color</Label>
            <Input id="nm-color" value={color} onChange={(e) => setColor(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nm-sku">SKU</Label>
            <Input id="nm-sku" value={sku} onChange={(e) => setSku(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nm-cantidad">Cantidad</Label>
            <Input
              id="nm-cantidad"
              type="number"
              min={1}
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </div>
          {llevaPalanca && (
            <div className="grid gap-1.5">
              <Label>Color de palanca ⚠️</Label>
              <Select
                value={palanca ?? SIN_VALOR}
                onValueChange={(v) => setPalanca(v === SIN_VALOR ? null : (v as ColorPalancaId))}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(v: string) => COLORES_PALANCA.find((c) => c.id === v)?.nombre ?? "Sin definir"}
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
                <SelectValue>{(v: string) => obtenerComboMaquila(v)?.nombre ?? v}</SelectValue>
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
            <div className="col-span-2 grid gap-1.5">
              <Label htmlFor="nm-combo-diseno">Diseño del accesorio</Label>
              <Input
                id="nm-combo-diseno"
                value={comboDiseno}
                onChange={(e) => setComboDiseno(e.target.value)}
                placeholder="Debe coordinar con el cinturón"
              />
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="nm-nombre">Cliente (envío)</Label>
            <Input id="nm-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="nm-telefono">Teléfono</Label>
            <Input id="nm-telefono" value={telefono} onChange={(e) => setTelefono(e.target.value)} />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label htmlFor="nm-direccion">Dirección de envío</Label>
            <Textarea
              id="nm-direccion"
              value={direccion}
              onChange={(e) => setDireccion(e.target.value)}
              rows={2}
              placeholder="Calle, número, colonia, CP, ciudad, estado"
            />
          </div>
          <div className="col-span-2 grid gap-1.5">
            <Label htmlFor="nm-notas">Notas</Label>
            <Textarea id="nm-notas" value={notas} onChange={(e) => setNotas(e.target.value)} rows={2} />
          </div>

          {/* La regla de oro: sin pago aprobado no se produce. El pedido se
              puede capturar antes, pero queda en la bandeja de espera. */}
          <div className="col-span-2 flex flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-3">
            <label className="flex items-center gap-2 text-[13.5px] font-medium">
              <input
                type="checkbox"
                checked={pagado}
                onChange={(e) => setPagado(e.target.checked)}
                className="size-4 accent-primary"
              />
              El pago ya está aprobado
            </label>
            {pagado && (
              <div className="flex items-center gap-2">
                <Label htmlFor="nm-pagado-en" className="text-[12.5px] text-muted-foreground">
                  Cuándo (vacío = ahora)
                </Label>
                <Input
                  id="nm-pagado-en"
                  type="datetime-local"
                  value={pagadoEn}
                  onChange={(e) => setPagadoEn(e.target.value)}
                  className="h-8 w-[190px]"
                />
              </div>
            )}
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar="Crear pedido"
          onCancelar={onClose}
          onGuardar={guardar}
        />
      </DialogContent>
    </Dialog>
  );
}
