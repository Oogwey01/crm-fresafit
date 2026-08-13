"use client";

import { useState } from "react";
import { AlarmClock, Clock, Factory, Plus, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/compartido/stat-card";
import { EncabezadoSeccion } from "@/components/compartido/encabezado-seccion";
import { TabsSeccion } from "@/components/compartido/tabs-seccion";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { TableroMaquila, type Vista as VistaTablero } from "@/components/maquila/tablero";
import { PedidoMaquilaDialog } from "@/components/maquila/pedido-dialog";
import { NuevoPedidoMaquilaDialog } from "@/components/maquila/nuevo-pedido-dialog";
import { ProductosMaquila } from "@/components/maquila/productos-maquila";
import { GuiasMaquila } from "@/components/maquila/guias";
import { InsumosMaquila } from "@/components/maquila/insumos";
import { CorteMaquilaPanel } from "@/components/maquila/corte";
import { EstadisticasMaquila } from "@/components/maquila/estadisticas";
import { BibliotecaDisenos } from "@/components/maquila/biblioteca-disenos";
import { ConfigMaquilaPanel } from "@/components/maquila/config-maquila";
import type { ProductoElegible } from "@/components/compartido/selector-producto";
import { ESTADOS_MAQUILA_ACTIVOS } from "@/lib/catalogos";
import { grupoDePedido, particionarPedidos } from "@/lib/maquila/reglas";
import { insumosDePedido } from "@/lib/maquila/consignacion";
import { formatearFecha } from "@/lib/fecha";
import type {
  AnticipoMaquila,
  ConfigMaquila,
  CorteMaquilaConDetalle,
  CostoMaquila,
  DisenoMaquila,
  FestivoMaquila,
  GuiaMaquila,
  GuiaMaquilaConPedidos,
  InsumoMaquilaConSaldo,
  MaquilaProductoConFicha,
  MovConsignacionMaquila,
  PedidoMaquila,
} from "@/lib/types";

const ACTIVOS: readonly string[] = ESTADOS_MAQUILA_ACTIVOS;

/* Cinco pestañas y no nueve: lo operativo con pendientes (tablero, guías,
   insumos) queda a la vista, y lo que se consulta de vez en cuando se agrupa
   por pregunta — «Cuentas» = cuánto se le paga a Eduardo y cómo vamos de
   volumen; «Ajustes» = el catálogo y el volante del módulo. «Esperando pago»
   vive como primera vista del tablero, no como pestaña. */
type Seccion = "tablero" | "guias" | "insumos" | "cuentas" | "ajustes";
type VistaCuentas = "corte" | "estadisticas";
type VistaAjustes = "disenos" | "productos" | "config";

/* La vista del equipo: el mismo tablero que ve Eduardo más lo que a él no le
   toca — la bandeja de pedidos sin pagar, las fichas de producto que encienden
   la ingesta y la configuración del calendario y las tarifas. */
export function PanelMaquila({
  pedidos,
  guias,
  insumos,
  movimientos,
  disenosPorPedido,
  disenos,
  fichas,
  productos,
  config,
  festivos,
  costos,
  costosPorPedido,
  cortes,
  anticipos,
  hoy,
  esAdmin,
  esDireccion,
  veDinero,
}: {
  pedidos: PedidoMaquila[];
  guias: GuiaMaquila[];
  insumos: InsumoMaquilaConSaldo[];
  movimientos: MovConsignacionMaquila[];
  /* pedido_id → ruta del arte; la biblioteca de colecciones es otra cosa. */
  disenosPorPedido: Record<string, string>;
  disenos: DisenoMaquila[];
  fichas: MaquilaProductoConFicha[];
  productos: ProductoElegible[];
  config: ConfigMaquila;
  festivos: FestivoMaquila[];
  /* Vacío cuando quien mira no ve egresos: la RLS ya no se los da y la página
     ni siquiera hace el viaje. */
  costos: CostoMaquila[];
  costosPorPedido: Record<string, number>;
  cortes: CorteMaquilaConDetalle[];
  anticipos: AnticipoMaquila[];
  hoy: string;
  esAdmin: boolean;
  esDireccion: boolean;
  veDinero: boolean;
}) {
  const [seccion, setSeccion] = useState<Seccion>("tablero");
  /* La vista del tablero y su filtro de atrasados viven aquí (y no dentro del
     tablero) para que los StatCards de arriba naveguen hasta ellas. Efecto
     colateral querido: salir del tablero y volver ya no resetea a «Hoy». */
  const [vistaTablero, setVistaTablero] = useState<VistaTablero>("hoy");
  const [soloAtrasados, setSoloAtrasados] = useState(false);
  const [vistaCuentas, setVistaCuentas] = useState<VistaCuentas>(
    veDinero ? "corte" : "estadisticas",
  );
  const [vistaAjustes, setVistaAjustes] = useState<VistaAjustes>("disenos");
  const [abierto, setAbierto] = useState<PedidoMaquila | null>(null);
  const [nuevo, setNuevo] = useState(false);

  /* Los mismos cortes que pintan el tablero y la vista del maquilero: una sola
     partición compartida (lib/maquila/reglas.ts) para que las cuentas cuadren
     entre pantallas. */
  const parte = particionarPedidos(pedidos, ACTIVOS, hoy);

  /* Cada solicitud de guía se pinta con los renglones que la esperan: el cruce
     es por (canal, grupo), la misma clave que usa el trigger. */
  const guiasConPedidos: GuiaMaquilaConPedidos[] = guias.map((g) => ({
    ...g,
    pedidos: pedidos.filter((p) => p.canal === g.canal && grupoDePedido(p) === g.grupo),
  }));
  const sinSurtir = guiasConPedidos.filter((g) => g.estado === "solicitada");

  const insumosBajos = insumos.filter((i) => i.activo && i.saldo <= i.minimo).length;

  /* Solo llevan contador los pendientes accionables (guías por surtir, insumos
     bajos). Esperando pago no es un pendiente del equipo —se resuelve solo
     cuando el pago entra— y su número ya vive en el StatCard de arriba. */
  const SECCIONES: readonly (readonly [Seccion, string])[] = [
    ["tablero", "Tablero"],
    ["guias", `Guías${sinSurtir.length ? ` (${sinSurtir.length})` : ""}`],
    ["insumos", `Insumos${insumosBajos ? ` (${insumosBajos})` : ""}`],
    ["cuentas", "Cuentas"],
    ["ajustes", "Ajustes"],
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

      {/* Las dos tarjetas con destino claro también navegan: son el atajo que
          reemplaza a las pestañas viejas de Esperando pago y Atrasados. */}
      <div className="mb-4 grid grid-cols-2 gap-3.5 md:grid-cols-4">
        <button
          type="button"
          className="block text-left"
          aria-label="Ver los pedidos esperando pago en el tablero"
          onClick={() => {
            setSeccion("tablero");
            setVistaTablero("espera");
          }}
        >
          <StatCard
            etiqueta="Esperando pago"
            valor={String(parte.esperandoPago.length)}
            icono={Clock}
            nota="no se produce sin pago"
            className="h-full transition-colors hover:border-primary/40"
          />
        </button>
        <StatCard
          etiqueta="En manos de Eduardo"
          valor={String(parte.listos.length)}
          icono={Factory}
          nota={
            parte.esperandoArte.length > 0
              ? `${parte.esperandoArte.length} más esperan diseño`
              : "todo con su arte"
          }
        />
        <button
          type="button"
          className="block text-left"
          aria-label="Ver solo los atrasados en el tablero"
          onClick={() => {
            setSeccion("tablero");
            setVistaTablero("hoy");
            setSoloAtrasados(true);
          }}
        >
          <StatCard
            etiqueta="Atrasados"
            valor={String(parte.atrasados.length)}
            icono={AlarmClock}
            valorClassName={parte.atrasados.length > 0 ? "text-red-600" : undefined}
            nota="pasó la fecha prometida"
            className="h-full transition-colors hover:border-primary/40"
          />
        </button>
        <StatCard
          etiqueta="Corte actual"
          valor={String(parte.loteActual.length)}
          icono={Scissors}
          nota={
            parte.corteActual ? `lote del ${formatearFecha(parte.corteActual)}` : "sin lote pendiente"
          }
        />
      </div>

      <TabsSeccion opciones={SECCIONES} valor={seccion} onCambio={setSeccion} className="mb-4" />

      {seccion === "tablero" && (
        <>
          <EncabezadoSeccion titulo="La producción viva">
            Lo que está en manos de Eduardo: qué se fabrica, para cuándo se prometió y en qué paso
            va. Las vistas de arriba lo parten por urgencia — la primera,{" "}
            <b className="font-semibold text-foreground">Esperando pago</b>, es lo que llegó sin
            pagar y todavía no baja a su tablero. El semáforo mide contra la fecha prometida —{" "}
            <b className="font-semibold text-foreground">+ 7 días hábiles</b> si es prensado,{" "}
            <b className="font-semibold text-foreground">+ 10</b> si va por el corte de lunes y
            jueves. El plazo corre desde el pago, salvo en lo que lleva arte: ahí arranca cuando
            diseño lo entrega, y hasta entonces el pedido vive en{" "}
            <b className="font-semibold text-foreground">Esperando diseño</b> y no le cuenta a él.
            Eduardo ve este mismo tablero y mueve los estados desde su lado.
          </EncabezadoSeccion>
          <TableroMaquila
            pedidos={pedidos}
            guias={guias}
            disenosPorPedido={disenosPorPedido}
            hoy={hoy}
            esEquipo
            onAbrir={setAbierto}
            vista={vistaTablero}
            onVista={setVistaTablero}
            soloAtrasados={soloAtrasados}
            onSoloAtrasados={setSoloAtrasados}
          />
        </>
      )}

      {seccion === "guias" && (
        <>
          <EncabezadoSeccion titulo="Etiquetas por surtir">
            Una solicitud por <b className="font-semibold text-foreground">paquete</b>, no por
            pieza: si una orden lleva tres cinturones, sale una sola etiqueta. Se abre sola en
            cuanto Eduardo termina el primer renglón; logística sube aquí el archivo de la guía y
            la solicitud se cierra cuando el paquete sale con su número.
          </EncabezadoSeccion>
          <GuiasMaquila guias={guiasConPedidos} puedeSurtir />
        </>
      )}

      {seccion === "insumos" && (
        <InsumosMaquila
          insumos={insumos}
          movimientos={movimientos}
          puedeMover
          puedeAjustar={esAdmin}
        />
      )}

      {seccion === "cuentas" && (
        <>
          {/* Sin permiso de dinero solo existe Estadísticas: con una sola
              opción la barra no se pinta (mismo criterio que Finanzas). */}
          {veDinero && (
            <ControlSegmentado
              opciones={
                [
                  ["corte", "Corte quincenal"],
                  ["estadisticas", "Estadísticas"],
                ] as const
              }
              valor={vistaCuentas}
              onCambio={setVistaCuentas}
              className="mb-4"
            />
          )}
          {vistaCuentas === "corte" && veDinero && (
            <>
              <EncabezadoSeccion titulo="Lo que se le paga a Eduardo">
                Cada quincena junta las piezas que salieron en el periodo, a la tarifa que se
                congeló cuando se pagó el pedido, suma el IVA aparte y resta los anticipos que ya
                se le dieron (los más viejos primero). Un corte{" "}
                <b className="font-semibold text-foreground">cerrado ya no se recalcula</b> y sus
                piezas no vuelven a entrar a otro; cancelarlo es cosa de dirección.
              </EncabezadoSeccion>
              <CorteMaquilaPanel
                cortes={cortes}
                anticipos={anticipos}
                hoy={hoy}
                esDireccion={esDireccion}
              />
            </>
          )}
          {(vistaCuentas === "estadisticas" || !veDinero) && (
            <EstadisticasMaquila
              pedidos={pedidos}
              costosPorPedido={costosPorPedido}
              hoy={hoy}
              veDinero={veDinero}
            />
          )}
        </>
      )}

      {seccion === "ajustes" && (
        <>
          <ControlSegmentado
            opciones={
              [
                ["disenos", "Diseños"],
                ["productos", "Productos de maquila"],
                ["config", "Configuración"],
              ] as const
            }
            valor={vistaAjustes}
            onCambio={setVistaAjustes}
            className="mb-4"
          />
          {vistaAjustes === "disenos" && <BibliotecaDisenos disenos={disenos} />}
          {vistaAjustes === "productos" && (
            <ProductosMaquila fichas={fichas} productos={productos} esAdmin={esAdmin} />
          )}
          {vistaAjustes === "config" && (
            <ConfigMaquilaPanel
              config={config}
              festivos={festivos}
              costos={costos}
              esDireccion={esDireccion}
              veTarifas={veDinero}
            />
          )}
        </>
      )}

      {abierto && (
        <PedidoMaquilaDialog
          pedido={abierto}
          esEquipo
          esAdmin={esAdmin}
          veDinero={veDinero}
          costo={costosPorPedido[abierto.id] ?? null}
          insumos={insumosDePedido(abierto)}
          disenos={disenos}
          onClose={() => setAbierto(null)}
        />
      )}
      {nuevo && (
        <NuevoPedidoMaquilaDialog productos={productos} onClose={() => setNuevo(false)} />
      )}
    </div>
  );
}
