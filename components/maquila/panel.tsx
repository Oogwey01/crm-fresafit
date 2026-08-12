"use client";

import { useState } from "react";
import { AlarmClock, Clock, Factory, Plus, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatCard } from "@/components/compartido/stat-card";
import { EncabezadoSeccion } from "@/components/compartido/encabezado-seccion";
import { TabsSeccion } from "@/components/compartido/tabs-seccion";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { TableroMaquila } from "@/components/maquila/tablero";
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
import {
  ESTADOS_MAQUILA_ACTIVOS,
  obtenerAcabadoMaquila,
  obtenerCanal,
  obtenerModeloMaquila,
} from "@/lib/catalogos";
import { grupoDePedido } from "@/lib/maquila/reglas";
import { insumosDePedido } from "@/lib/maquila/consignacion";
import { formatearFecha, formatearFechaHora } from "@/lib/fecha";
import { direccionEnUnaLinea } from "@/lib/canales/direccion";
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

type Seccion =
  | "tablero"
  | "espera"
  | "guias"
  | "insumos"
  | "corte"
  | "estadisticas"
  | "disenos"
  | "productos"
  | "config";

/* La vista del equipo: el mismo tablero que ve Eduardo más lo que a él no le
   toca — la bandeja de pedidos sin pagar, las fichas de producto que encienden
   la ingesta y la configuración del calendario y las tarifas. */
export function PanelMaquila({
  pedidos,
  guias,
  insumos,
  movimientos,
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

  /* Cada solicitud de guía se pinta con los renglones que la esperan: el cruce
     es por (canal, grupo), la misma clave que usa el trigger. */
  const guiasConPedidos: GuiaMaquilaConPedidos[] = guias.map((g) => ({
    ...g,
    pedidos: pedidos.filter((p) => p.canal === g.canal && grupoDePedido(p) === g.grupo),
  }));
  const sinSurtir = guiasConPedidos.filter((g) => g.estado === "solicitada");

  const insumosBajos = insumos.filter((i) => i.activo && i.saldo <= i.minimo).length;

  /* El corte quincenal solo existe para quien ve el dinero: sin permiso, ni se
     pinta el botón —mismo criterio que el menú, no se ofrece lo que rebota—. */
  const SECCIONES: readonly (readonly [Seccion, string])[] = [
    ["tablero", "Tablero"],
    ["espera", `Esperando pago${esperando.length ? ` (${esperando.length})` : ""}`],
    ["guias", `Guías${sinSurtir.length ? ` (${sinSurtir.length})` : ""}`],
    ["insumos", `Insumos${insumosBajos ? ` (${insumosBajos})` : ""}`],
    ...(veDinero ? ([["corte", "Corte quincenal"]] as const) : []),
    ["estadisticas", "Estadísticas"],
    ["disenos", "Diseños"],
    ["productos", "Productos de maquila"],
    ["config", "Configuración"],
  ];

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
        <>
          <EncabezadoSeccion titulo="La producción viva">
            Lo que está en manos de Eduardo: qué se fabrica, para cuándo se prometió y en qué paso
            va. Las vistas de arriba lo parten por urgencia, y el semáforo mide contra la fecha
            prometida — <b className="font-semibold text-foreground">pago + 7 días hábiles</b> si
            es prensado, <b className="font-semibold text-foreground">+ 10</b> si va por el corte
            de lunes y jueves. Él ve este mismo tablero y mueve los estados desde su lado.
          </EncabezadoSeccion>
          <TableroMaquila pedidos={pedidos} guias={guias} hoy={hoy} esEquipo onAbrir={setAbierto} />
        </>
      )}

      {seccion === "espera" && (
        <>
          <EncabezadoSeccion titulo="Órdenes sin pagar">
            Ya llegó la orden pero el pago no se ha aprobado, así que{" "}
            <b className="font-semibold text-foreground">no se produce ni se le muestra a
            Eduardo</b>. Cuando el pago entra, se calcula la fecha prometida y el pedido salta
            solo al tablero. Si la orden se cancela antes, se marca y se queda como constancia.
          </EncabezadoSeccion>
          <TablaSimple
            cols="grid-cols-[minmax(220px,1.4fr)_140px_minmax(200px,1fr)_150px]"
            columnas={columnasEspera}
            datos={esperando}
            filaKey={(p) => p.id}
            minW="min-w-[820px]"
            vacio="Nada esperando pago. Cuando una orden llegue sin pagar, cae aquí y NO al tablero de Eduardo."
            onRowClick={setAbierto}
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

      {seccion === "corte" && veDinero && (
        <>
          <EncabezadoSeccion titulo="Lo que se le paga a Eduardo">
            Cada quincena junta las piezas que salieron en el periodo, a la tarifa que se congeló
            cuando se pagó el pedido, suma el IVA aparte y resta los anticipos que ya se le
            dieron (los más viejos primero). Un corte{" "}
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

      {seccion === "estadisticas" && (
        <EstadisticasMaquila
          pedidos={pedidos}
          costosPorPedido={costosPorPedido}
          hoy={hoy}
          veDinero={veDinero}
        />
      )}

      {seccion === "disenos" && <BibliotecaDisenos disenos={disenos} />}

      {seccion === "productos" && (
        <ProductosMaquila fichas={fichas} productos={productos} esAdmin={esAdmin} />
      )}

      {seccion === "config" && (
        <ConfigMaquilaPanel
          config={config}
          festivos={festivos}
          costos={costos}
          esDireccion={esDireccion}
          veTarifas={veDinero}
        />
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
