"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Boxes,
  DollarSign,
  Lock,
  PackageX,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { esGestor } from "@/lib/catalogos";
import { ESTADOS_STOCK, estadoStock, obtenerEstadoStock } from "@/lib/inventario/stock";
import {
  calcularReabastecimiento,
  esDepositoFull,
  tieneFull,
  esTikTokDelegado,
  type EnCamino,
  type GrupoReorden,
  type ParamsReorden,
  type VentaReorden,
} from "@/lib/inventario/reabastecimiento";
import { formatearMXN } from "@/lib/moneda";
import { formatearFechaHora } from "@/lib/fecha";
import { LIMITE_MOVIMIENTOS } from "@/lib/inventario/origenes";
import { movimientosStock } from "@/app/(app)/inventario/actions";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import type { VistaDinero } from "@/lib/permisos-dinero";
import type {
  ProductConProveedor,
  Supplier,
  StockLog,
  RolId,
  ConteoConProducto,
  Profile,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/compartido/stat-card";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { TabsSeccion } from "@/components/compartido/tabs-seccion";
import { TIPOS_PRODUCTO, obtenerTipoProducto } from "@/lib/catalogos";
import { TablaProductos } from "@/components/inventario/tabla-productos";
import { TablaProductosAgrupada } from "@/components/inventario/tabla-productos-agrupada";
import { ProductoDialog } from "@/components/inventario/producto-dialog";
import { TablaMovimientos } from "@/components/inventario/tabla-movimientos";
import { BarraCanales } from "@/components/inventario/barra-canales";
import { AvisosInventario } from "@/components/inventario/avisos-inventario";
import { PanelReconciliacion } from "@/components/inventario/panel-reconciliacion";
import type { EstadoPiloto } from "@/lib/inventario/piloto";
import { TablaReabastecer } from "@/components/inventario/tabla-reabastecer";
import type { ResumenReconciliacion } from "@/lib/inventario/reconciliacion";

type Pestana =
  | "productos"
  | "reabastecer"
  | "movimientos"
  | "reconciliacion";

const PESTANAS = [
  ["productos", "Productos"],
  ["reabastecer", "Qué pedir"],
  ["movimientos", "Historial de stock"],
  ["reconciliacion", "Reconciliación"],
] as const;

/* Ventana de ventas del reorden que se muestra al entrar (la tabla «Qué pedir»
   la deja cambiar; la tarjeta KPI y la ficha del producto usan ésta). */
const VENTANA_REORDEN = 30;

/* Solo las pestañas que permiten dar de alta algo (movimientos es de lectura). */
const ETIQUETA_NUEVO: Partial<Record<Pestana, string>> = {
  productos: "Nuevo producto",
};

/* Filtro de dónde está guardado el stock: Mercado Full y el inventario delegado
   a TikTok son almacenes distintos al de la bodega. */
const LOGISTICAS = [
  ["todos", "Todos los almacenes"],
  ["bodega", "Solo bodega"],
  ["full", "Solo Mercado Full"],
  ["tiktok", "Solo TikTok (delegado)"],
] as const;

/* Filtro de ciclo de vida: por defecto se ocultan los descontinuados para no
   ensuciar el catálogo vigente (siguen consultables eligiendo su opción). */
const VIGENCIAS = [
  ["vigentes", "Vigentes"],
  ["descontinuados", "Descontinuados"],
  ["todos", "Todos"],
] as const;

/* Cómo se lista el catálogo. Un cinturón tiene hasta cuatro tallas, y cada una
   es una fila de `products`: verlas siempre desglosadas hace ruido cuando lo que
   quieres es el producto, y agrupadas estorba cuando buscas una talla concreta.
   Por eso conviven las dos vistas. */
const VISTAS_CATALOGO = [
  ["desglosado", "Desglosado"],
  ["agrupado", "Agrupado"],
] as const;

type VistaCatalogo = (typeof VISTAS_CATALOGO)[number][0];

/* Las dos caras del historial. «Movimientos» son las piezas que cambiaron de
   verdad —ventas, cancelaciones, mercancía recibida, ajustes—; «Puestas al día»
   son el CRM copiando el número que ya tenía el canal, que es el 93% del ledger
   y sepultaba a lo demás. La clasificación vive en lib/inventario/origenes.ts. */
const VISTAS_MOV = [
  ["reales", "Movimientos"],
  ["puestas_al_dia", "Puestas al día"],
] as const;

type VistaMov = (typeof VISTAS_MOV)[number][0];

/* Lo que la página ya trae cargado: sin pedirlo otra vez al abrir. */
const VISTA_MOV_INICIAL: VistaMov = "reales";
const CANAL_MOV_INICIAL = "todos";

/* Filtro de canal para el historial de movimientos. */
const CANALES_MOV = [
  ["todos", "Todos los canales"],
  ["crm", "CRM (local)"],
  ["tienda_nube", "Tienda Nube"],
  ["mercado_libre", "Mercado Libre"],
  ["tiktok_shop", "TikTok Shop"],
] as const;

/* Aviso que la page arma en el servidor a partir de los query params del
   redirect de OAuth (?tiendanube=… / ?mercadolibre=… / ?tiktok=…). */
export type AvisoConexion = { tipo: "ok" | "error" | "info"; mensaje: string };

/* Valor compacto para la tarjeta KPI: "$684K" en vez de "$684,231.00". */
function valorCompacto(n: number): string {
  if (n >= 1000) return `$${Math.round(n / 1000)}K`;
  return formatearMXN(n);
}


/* Búsqueda + los 4 filtros del catálogo, con la lista filtrada y el resumen de
   filtros activos que la tabla usa para explicar por qué salió vacía. */
function useFiltrosProductos(productos: ProductConProveedor[]) {
  /* Búsqueda y filtro de tipo — aplican a "Productos" y a "Qué pedir". */
  const [busqueda, setBusqueda] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("todos");
  /* Filtro de semáforo de stock (solo aplica a la pestaña de productos). */
  const [filtroStock, setFiltroStock] = useState("todos");
  /* Filtro de almacén: bodega / Mercado Full / TikTok delegado. */
  const [filtroLogistica, setFiltroLogistica] = useState("todos");
  /* Filtro de ciclo de vida: por defecto solo los vigentes. */
  const [filtroVigencia, setFiltroVigencia] = useState("vigentes");

  const productosVisibles = productos.filter((p) => {
    /* «Bodega» deja fuera lo que no está en ella: el depósito que gobierna
       Mercado Full y el inventario delegado a TikTok. Un producto que está en
       los dos sitios (bodega + Full) sale en ambos filtros, que es lo correcto:
       tiene existencias en ambos almacenes. */
    if (filtroLogistica === "bodega" && (esDepositoFull(p) || esTikTokDelegado(p))) return false;
    if (filtroLogistica === "full" && !tieneFull(p)) return false;
    if (filtroLogistica === "tiktok" && !esTikTokDelegado(p)) return false;
    if (filtroVigencia === "vigentes" && p.descontinuado) return false;
    if (filtroVigencia === "descontinuados" && !p.descontinuado) return false;
    return true;
  });

  /* Los filtros se acumulan, así que una combinación inocente («Solo Mercado
     Full» + «Descontinuados») puede no dejar pasar nada. Para que la tabla pueda
     decir POR QUÉ salió vacía, se le pasan los que están puestos con su nombre
     legible. «Vigentes» cuenta como filtro activo aunque sea el default: es el
     que esconde los descontinuados, y no saberlo es justo la trampa. */
  const filtrosActivos = [
    busqueda.trim() && `Búsqueda: «${busqueda.trim()}»`,
    filtroTipo !== "todos" && `Tipo: ${obtenerTipoProducto(filtroTipo)?.nombre ?? filtroTipo}`,
    filtroStock !== "todos" && `Stock: ${obtenerEstadoStock(filtroStock)?.nombre ?? filtroStock}`,
    filtroLogistica !== "todos" &&
      `Almacén: ${LOGISTICAS.find(([id]) => id === filtroLogistica)?.[1] ?? filtroLogistica}`,
    filtroVigencia !== "todos" &&
      `Vigencia: ${VIGENCIAS.find(([id]) => id === filtroVigencia)?.[1] ?? filtroVigencia}`,
  ].filter(Boolean) as string[];

  /* Deja ver TODO el catálogo: incluye la vigencia, que si no seguiría
     escondiendo los descontinuados después de «limpiar». */
  function limpiarFiltros() {
    setBusqueda("");
    setFiltroTipo("todos");
    setFiltroStock("todos");
    setFiltroLogistica("todos");
    setFiltroVigencia("todos");
  }

  return {
    busqueda,
    setBusqueda,
    filtroTipo,
    setFiltroTipo,
    filtroStock,
    setFiltroStock,
    filtroLogistica,
    setFiltroLogistica,
    filtroVigencia,
    setFiltroVigencia,
    productosVisibles,
    filtrosActivos,
    limpiarFiltros,
  };
}

export function PanelInventario({
  productos,
  proveedores,
  movimientos,
  ventas,
  enCamino,
  paramsReorden,
  rol,
  dinero,
  tiendanube,
  mercadolibre,
  tiktok,
  escrituraCanales,
  piloto,
  conteos,
  equipo,
  reconciliacionInicial,
  avisosConexion,
}: {
  productos: ProductConProveedor[];
  proveedores: Supplier[];
  movimientos: StockLog[];
  /* Ventas de los últimos 90 días: la velocidad de salida de cada producto. */
  ventas: VentaReorden[];
  /* Unidades pedidas a proveedor que aún no llegan, por producto. */
  enCamino: EnCamino;
  paramsReorden: ParamsReorden;
  rol: RolId;
  /* Qué puede ver de dinero quien mira: el costo es egreso, el precio ingreso. */
  dinero: VistaDinero;
  tiendanube: { conectada: boolean; ultimaSync: string | null };
  mercadolibre: { conectada: boolean; ultimaSync: string | null };
  tiktok: { conectada: boolean; ultimaSync: string | null };
  /* false (el default del sistema) = el CRM no modifica nada en las plataformas. */
  escrituraCanales: boolean;
  /* Estado del piloto de escritura: qué productos manda el CRM y cómo van. */
  piloto: EstadoPiloto;
  /* Conteos físicos recientes (con su producto). */
  conteos: ConteoConProducto[];
  /* Equipo, para los selectores de "quién contó/corroboró". */
  equipo: Profile[];
  /* Última reconciliación guardada, para mostrarla al instante al entrar. */
  reconciliacionInicial: { resumen: ResumenReconciliacion; creadoEn: string } | null;
  /* Avisos al volver del OAuth, ya resueltos en el servidor por la page. */
  avisosConexion: AvisoConexion[];
}) {
  const router = useRouter();
  const gestor = esGestor(rol);
  /* Conectar/sincronizar canales queda solo para dirección: es una acción de
     mantenimiento y da miedo que alguien la pique por error. */
  const esDireccion = rol === "direccion";
  const [pestana, setPestana] = useState<Pestana>("productos");
  const [vistaCatalogo, setVistaCatalogo] = useState<VistaCatalogo>("desglosado");
  const [masFiltros, setMasFiltros] = useState(false);

  /* Avisos al volver del OAuth: la page los arma en el servidor; aquí solo se
     emiten una vez y se limpia la URL para que un refresh no los repita. */
  const avisosEmitidos = useRef(false);
  useEffect(() => {
    if (avisosEmitidos.current || avisosConexion.length === 0) return;
    avisosEmitidos.current = true;
    for (const aviso of avisosConexion) {
      if (aviso.tipo === "ok") toast.success(aviso.mensaje);
      else if (aviso.tipo === "error") toast.error(aviso.mensaje);
      else toast.info(aviso.mensaje);
    }
    window.history.replaceState(null, "", window.location.pathname);
  }, [avisosConexion]);

  /* null = cerrado; "nuevo" = alta; objeto = edición. */
  const [productoDialog, setProductoDialog] = useState<ProductConProveedor | "nuevo" | null>(null);

  const {
    busqueda,
    setBusqueda,
    filtroTipo,
    setFiltroTipo,
    filtroStock,
    setFiltroStock,
    filtroLogistica,
    setFiltroLogistica,
    filtroVigencia,
    setFiltroVigencia,
    productosVisibles,
    filtrosActivos,
    limpiarFiltros,
  } = useFiltrosProductos(productos);

  /* Filtros del historial (solo aplican a la pestaña de movimientos): por dónde
     impactó el cambio y por quién lo hizo. */
  const [filtroCanalMov, setFiltroCanalMov] = useState<string>(CANAL_MOV_INICIAL);
  const [filtroAutorMov, setFiltroAutorMov] = useState("todos");
  const [vistaMov, setVistaMov] = useState<VistaMov>(VISTA_MOV_INICIAL);

  /* La vista y el canal se resuelven en el SERVIDOR, no recortando la lista que
     ya llegó: el tope se aplica antes de filtrar, así que un filtro de cliente
     enseñaría tres renglones de Mercado Libre y daría a entender que solo hubo
     tres. En la combinación inicial no se va a la red —esos datos son los que
     la página ya trajo—. */
  const claveMov = `${vistaMov}:${filtroCanalMov}`;
  const { datos: cargaMov, cargando: cargandoMov } = useDetalleRemoto<{
    movimientos: StockLog[];
    tope: boolean;
  }>(async () => {
    if (vistaMov === VISTA_MOV_INICIAL && filtroCanalMov === CANAL_MOV_INICIAL) {
      return { movimientos, tope: movimientos.length >= LIMITE_MOVIMIENTOS };
    }
    const r = await movimientosStock({
      vista: vistaMov,
      canal: filtroCanalMov as "todos" | StockLog["canal"],
    });
    return "error" in r ? { movimientos: [], tope: false } : r;
  }, claveMov);

  const movimientosVista = useMemo(() => cargaMov?.movimientos ?? [], [cargaMov]);

  /* Quiénes firman los movimientos cargados. Sale de ellos y no del equipo
     entero: ofrecer a quince personas cuando en el historial solo aparecen dos
     es un selector lleno de filtros que no devuelven nada. */
  const autoresMov = useMemo(() => {
    const vistos = new Map<string, string>();
    for (const m of movimientosVista) {
      if (m.created_by && m.autor?.nombre) vistos.set(m.created_by, m.autor.nombre);
    }
    return [...vistos].sort((a, b) => a[1].localeCompare(b[1]));
  }, [movimientosVista]);

  /* El autor sí se filtra aquí: solo tiene sentido sobre lo que se está viendo
     (el selector se arma con los que firman esos mismos renglones). */
  const movimientosFiltrados = movimientosVista.filter(
    (m) =>
      filtroAutorMov === "todos" ||
      (filtroAutorMov === "sistema" ? m.created_by == null : m.created_by === filtroAutorMov),
  );

  /* Agotado (ya no hay) y por acabarse (queda poco: lo accionable) son cosas
     distintas; juntarlos ahogaba el aviso con cientos de variantes agotadas. */
  const agotados = productos.filter((p) => estadoStock(p) === "agotado");
  const porAcabarse = productos.filter((p) => estadoStock(p) === "por_acabarse");
  /* Ojo con el `?? 0` de la suma: si el costo no viaja —quien mira no ve los
     egresos— esto daría cero en silencio y la tarjeta pintaría «$0», que se lee
     como un dato. Por eso el valor es null, y la tarjeta desaparece. */
  const valorInventario = dinero.egresos
    ? productos.reduce((acc, p) => acc + p.stock * (p.costo ?? 0), 0)
    : null;

  /* Reorden con la ventana y la plataforma por defecto de «Qué pedir» (30 días,
     todas), para que la tarjeta KPI, la tabla y la ficha de un producto cuenten
     lo mismo al entrar. */
  const reorden = useMemo(
    () =>
      calcularReabastecimiento({
        productos,
        ventas,
        enCamino,
        ventanaDias: VENTANA_REORDEN,
        params: paramsReorden,
      }),
    [productos, ventas, enCamino, paramsReorden],
  );
  const porPedir = reorden.filter((g) => g.urgencia === "pedir_ya");

  function abrirNuevo() {
    if (pestana === "productos") setProductoDialog("nuevo");
  }

  /* Los pedidos a proveedor viven en su propio módulo, que es solo de dirección.
     Desde aquí se navega: con el renglón sugerido en la URL cuando sale de «Qué
     pedir», y sin nada cuando sale del aviso de stock bajo. Para quien no es
     dirección estos botones no se pintan (ver `esDireccion`). */
  function irAPedidoNuevo(grupo?: GrupoReorden) {
    const query = grupo ? `?producto=${grupo.productoId}&cantidad=${grupo.sugerido}` : "";
    router.push(`/proveedores${query}`);
  }

  /* Cuántos de los filtros plegados están puestos, para el contador del botón.
     «Vigentes» es el valor por defecto y no cuenta como filtro activo aquí.
     En el teléfono se pliegan también tipo y stock —la barra con cinco controles
     tapaba el catálogo—, así que ahí el contador tiene que contarlos: un filtro
     escondido y sin avisar es un filtro que se queda puesto para siempre. */
  const filtrosPlegadosActivos =
    (filtroLogistica !== "todos" ? 1 : 0) + (filtroVigencia !== "vigentes" ? 1 : 0);
  const filtrosPlegadosMovil =
    filtrosPlegadosActivos + (filtroTipo !== "todos" ? 1 : 0) + (filtroStock !== "todos" ? 1 : 0);

  /* Estos dos se pintan en DOS sitios según el ancho —la barra en escritorio, el
     panel plegable en el teléfono—, así que se declaran una vez aquí en lugar de
     copiar treinta líneas de JSX que luego se separan. Cada sitio monta su
     propia instancia; las dos leen y escriben el mismo estado. */
  const selectTipo = (
    <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v ?? "todos")}>
      <SelectTrigger className="w-full bg-card md:w-[190px]">
        <SelectValue>
          {(v: string) =>
            v === "todos" ? "Todos los tipos" : (obtenerTipoProducto(v)?.nombre ?? "Tipo")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todos">Todos los tipos</SelectItem>
        {TIPOS_PRODUCTO.map((t) => (
          <SelectItem key={t.id} value={t.id}>
            {t.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const selectStock = (
    <Select value={filtroStock} onValueChange={(v) => setFiltroStock(v ?? "todos")}>
      <SelectTrigger className="w-full bg-card md:w-[165px]">
        <SelectValue>
          {(v: string) =>
            v === "todos" ? "Todo el stock" : (obtenerEstadoStock(v)?.nombre ?? "Stock")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todos">Todo el stock</SelectItem>
        {ESTADOS_STOCK.map((e) => (
          <SelectItem key={e.id} value={e.id}>
            {e.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  /* Los canales, para la pastilla de estado de la cabecera. Se ordenan por
     sincronización más reciente: la que se enseña es la de arriba. */
  const canales = [
    { nombre: "Tienda Nube", ...tiendanube },
    { nombre: "Mercado Libre", ...mercadolibre },
    { nombre: "TikTok Shop", ...tiktok },
  ];
  const canalesConectados = canales.filter((c) => c.conectada).length;
  const canalesSincronizados = canales
    .filter((c): c is { nombre: string; conectada: boolean; ultimaSync: string } =>
      Boolean(c.conectada && c.ultimaSync),
    )
    .sort((a, b) => b.ultimaSync.localeCompare(a.ultimaSync));

  /* Desde el aviso o las tarjetas: ver la lista filtrada por semáforo. */
  function verProductosPorStock(estado: string) {
    setPestana("productos");
    setFiltroStock(estado);
  }

  return (
    <div>
      {/* Encabezado: título a la izquierda, acciones a la derecha */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">Inventario</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Cuánto hay de cada producto, quién lo surte y qué viene en camino.
          </p>
          {/* Estado de los canales en UNA pastilla, no en tres: lo que se
              consulta es «¿está al día?», y el detalle por canal cabe en el
              tooltip. Junto a ella, el candado de solo lectura —una condición
              permanente que antes ocupaba una tarjeta entera abajo—. */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {canalesSincronizados.length > 0 && (
              <span
                title={canalesSincronizados.map((c) => `${c.nombre} · ${formatearFechaHora(c.ultimaSync)}`).join("\n")}
                className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground"
              >
                <span className="size-1.5 rounded-full bg-green-500" />
                {canalesSincronizados.length === 1
                  ? `${canalesSincronizados[0].nombre} sincronizado`
                  : `${canalesSincronizados.length} canales sincronizados`}
                {" · "}
                {formatearFechaHora(canalesSincronizados[0].ultimaSync)}
              </span>
            )}
            {!escrituraCanales && canalesConectados > 0 && (
              <span
                title="El CRM importa el inventario de Tienda Nube, Mercado Libre y TikTok Shop, pero no modifica nada allá. Los ajustes de stock, precio y costo que hagas aquí se quedan en el CRM."
                className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground"
              >
                <Lock className="size-3" strokeWidth={2} />
                Solo lectura
              </span>
            )}
          </div>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 md:w-auto md:justify-end">
          {/* Conectar/sincronizar canales: solo dirección, para que nadie más lo
              pique por error. La sync automática por cron sigue corriendo igual. */}
          {esDireccion && (
            <BarraCanales tiendanube={tiendanube} mercadolibre={mercadolibre} tiktok={tiktok} />
          )}
          {ETIQUETA_NUEVO[pestana] && (
            <Button
              onClick={abrirNuevo}
              className="h-auto w-full gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)] md:w-auto"
            >
              <Plus className="size-4" strokeWidth={2.1} />
              {ETIQUETA_NUEVO[pestana]}
            </Button>
          )}
        </div>
      </div>

      <TabsSeccion opciones={PESTANAS} valor={pestana} onCambio={setPestana} className="mb-4" />

      {/* Tarjetas KPI. En el teléfono se ven las TRES accionables en un renglón;
          «SKUs» y «Valor inventario» son datos de contexto que ahí solo estiraban
          la pantalla antes del catálogo. */}
      <div className="mb-4 grid grid-cols-3 gap-2.5 md:grid-cols-3 md:gap-3.5 lg:grid-cols-6">
        <StatCard
          etiqueta="SKUs"
          valor={String(productos.length)}
          icono={Boxes}
          className="hidden md:block"
        />
        <button type="button" onClick={() => setPestana("reabastecer")} className="text-left">
          <StatCard
            etiqueta="Por pedir"
            valor={String(porPedir.length)}
            icono={ShoppingCart}
            nota="con la venta de 30 días"
            notaClassName="hidden md:block"
            valorClassName={porPedir.length > 0 ? "text-red-600" : undefined}
            className="h-full transition-colors hover:bg-accent/40"
          />
        </button>
        <StatCard
          etiqueta="Por acabarse"
          valor={String(porAcabarse.length)}
          icono={AlertTriangle}
          valorClassName={porAcabarse.length > 0 ? "text-amber-600" : undefined}
        />
        <StatCard
          etiqueta="Agotados"
          valor={String(agotados.length)}
          icono={PackageX}
          valorClassName={agotados.length > 0 ? "text-red-600" : undefined}
        />
        {valorInventario !== null && (
          <StatCard
            etiqueta="Valor inventario"
            valor={valorCompacto(valorInventario)}
            icono={DollarSign}
            className="hidden md:block"
          />
        )}
      </div>

      {/* Barra de herramientas de la sección: búsqueda y filtros. Las pestañas
          se subieron junto al título, con las demás pantallas; por eso la barra
          ya no se pinta en Reconciliación, que no tiene nada que filtrar y
          quedaría como un hueco. */}
      {pestana !== "reconciliacion" && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {(pestana === "productos" || pestana === "reabastecer") && (
            <>
              <div className="relative flex w-full items-center md:w-auto md:min-w-[260px]">
                <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" strokeWidth={1.9} />
                <Input
                  placeholder="Buscar producto, SKU o proveedor…"
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="h-auto rounded-[10px] bg-card py-2 pl-9"
                />
              </div>
              {/* Tipo y stock viven en la barra en escritorio y plegados en el
                  teléfono (ver el bloque de «Más filtros»): son los MISMOS
                  controles, montados donde caben. */}
              <div className="hidden md:contents">{selectTipo}</div>
            </>
          )}

          {pestana === "productos" && (
            <>
              <div className="hidden md:contents">{selectStock}</div>

              {/* En escritorio se pliegan solo almacén y vigencia, que se usan
                  poco; en el teléfono también tipo y stock, porque cinco
                  controles en fila dejaban el catálogo fuera de la pantalla. El
                  contador avisa de los que quedaron puestos: un filtro escondido
                  y olvidado es lo que hace que «falte» un producto. */}
              <Button
                variant="outline"
                onClick={() => setMasFiltros((v) => !v)}
                className={cn(
                  "h-auto flex-1 gap-1.5 rounded-[10px] px-3 py-2 text-[13px] font-semibold md:flex-none",
                  filtrosPlegadosMovil > 0 && "border-primary/40 text-primary",
                )}
              >
                <SlidersHorizontal className="size-4" strokeWidth={2} />
                Filtros
                {filtrosPlegadosMovil > 0 && (
                  <span className="rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground md:hidden">
                    {filtrosPlegadosMovil}
                  </span>
                )}
                {filtrosPlegadosActivos > 0 && (
                  <span className="hidden rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground md:inline">
                    {filtrosPlegadosActivos}
                  </span>
                )}
              </Button>

              {/* Desglosado = una fila por variante de canal (como siempre).
                  Agrupado = una fila por producto, con sus tallas plegadas. */}
              <ControlSegmentado
                opciones={VISTAS_CATALOGO}
                valor={vistaCatalogo}
                onCambio={setVistaCatalogo}
                className="flex-1 md:flex-none"
                botonClassName="flex-1 md:flex-none"
              />
            </>
          )}

          {pestana === "movimientos" && (
            <>
              <ControlSegmentado
                opciones={VISTAS_MOV}
                valor={vistaMov}
                onCambio={setVistaMov}
                className="flex-1 md:flex-none"
                botonClassName="flex-1 md:flex-none"
              />
              <Select value={filtroCanalMov} onValueChange={(v) => setFiltroCanalMov(v ?? "todos")}>
                <SelectTrigger className="w-full bg-card md:w-[190px]">
                  <SelectValue>
                    {(v: string) => CANALES_MOV.find(([id]) => id === v)?.[1] ?? "Canal"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {CANALES_MOV.map(([id, label]) => (
                    <SelectItem key={id} value={id}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {/* Solo cuando alguien firma algo: si todo el historial visible es
                  automático, el selector no tendría a quién filtrar. */}
              {autoresMov.length > 0 && (
                <Select value={filtroAutorMov} onValueChange={(v) => setFiltroAutorMov(v ?? "todos")}>
                  <SelectTrigger className="w-full bg-card md:w-[170px]">
                    <SelectValue>
                      {(v: string) =>
                        v === "todos"
                          ? "Quién: todos"
                          : v === "sistema"
                            ? "Automático"
                            : (autoresMov.find(([id]) => id === v)?.[1] ?? "Quién")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Quién: todos</SelectItem>
                    <SelectItem value="sistema">Automático</SelectItem>
                    {autoresMov.map(([id, nombre]) => (
                      <SelectItem key={id} value={id}>
                        {nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </>
          )}
        </div>
      )}

      {pestana === "productos" && masFiltros && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5">
          {/* Los dos que en escritorio están arriba, en la barra. */}
          <div className="contents md:hidden">
            {selectTipo}
            {selectStock}
          </div>
          {(mercadolibre.conectada || tiktok.conectada) && (
            <Select value={filtroLogistica} onValueChange={(v) => setFiltroLogistica(v ?? "todos")}>
              <SelectTrigger className="w-[185px] bg-background">
                <SelectValue>
                  {(v: string) => LOGISTICAS.find(([id]) => id === v)?.[1] ?? "Almacén"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {LOGISTICAS.map(([id, label]) => (
                  <SelectItem key={id} value={id}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={filtroVigencia} onValueChange={(v) => setFiltroVigencia(v ?? "vigentes")}>
            <SelectTrigger className="w-[155px] bg-background">
              <SelectValue>
                {(v: string) => VIGENCIAS.find(([id]) => id === v)?.[1] ?? "Vigencia"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {VIGENCIAS.map(([id, label]) => (
                <SelectItem key={id} value={id}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" onClick={limpiarFiltros} className="text-[12.5px]">
            Limpiar filtros
          </Button>
        </div>
      )}

      <AvisosInventario
        porPedir={porPedir}
        porAcabarse={porAcabarse}
        agotados={agotados}
        gestor={gestor}
        pestana={pestana}
        onVerQuePedir={() => setPestana("reabastecer")}
        onVerPorStock={verProductosPorStock}
        onGenerarPedido={esDireccion ? () => irAPedidoNuevo() : undefined}
      />

      {pestana === "productos" &&
        (vistaCatalogo === "agrupado" ? (
          <TablaProductosAgrupada
            productos={productosVisibles}
            totalCatalogo={productos.length}
            busqueda={busqueda}
            filtroTipo={filtroTipo}
            filtroStock={filtroStock}
            filtrosActivos={filtrosActivos}
            onLimpiarFiltros={limpiarFiltros}
            escrituraCanales={escrituraCanales}
            verPrecio={dinero.ingresos}
            onAbrir={(p) => router.push(`/inventario/producto/${p.id}`)}
          />
        ) : (
          <TablaProductos
            productos={productosVisibles}
            totalCatalogo={productos.length}
            busqueda={busqueda}
            filtroTipo={filtroTipo}
            filtroStock={filtroStock}
            filtrosActivos={filtrosActivos}
            onLimpiarFiltros={limpiarFiltros}
            escrituraCanales={escrituraCanales}
            verPrecio={dinero.ingresos}
            onAbrir={(p) => router.push(`/inventario/producto/${p.id}`)}
          />
        ))}
      {pestana === "reabastecer" && (
        <TablaReabastecer
          productos={productos}
          ventas={ventas}
          enCamino={enCamino}
          params={paramsReorden}
          busqueda={busqueda}
          filtroTipo={filtroTipo}
          onPedir={esDireccion ? irAPedidoNuevo : undefined}
        />
      )}
      {pestana === "movimientos" && (
        <TablaMovimientos
          movimientos={movimientosFiltrados}
          vista={vistaMov}
          cargando={cargandoMov}
          tope={cargaMov?.tope ?? false}
        />
      )}

      {pestana === "reconciliacion" && (
        <PanelReconciliacion
          piloto={piloto}
          conteos={conteos}
          productos={productos}
          equipo={equipo}
          reconciliacionInicial={reconciliacionInicial}
        />
      )}

      {/* La ficha del producto ya no vive aquí: abrir un renglón NAVEGA a
          /inventario/producto/[id], que es una pantalla completa y no un pop-up
          apretado dentro del catálogo. */}
      {productoDialog && (
        <ProductoDialog
          producto={productoDialog === "nuevo" ? null : productoDialog}
          proveedores={proveedores}
          gestor={gestor}
          dinero={dinero}
          escrituraCanales={escrituraCanales}
          onClose={() => setProductoDialog(null)}
        />
      )}
    </div>
  );
}
