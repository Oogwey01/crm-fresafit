"use client";

import { useState } from "react";
import { AlarmClock, Clock, Factory, Plus, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/compartido/stat-card";
import { TabsSeccion } from "@/components/compartido/tabs-seccion";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { TableroMaquila } from "@/components/maquila/tablero";
import { PedidoMaquilaDialog } from "@/components/maquila/pedido-dialog";
import { NuevoPedidoMaquilaDialog } from "@/components/maquila/nuevo-pedido-dialog";
import { ProductosMaquila } from "@/components/maquila/productos-maquila";
import { ConfigMaquilaPanel } from "@/components/maquila/config-maquila";
import type { ProductoElegible } from "@/components/compartido/selector-producto";
import {
  ESTADOS_MAQUILA_ACTIVOS,
  obtenerAcabadoMaquila,
  obtenerCanal,
  obtenerModeloMaquila,
} from "@/lib/catalogos";
import { formatearFecha, formatearFechaHora } from "@/lib/fecha";
import { direccionEnUnaLinea } from "@/lib/canales/direccion";
import type {
  ConfigMaquila,
  CostoMaquila,
  FestivoMaquila,
  MaquilaProductoConFicha,
  PedidoMaquila,
} from "@/lib/types";

const ACTIVOS: readonly string[] = ESTADOS_MAQUILA_ACTIVOS;

type Seccion = "tablero" | "espera" | "productos" | "config";

/* La vista del equipo: el mismo tablero que ve Eduardo más lo que a él no le
   toca — la bandeja de pedidos sin pagar, las fichas de producto que encienden
   la ingesta y la configuración del calendario y las tarifas. */
export function PanelMaquila({
  pedidos,
  fichas,
  productos,
  config,
  festivos,
  costos,
  hoy,
  esAdmin,
  esDireccion,
}: {
  pedidos: PedidoMaquila[];
  fichas: MaquilaProductoConFicha[];
  productos: ProductoElegible[];
  config: ConfigMaquila;
  festivos: FestivoMaquila[];
  costos: CostoMaquila[];
  hoy: string;
  esAdmin: boolean;
  esDireccion: boolean;
}) {
  const [seccion, setSeccion] = useState<Seccion>("tablero");
  const [abierto, setAbierto] = useState<PedidoMaquila | null>(null);
  const [nuevo, setNuevo] = useState(false);

  const esperando = pedidos.filter((p) => p.estado === "esperando_pago");
  const activos = pedidos.filter((p) => ACTIVOS.includes(p.estado));
  const atrasados = activos.filter((p) => p.fecha_prometida && p.fecha_prometida < hoy);
  const enCorte = activos.filter((p) => p.ruta === "corte");
  const corteActual = enCorte.reduce<string | null>(
    (min, p) => (p.corte_fecha && (!min || p.corte_fecha < min) ? p.corte_fecha : min),
    null,
  );

  const SECCIONES = [
    ["tablero", "Tablero"],
    ["espera", `Esperando pago${esperando.length ? ` (${esperando.length})` : ""}`],
    ["productos", "Productos de maquila"],
    ["config", "Configuración"],
  ] as const;

  const columnasEspera: Columna<PedidoMaquila>[] = [
    {
      clave: "pedido",
      label: "Pedido",
      esTitulo: true,
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{p.diseno ?? p.sku ?? "Sin diseño"}</div>
          <div className="truncate text-[12.5px] text-muted-foreground">
            {[
              obtenerModeloMaquila(p.modelo)?.nombre,
              obtenerAcabadoMaquila(p.acabado)?.nombre,
              p.talla ? `talla ${p.talla}` : null,
              p.color,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      ),
    },
    {
      clave: "orden",
      label: "Orden",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-mono text-[12.5px]">{p.numero_orden ?? "manual"}</div>
          <div className="text-[11.5px] text-muted-foreground">
            {obtenerCanal(p.canal)?.nombre ?? p.canal}
          </div>
        </div>
      ),
    },
    {
      clave: "cliente",
      label: "Cliente",
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate">{p.envio_nombre ?? "—"}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {direccionEnUnaLinea(p.envio_direccion) || "—"}
          </div>
        </div>
      ),
    },
    {
      clave: "llego",
      label: "Llegó",
      celda: (p) => (
        <span className="text-muted-foreground">{formatearFechaHora(p.created_at)}</span>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Maquila México</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Producción bajo pedido con Eduardo: qué se fabrica, para cuándo se prometió y por
            dónde va. Solo lo pagado llega a su tablero.
          </p>
        </div>
        <Button
          onClick={() => setNuevo(true)}
          className="h-auto w-full gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
        >
          <Plus className="size-4" strokeWidth={2.1} />
          Pedido manual
        </Button>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <StatCard etiqueta="Esperando pago" valor={String(esperando.length)} icono={Clock} nota="no se produce sin pago" />
        <StatCard etiqueta="En manos de Eduardo" valor={String(activos.length)} icono={Factory} />
        <StatCard
          etiqueta="Atrasados"
          valor={String(atrasados.length)}
          icono={AlarmClock}
          valorClassName={atrasados.length > 0 ? "text-red-600" : undefined}
          nota="pasó la fecha prometida"
        />
        <StatCard
          etiqueta="Corte actual"
          valor={String(enCorte.filter((p) => p.corte_fecha === corteActual).length)}
          icono={Scissors}
          nota={corteActual ? `lote del ${formatearFecha(corteActual)}` : "sin lote pendiente"}
        />
      </div>

      <TabsSeccion opciones={SECCIONES} valor={seccion} onCambio={setSeccion} className="mb-4" />

      {seccion === "tablero" && (
        <TableroMaquila pedidos={pedidos} hoy={hoy} esEquipo onAbrir={setAbierto} />
      )}

      {seccion === "espera" && (
        <TablaSimple
          cols="grid-cols-[minmax(220px,1.4fr)_140px_minmax(200px,1fr)_150px]"
          columnas={columnasEspera}
          datos={esperando}
          filaKey={(p) => p.id}
          minW="min-w-[820px]"
          vacio="Nada esperando pago. Cuando una orden llegue sin pagar, cae aquí y NO al tablero de Eduardo."
          onRowClick={setAbierto}
        />
      )}

      {seccion === "productos" && (
        <ProductosMaquila fichas={fichas} productos={productos} esAdmin={esAdmin} />
      )}

      {seccion === "config" && (
        <ConfigMaquilaPanel
          config={config}
          festivos={festivos}
          costos={costos}
          esDireccion={esDireccion}
        />
      )}

      {abierto && (
        <PedidoMaquilaDialog
          pedido={abierto}
          esEquipo
          esAdmin={esAdmin}
          onClose={() => setAbierto(null)}
        />
      )}
      {nuevo && <NuevoPedidoMaquilaDialog onClose={() => setNuevo(false)} />}
    </div>
  );
}
