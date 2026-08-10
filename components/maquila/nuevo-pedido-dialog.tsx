"use client";

import { useState } from "react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import { PastillaEntrada, PastillaOpcion } from "@/components/compartido/pastillas-campo";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { crearPedidoMaquila } from "@/app/(app)/maquila/actions";
import {
  ACABADOS_MAQUILA,
  COLORES_PALANCA,
  COMBOS_MAQUILA,
  MODELOS_MAQUILA,
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
    <DialogoFormulario
      titulo="Pedido manual (WhatsApp / DM)"
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar="Crear pedido"
      pending={pending}
    >
      <Hero
        pasoTitulo="¿Qué cinturón es?"
        valido={Boolean(diseno.trim())}
        motivoInvalido="Ponle nombre al diseño."
      >
        <CampoHero
          id="nm-diseno"
          etiqueta="Diseño"
          placeholder="Nombre del diseño del cinturón"
          valor={diseno}
          onCambio={setDiseno}
        />
        <DescripcionHero
          id="nm-notas"
          etiqueta="Notas"
          placeholder="Notas… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades pasoTitulo="El producto">
        <PastillaOpcion
          etiqueta="Modelo"
          opciones={MODELOS_MAQUILA}
          valor={modelo}
          onCambio={setModelo}
        />
        <PastillaOpcion
          etiqueta="Acabado"
          opciones={ACABADOS_MAQUILA}
          valor={acabado}
          onCambio={setAcabado}
        />
        <PastillaEntrada
          etiqueta="Talla"
          valor={talla}
          onCambio={setTalla}
          placeholder="S / M / L / XL"
          opcional
          idMovil="nm-talla"
        />
        <PastillaEntrada
          etiqueta="Color"
          valor={color}
          onCambio={setColor}
          opcional
          idMovil="nm-color"
        />
        <PastillaEntrada
          etiqueta="SKU"
          valor={sku}
          onCambio={setSku}
          opcional
          idMovil="nm-sku"
        />
        <PastillaEntrada
          etiqueta="Cantidad"
          tipo="number"
          valor={cantidad}
          onCambio={setCantidad}
          sufijo="pzas"
          idMovil="nm-cantidad"
        />
        {/* El ⚠️ viaja en la etiqueta a propósito: palanca_color llega null de
            TN y capturarlo es responsabilidad del interno. */}
        {llevaPalanca && (
          <PastillaOpcion
            etiqueta="Color de palanca ⚠️"
            opciones={[
              { id: SIN_VALOR, nombre: "Sin definir" },
              ...COLORES_PALANCA,
            ]}
            valor={palanca ?? SIN_VALOR}
            onCambio={(v) => setPalanca(v === SIN_VALOR ? null : (v as ColorPalancaId))}
          />
        )}
        <PastillaOpcion
          etiqueta="Combo"
          opciones={COMBOS_MAQUILA}
          valor={combo}
          onCambio={setCombo}
        />
        {combo !== "ninguno" && (
          <Campo etiqueta="Diseño del accesorio" htmlFor="nm-combo-diseno" className="w-full">
            <Input
              id="nm-combo-diseno"
              value={comboDiseno}
              onChange={(e) => setComboDiseno(e.target.value)}
              placeholder="Debe coordinar con el cinturón"
            />
          </Campo>
        )}
      </Propiedades>

      <Propiedades pasoTitulo="El envío">
        <PastillaEntrada
          etiqueta="Cliente (envío)"
          valor={nombre}
          onCambio={setNombre}
          opcional
          idMovil="nm-nombre"
        />
        <PastillaEntrada
          etiqueta="Teléfono"
          valor={telefono}
          onCambio={setTelefono}
          opcional
          idMovil="nm-telefono"
        />
        <Campo etiqueta="Dirección de envío" htmlFor="nm-direccion" className="w-full">
          <Textarea
            id="nm-direccion"
            value={direccion}
            onChange={(e) => setDireccion(e.target.value)}
            rows={2}
            placeholder="Calle, número, colonia, CP, ciudad, estado"
          />
        </Campo>
      </Propiedades>

      <Propiedades pasoTitulo="El pago" pasoAyuda="Sin pago aprobado no se produce.">
        {/* La regla de oro: sin pago aprobado no se produce. El pedido se
            puede capturar antes, pero queda en la bandeja de espera. */}
        <div className="flex w-full flex-wrap items-center gap-3 rounded-xl border bg-muted/30 p-3">
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
      </Propiedades>
    </DialogoFormulario>
  );
}
