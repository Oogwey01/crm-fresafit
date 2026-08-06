"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AlertTriangle, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { CANALES, TIPOS_PRODUCTO, esGestor, obtenerCanal, obtenerTipoProducto } from "@/lib/catalogos";
import {
  diasDesdeHoy,
  formatearFecha,
  hoyISO,
  rangoPersonalizado,
  rangosDePeriodo,
  type PresetRangoId,
} from "@/lib/fecha";
import { RangoFechas } from "@/components/compartido/rango-fechas";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { formatearMXN } from "@/lib/moneda";
import { veDineroDeCanal, type VistaDinero } from "@/lib/permisos-dinero";
import { tallaDeVariante, compararTallas } from "@/lib/talla";
import { ETIQUETA_DELTA as ETIQUETA_DELTA_BASE, deltaPct } from "@/lib/metricas";
import { nombreVenta } from "@/lib/ventas";
import { GraficaVentasDia } from "@/components/metricas/grafica-ventas-dia";
import {
  importarVentasTiendanube,
  listarVentas,
  obtenerMetricas,
  type DatosMetricas,
} from "@/app/(app)/metricas/actions";
import type {
  CanalId,
  Product,
  RolId,
  VentaMetricas,
  TipoProductoId,
} from "@/lib/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/compartido/stat-card";
import { ListaBarras } from "@/components/compartido/lista-barras";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { VentaDialog } from "@/components/ventas/venta-dialog";
import { Plataformas } from "@/components/metricas/plataformas";
import { cn } from "@/lib/utils";

/* "" = rango elegido a mano en el calendario (sin atajo activo). */
type PeriodoId = PresetRangoId | "";

/* Las etiquetas de los atajos salen del compartido; el rango libre se compara
   contra el bloque inmediatamente anterior del mismo largo. */
const ETIQUETA_DELTA: Record<PeriodoId, string> = {
  ...ETIQUETA_DELTA_BASE,
  "": "vs. periodo anterior",
};

/* Dos rejillas literales y no una construida al vuelo: Tailwind compila las
   clases leyendo el código fuente, así que un `grid-cols-[…]` armado por
   concatenación no existiría en la hoja de estilos. */
const COLS_VENTAS = "grid-cols-[90px_130px_minmax(220px,1fr)_70px_120px_110px]";
const COLS_VENTAS_SIN_DINERO = "grid-cols-[90px_130px_minmax(220px,1fr)_70px_110px]";

/* Días de la gráfica de barras. Ventana fija: no sigue al periodo elegido (sí a
   la plataforma). Tiene que coincidir con el de la página, que trae la primera
   tanda ya calculada. */
const DIAS_GRAFICA = 14;

/* Rótulo de sección de las tarjetas. */
const ROTULO = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const TARJETA = "rounded-2xl border bg-card p-5 shadow-sm";

/* Chips de productos sin movimiento que se listan antes del «+N más». */
const CHIPS_SIN_MOVIMIENTO = 12;

export function PanelMetricas({
  inicial,
  ventasIniciales,
  errorResumen,
  hayVentas,
  productos,
  rol,
  dinero,
  tiendanube,
  bloquesCanales,
}: {
  /* Cifras del periodo con el que abre la página, ya sumadas en la base. */
  inicial: DatosMetricas;
  /* Primera página de la tabla de renglones; las siguientes las pide «Ver más». */
  ventasIniciales: VentaMetricas[];
  /* La base no pudo dar el resumen (típicamente, migración sin aplicar). */
  errorResumen: string | null;
  /* ¿Existe alguna venta, en cualquier fecha? Distingue «no hay nada aún» de
     «no hay nada con estos filtros», que piden mensajes distintos. */
  hayVentas: boolean;
  /* Catálogo activo, solo para la lista de «productos sin movimiento». Los
     buscadores del diálogo de venta piden lo suyo por su cuenta al abrirse. */
  productos: Pick<Product, "id" | "nombre" | "variante" | "sku" | "activo">[];
  rol: RolId;
  /* Qué puede ver de dinero quien mira. Aquí llega la vista completa —y no un
     booleano— porque esta pantalla cambia de plataforma sin recargar: el
     encargado de un canal ve los importes de SU canal y no los de «todas». */
  dinero: VistaDinero;
  tiendanube: { conectada: boolean; ultimaSync: string | null };
  /* Lo que se lee en vivo de los canales, ya renderizado en el servidor dentro
     de un <Suspense>: son tres llamadas a APIs ajenas que tardan segundos, y
     esperarlas retrasaba TODA la pantalla. Llega como nodo y no como datos
     porque así el trozo lento viaja por su cuenta, cuando esté listo. */
  bloquesCanales: React.ReactNode;
}) {
  const gestor = esGestor(rol);
  const [periodo, setPeriodo] = useState<PeriodoId>("mes");
  /* Rango a mano (cuando no hay atajo activo). Arranca en el mes en curso para
     que el calendario abra ya sobre algo coherente. */
  const [desde, setDesde] = useState(() => hoyISO().slice(0, 8) + "01");
  const [hasta, setHasta] = useState(hoyISO);
  /* Plataforma: "todas" o un canal. Afecta TODO el panel, no solo la tabla. */
  const [canal, setCanal] = useState<CanalId | "todas">("todas");
  const [ventaDialog, setVentaDialog] = useState<VentaMetricas | "nueva" | null>(null);
  const { pending: importando, ejecutar: ejecutarImportacion } = useAccionServidor();
  /* Desglose de «Productos estrella» por categoría y talla. */
  const [catEstrella, setCatEstrella] = useState<TipoProductoId | "todas">("todas");
  const [tallaEstrella, setTallaEstrella] = useState<string>("todas");

  const rangos = periodo ? rangosDePeriodo(periodo) : rangoPersonalizado(desde, hasta);

  /* --- De dónde salen ahora las cifras ---
     Hasta aquí el panel recibía las ventas del año entero y las sumaba en el
     navegador cada vez que se tocaba un filtro. Eran unos 25.000 renglones, con
     un tope que dejaba fuera lo más viejo sin poder evitarlo. Ahora las sumas
     las hace la base y esto solo pide el resultado cuando cambia el periodo o
     la plataforma; el desglose por categoría y talla se sigue resolviendo aquí,
     pero sobre unos cientos de filas ya agregadas, así que sigue siendo
     instantáneo. */
  const [datos, setDatos] = useState<DatosMetricas>(inicial);
  const [ventas, setVentas] = useState<VentaMetricas[]>(ventasIniciales);
  const [cargando, iniciarCarga] = useTransition();
  const [cargandoMas, setCargandoMas] = useState(false);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);
  /* La primera pintada ya viene servida por la página: no hay que volver a
     pedir lo mismo al montar. */
  const primeraCarga = useRef(true);
  /* Número de la consulta en curso. Cambiar de periodo o de plataforma dos
     veces seguidas lanza dos consultas, y no hay ninguna garantía de que
     contesten en orden: si la primera llega tarde, pintaría sus cifras bajo los
     filtros de la segunda —números de julio bajo el rótulo de agosto—, que es
     de los errores más difíciles de notar. Cada consulta se queda con su número
     y al volver comprueba que siga siendo la última; si no, se descarta. */
  const peticion = useRef(0);

  /* Incluye TAMBIÉN el periodo de comparación, y no por adorno: el comparativo
     no se deduce del rango actual. «Mes actual» (1–4 de agosto) se compara
     contra julio entero, pero ese mismo 1–4 marcado a mano en el calendario se
     compara contra los cuatro días previos. Sin esta parte de la clave, elegir
     el atajo —que aterriza en modo manual— dejaba el delta midiendo contra el
     mes completo mientras el rótulo ya decía otra cosa. */
  const claveConsulta =
    `${rangos.actual.desde}|${rangos.actual.hasta}` +
    `|${rangos.anterior.desde}|${rangos.anterior.hasta}|${canal}`;

  const recargar = useCallback(() => {
    const ventana = { desde: diasDesdeHoy(-(DIAS_GRAFICA - 1)), hasta: hoyISO() };
    const rango = { desde: rangos.actual.desde, hasta: rangos.actual.hasta };
    const anterior = { desde: rangos.anterior.desde, hasta: rangos.anterior.hasta };
    const mia = ++peticion.current;

    iniciarCarga(async () => {
      const [resumen, pagina] = await Promise.all([
        obtenerMetricas(rango, anterior, ventana, canal),
        listarVentas(rango, canal, 0),
      ]);
      if (mia !== peticion.current) return; // llegó tarde: manda una posterior
      if ("error" in resumen) {
        setErrorCarga(resumen.error);
        return;
      }
      setErrorCarga(null);
      setDatos(resumen.datos);
      setVentas("error" in pagina ? [] : pagina.ventas);
    });
    // El rango sale de `periodo`/`desde`/`hasta`, que ya están en las deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveConsulta]);

  useEffect(() => {
    if (primeraCarga.current) {
      primeraCarga.current = false;
      return;
    }
    recargar();
  }, [recargar]);

  /* Cerrar el diálogo de venta —tras registrar, editar o borrar— vuelve a pedir
     las cifras. Hace falta decirlo explícitamente: las tarjetas ya no salen de
     las props sino de este estado, así que el `revalidatePath` de las acciones
     refresca el árbol del servidor pero no mueve nada de lo que se ve. Sin esto,
     guardar una venta la dejaba invisible hasta recargar la página, y el equipo
     acabaría capturándola dos veces creyendo que no se guardó. Se recarga
     también al cancelar, que cuesta unos kilobytes y evita tener que adivinar
     desde fuera si hubo cambios. */
  function cerrarDialogoVenta() {
    setVentaDialog(null);
    recargar();
  }

  const actual = datos.actual;
  const numVentas = actual.kpis.ventas;

  /* Los importes de este panel dependen de la plataforma elegida: el encargado
     de un canal ve lo suyo, y en «todas las plataformas» no ve nada, porque la
     suma incluiría los canales ajenos. La base decide lo mismo por su cuenta
     (los importes llegan en null); esto es para saber qué pintar en su lugar. */
  const verDinero = veDineroDeCanal(dinero, canal === "todas" ? null : canal);

  /* --- Números clave ---
     `total` (suma de renglones) es lo que se vendió en PRODUCTO. Lo que reportan
     los paneles de los canales es el bruto de la orden, que además lleva envío y
     descuentos: por eso existe `sale_orders`. La base combina las dos fuentes —
     órdenes para lo importado, renglones para lo capturado a mano, que no genera
     orden— y así el KPI es comparable contra Tienda Nube y Mercado Libre. */
  const total = actual.kpis.total;
  const piezas = actual.kpis.piezas;
  const ticket = actual.kpis.ticket;
  const piezasPorVenta = numVentas > 0 ? piezas / numVentas : 0;

  function sumarBruto(lista: { bruto: number }[]): number {
    return lista.reduce((a, c) => a + Number(c.bruto), 0);
  }
  /* Piezas por venta hace de ticket cuando no hay importes: es la misma
     pregunta —cuánto se lleva cada quien— medida en lo que sí se puede ver. */
  const piezasPorVentaTexto =
    piezasPorVenta > 0
      ? `${piezasPorVenta.toFixed(piezasPorVenta % 1 === 0 ? 0 : 1)} ${
          piezasPorVenta === 1 ? "pieza" : "piezas"
        } por venta`
      : "Sin ventas en el periodo";
  const brutoCanalActual = useMemo(
    () => new Map(actual.bruto_por_canal.map((b) => [b.canal, Number(b.bruto)])),
    [actual.bruto_por_canal],
  );
  const bruto = sumarBruto(actual.bruto_por_canal);
  const brutoAnterior = sumarBruto(datos.anterior.bruto_por_canal);
  /* Cuánto del bruto NO es producto (envío menos descuentos). Se muestra para
     que la diferencia contra la suma de renglones sea explicable de un vistazo
     y no vuelva a parecer un error del CRM. */
  const extras = bruto - (total ?? 0);

  /* --- Ventas por día (últimos 14 días, fijo; respeta la plataforma) ---
     La base devuelve solo los días CON ventas; aquí se rellenan los huecos para
     que la gráfica mantenga sus 14 barras aunque alguna quede en cero. */
  const dias = useMemo(() => {
    const porDia = new Map(datos.dias.map((d) => [d.fecha, d]));
    return Array.from({ length: DIAS_GRAFICA }, (_, i) => {
      const iso = diasDesdeHoy(-(DIAS_GRAFICA - 1 - i));
      const d = porDia.get(iso);
      return { iso, total: d?.total == null ? null : Number(d.total), ventas: d?.ventas ?? 0 };
    });
  }, [datos.dias]);

  /* --- Por canal: se listan todos los canales del catálogo, incluso en cero
     (atenuados), para que se vea de dónde NO está entrando dinero. "Otro" solo
     aparece si tuvo ventas. --- */
  /* Exactamente el mismo desglose que alimenta la tarjeta «Ventas», para que las
     partes sumen el total de arriba. Sin memo: recorrer unos pocos canales es
     más barato que la comparación de dependencias. */
  /* Sin importes, las mismas barras contadas en PIEZAS. La pregunta que contesta
     esta tarjeta —por dónde se está moviendo la mercancía— sigue en pie sin
     decir cuánto deja cada canal, y dejarla vacía habría quitado de la pantalla
     una lectura que el equipo sí necesita. */
  const piezasCanalActual = useMemo(
    () => new Map(actual.unidades_por_canal.map((u) => [u.canal, Number(u.piezas)])),
    [actual.unidades_por_canal],
  );
  const conDato = verDinero ? brutoCanalActual : piezasCanalActual;
  const porCanal = CANALES.filter((c) => c.id !== "otro" || conDato.has(c.id))
    .map((c) => ({
      id: c.id,
      nombre: c.nombre,
      valor: conDato.get(c.id) ?? 0,
      color: c.color,
    }))
    .sort((a, b) => b.valor - a.valor);

  /* --- Productos estrella, desglosables por categoría y talla ---
     Todo esto trabaja sobre `por_producto`, que ya viene sumado por ficha: son
     unos cientos de filas en vez de los miles de renglones de antes, así que
     mover los dos selectores sigue respondiendo sin esperas. */
  const vendido = actual.por_producto;

  /* Lo vendido acotado a la categoría elegida (sin aplicar aún la talla): base
     para el ranking de tallas y para las tallas disponibles. */
  const ventasCategoria = useMemo(
    () => (catEstrella === "todas" ? vendido : vendido.filter((v) => v.tipo === catEstrella)),
    [vendido, catEstrella],
  );
  /* Tallas presentes en la categoría (para poblar el filtro). */
  const tallasDisponibles = useMemo(() => {
    const s = new Set<string>();
    for (const v of ventasCategoria) {
      const t = tallaDeVariante(v.variante);
      if (t) s.add(t);
    }
    return [...s].sort(compararTallas);
  }, [ventasCategoria]);
  /* Ya acotado por categoría Y talla → top de productos. Sin importes el ranking
     es por piezas: «estrella» pasa a querer decir el que más sale, que es otra
     pregunta legítima y la única que se puede contestar sin dinero. */
  const topProductos = useMemo(() => {
    const filtradas =
      tallaEstrella === "todas"
        ? ventasCategoria
        : ventasCategoria.filter((v) => tallaDeVariante(v.variante) === tallaEstrella);
    return filtradas
      .map((v) => ({
        id: v.clave,
        nombre: nombreVenta({
          producto: v.nombre ? { nombre: v.nombre, variante: v.variante } : null,
          descripcion: v.descripcion,
        }),
        valor: verDinero ? Number(v.monto) : v.piezas,
        detalle: verDinero ? `${v.piezas} pzas` : undefined,
      }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 5);
  }, [ventasCategoria, tallaEstrella, verDinero]);
  /* Ranking de tallas más vendidas (por piezas) en la categoría elegida. */
  const tallasMasVendidas = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of ventasCategoria) {
      const t = tallaDeVariante(v.variante) ?? "Sin talla";
      m.set(t, (m.get(t) ?? 0) + v.piezas);
    }
    return [...m.entries()]
      .map(([nombre, piezas]) => ({ id: nombre, nombre, valor: piezas }))
      .sort((a, b) => b.valor - a.valor);
  }, [ventasCategoria]);

  const sinMovimiento = useMemo(() => {
    const vendidos = new Set(vendido.map((v) => v.producto_id).filter(Boolean));
    return productos.filter((p) => p.activo && !vendidos.has(p.id));
  }, [vendido, productos]);

  /* La tabla de renglones: la primera página llega con la carga de la página y
     «Ver más» va pidiendo las siguientes. El total del encabezado sale del
     resumen, no de lo que haya bajado hasta ahora. */
  const listadas = ventas;
  const totalListado = total;

  function verMas() {
    setCargandoMas(true);
    const rango = { desde: rangos.actual.desde, hasta: rangos.actual.hasta };
    /* Misma cautela que arriba: si mientras carga esta página se cambia el
       periodo o la plataforma, sus filas pertenecen a otra consulta y no deben
       apilarse sobre la lista nueva. */
    const mia = peticion.current;
    listarVentas(rango, canal, ventas.length)
      .then((r) => {
        if (mia !== peticion.current) return;
        if (!("error" in r)) setVentas((prev) => [...prev, ...r.ventas]);
      })
      .finally(() => setCargandoMas(false));
  }

  const columnasVenta: Columna<VentaMetricas>[] = [
    {
      clave: "fecha",
      label: "Fecha",
      celda: (v) => <div className="text-[13.5px] text-muted-foreground">{formatearFecha(v.fecha)}</div>,
    },
    {
      clave: "canal",
      label: "Canal",
      celda: (v) => {
        const canal = obtenerCanal(v.canal);
        return canal ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12.5px] font-semibold"
            style={{ backgroundColor: `${canal.color}1a`, color: canal.color }}
          >
            <span className="size-1.5 rounded-full" style={{ backgroundColor: canal.color }} />
            {canal.nombre}
          </span>
        ) : null;
      },
    },
    {
      clave: "producto",
      label: "Producto",
      esTitulo: true,
      celda: (v) => (
        <button
          type="button"
          onClick={() => setVentaDialog(v)}
          className="truncate text-left text-[14px] font-medium hover:underline"
          title={v.notas ?? nombreVenta(v)}
        >
          {nombreVenta(v)}
        </button>
      ),
    },
    {
      clave: "cantidad",
      label: "Cant.",
      celda: (v) => <div className="text-[13.5px] tabular-nums">{v.cantidad}</div>,
    },
    /* La columna del importe se quita entera, no se pinta en blanco: una columna
       vacía se lee como un dato que falta. El monto tampoco llegó del servidor
       (ver `columnasVentaMetricas`). */
    ...(verDinero
      ? ([
          {
            clave: "total",
            label: "Total",
            celda: (v) => (
              <div className="text-[13.5px] font-bold tabular-nums">{formatearMXN(v.monto)}</div>
            ),
          },
        ] satisfies Columna<VentaMetricas>[])
      : []),
    {
      clave: "origen",
      label: "Origen",
      celda: (v) => (
        <div className="text-[12.5px] text-muted-foreground">
          {v.origen === "api" ? "Automática" : v.origen === "csv" ? "CSV" : "Manual"}
        </div>
      ),
    },
  ];

  /* Confirmación previa por el mismo motivo que en Inventario: relee las ventas
     del canal, tarda, y estaba a un clic sin red de seguridad. */
  function importar() {
    ejecutarImportacion(importarVentasTiendanube, {
      confirmar:
        "Importar de Tienda Nube: se vuelven a leer las ventas del canal. Puede tardar unos minutos. ¿Seguir?",
      error: "No se pudo importar. Revisa tu conexión.",
      alExito: (r) => {
        toast.success(r.detalle);
        /* Igual que al guardar una venta: el toast decía «37 ventas nuevas» y la
           pantalla seguía igual, porque las cifras ya no vienen de las props. */
        recargar();
      },
    });
  }

  return (
    <div>
      {/* Barra superior */}
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Métricas del negocio</h1>
          <p className="mt-1.5 max-w-[620px] text-[14.5px] text-muted-foreground">
            Los números clave de un vistazo: qué se vende, por dónde y cuánto deja.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2.5 md:w-auto md:justify-end">
          {tiendanube.conectada && (
            <Button
              variant="outline"
              onClick={importar}
              disabled={importando}
              className="h-10 w-full rounded-xl text-[13.5px] font-semibold md:w-auto"
            >
              <RefreshCw className={cn("size-4", importando && "animate-spin")} aria-hidden="true" />
              {importando ? "Importando…" : "Importar de Tienda Nube"}
            </Button>
          )}
          {/* Un solo control para el periodo: atajos y rango a mano en el mismo
              calendario (antes eran un segmentado + dos date-pickers sueltos). */}
          <RangoFechas
            desde={desde}
            hasta={hasta}
            preset={periodo}
            onPreset={setPeriodo}
            onChange={(d, h) => {
              setDesde(d);
              setHasta(h);
              setPeriodo(""); // rango a mano: deja de haber preset activo
            }}
            className="w-full md:w-[240px]"
          />
          <Select
            value={canal}
            onValueChange={(v) => {
              setCanal((v ?? "todas") as CanalId | "todas");
            }}
          >
            <SelectTrigger className="w-full bg-card md:w-[185px]">
              <SelectValue>
                {(v: string) =>
                  v === "todas" ? "Todas las plataformas" : (obtenerCanal(v)?.nombre ?? "Plataforma")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todas las plataformas</SelectItem>
              {CANALES.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={() => setVentaDialog("nueva")}
            className="h-10 w-full rounded-xl text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_var(--primary)] md:w-auto"
          >
            <Plus className="size-4" strokeWidth={2.4} aria-hidden="true" />
            Registrar venta
          </Button>
        </div>
      </div>

      {/* Antes aquí vivía el aviso de «se alcanzó el tope de renglones»: ya no
          hace falta, porque las sumas las hace la base y no hay tope que
          alcanzar. Lo que sí puede fallar es la consulta misma. */}
      {(errorResumen || errorCarga) && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" strokeWidth={2} />
          <span>
            No se pudieron calcular las cifras del periodo, así que lo de abajo está incompleto.
            Si la migración de métricas aún no se ha aplicado en la base, es eso.
          </span>
        </div>
      )}

      {/* Qué se está midiendo exactamente: con atajos como «Últimos 7 días» el
          rango concreto no se ve, y es justo el dato que hace falta para cuadrar
          contra el panel del canal. */}
      <div
        className={cn(
          "mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-1 px-1 text-[12.5px] text-muted-foreground transition-opacity",
          cargando && "opacity-50",
        )}
      >
        <span className="font-semibold">
          {formatearFecha(rangos.actual.desde)} – {formatearFecha(rangos.actual.hasta)}
        </span>
        <span aria-hidden="true">·</span>
        <span>
          {cargando ? (
            "actualizando…"
          ) : (
            <>
              {numVentas} {numVentas === 1 ? "venta" : "ventas"}
              {verDinero ? <> · {formatearMXN(totalListado)} en producto</> : <> · {piezas} pzas</>}
            </>
          )}
        </span>
      </div>

      {/* Números clave. Sin importes quedan dos tarjetas —las que se cuentan en
          unidades— y la rejilla se ajusta a dos columnas: cuatro huecos con dos
          llenos se leería como que la pantalla se rompió. */}
      <div
        className={cn(
          "mb-4 grid grid-cols-2 gap-3.5",
          verDinero ? "md:grid-cols-4" : "md:grid-cols-2",
        )}
      >
        {verDinero && (
          <StatCard
            etiqueta="Ventas"
            valor={formatearMXN(bruto)}
            delta={deltaPct(bruto, brutoAnterior)}
            deltaEtiqueta={ETIQUETA_DELTA[periodo]}
            /* Solo se desglosa cuando hay algo que desglosar: con extras en cero
               (o en negativo por devoluciones) la frase confundiría más que ayuda. */
            nota={
              extras >= 1
                ? `${formatearMXN(total)} en producto + ${formatearMXN(extras)} de envío y ajustes`
                : "producto, envío y ajustes"
            }
          />
        )}
        <StatCard
          etiqueta="Nº de ventas"
          valor={String(numVentas)}
          delta={deltaPct(numVentas, datos.anterior.kpis.ventas)}
          deltaEtiqueta={ETIQUETA_DELTA[periodo]}
        />
        <StatCard
          etiqueta="Piezas vendidas"
          valor={String(piezas)}
          nota={piezasPorVentaTexto}
          delta={verDinero ? undefined : deltaPct(piezas, datos.anterior.kpis.piezas)}
          deltaEtiqueta={ETIQUETA_DELTA[periodo]}
        />
        {verDinero && (
          <StatCard
            etiqueta="Ticket promedio"
            valor={formatearMXN(ticket)}
            nota="por transacción"
          />
        )}
      </div>

      {/* Ventas por día — 7 barras en móvil (sin astillas), 14 en escritorio */}
      <div className={cn(TARJETA, "mb-4 px-6")}>
        <h2 className={cn(ROTULO, "mb-4")}>
          Ventas por día · últimos <span className="md:hidden">7</span>
          <span className="hidden md:inline">14</span> días
        </h2>
        <div className="md:hidden">
          <GraficaVentasDia dias={dias.slice(-7)} />
        </div>
        <div className="hidden md:block">
          <GraficaVentasDia dias={dias} />
        </div>
        <p className="mt-3 text-[11.5px] text-muted-foreground">
          {verDinero
            ? "Arriba de cada barra, cuánto se vendió ese día; debajo, cuántas ventas fueron."
            : "La altura de cada barra son las ventas de ese día."}
        </p>
      </div>

      {/* Por canal + Top productos */}
      <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className={cn(TARJETA, "px-6")}>
          <h2 className={cn(ROTULO, "mb-4")}>Por canal</h2>
          <ListaBarras
            items={porCanal}
            formatear={verDinero ? formatearMXN : (n) => `${n} pzas`}
            punto
            altoBarra={26}
          />
        </div>
        <div className={cn(TARJETA, "px-6")}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className={ROTULO}>{verDinero ? "Productos estrella" : "Los que más salen"}</h2>
            <div className="flex items-center gap-1.5">
              <Select
                value={catEstrella}
                onValueChange={(v) => {
                  setCatEstrella((v ?? "todas") as TipoProductoId | "todas");
                  setTallaEstrella("todas");
                }}
              >
                <SelectTrigger className="h-8 w-[150px] bg-card text-[12.5px]">
                  <SelectValue>
                    {(v: string) =>
                      v === "todas" ? "Todas las categorías" : (obtenerTipoProducto(v)?.nombre ?? "Categoría")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas las categorías</SelectItem>
                  {TIPOS_PRODUCTO.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {tallasDisponibles.length > 0 && (
                <Select value={tallaEstrella} onValueChange={(v) => setTallaEstrella(v ?? "todas")}>
                  <SelectTrigger className="h-8 w-[110px] bg-card text-[12.5px]">
                    <SelectValue>{(v: string) => (v === "todas" ? "Todas las tallas" : v)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todas">Todas las tallas</SelectItem>
                    {tallasDisponibles.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
          <ListaBarras
            items={topProductos}
            formatear={verDinero ? formatearMXN : (n) => `${n} pzas`}
            anchoEtiqueta={190}
            vacio="Sin ventas con estos filtros en el periodo."
          />
        </div>
      </div>

      {/* Tallas más vendidas (de la categoría elegida arriba) */}
      <div className={cn(TARJETA, "mb-4 px-6")}>
        <h2 className={cn(ROTULO, "mb-4")}>
          Tallas más vendidas
          {catEstrella !== "todas" && (
            <span className="ml-1.5 font-medium normal-case tracking-normal text-muted-foreground">
              · {obtenerTipoProducto(catEstrella)?.nombre}
            </span>
          )}
        </h2>
        <ListaBarras
          items={tallasMasVendidas}
          formatear={(n) => `${n} pzas`}
          anchoEtiqueta={130}
          vacio="Sin ventas con talla identificable en el periodo."
        />
      </div>

      {/* Sin movimiento */}
      <div className={cn(TARJETA, "mb-4 px-6")}>
        <h2 className={cn(ROTULO, "mb-3.5")}>
          Sin movimiento en el periodo ·{" "}
          <span className={sinMovimiento.length > 0 ? "text-red-600" : "text-green-600"}>
            {sinMovimiento.length} {sinMovimiento.length === 1 ? "producto" : "productos"}
          </span>
        </h2>
        {sinMovimiento.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            Todo el catálogo activo tuvo ventas. 🎉
          </p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {sinMovimiento.slice(0, CHIPS_SIN_MOVIMIENTO).map((p) => (
              <span
                key={p.id}
                className="rounded-full border bg-muted/40 px-3 py-1.5 text-[12.5px] text-muted-foreground"
              >
                {p.nombre}
                {p.variante ? ` · ${p.variante}` : ""}
              </span>
            ))}
            {sinMovimiento.length > CHIPS_SIN_MOVIMIENTO && (
              <span className="px-2 text-[12.5px] font-medium text-muted-foreground">
                +{sinMovimiento.length - CHIPS_SIN_MOVIMIENTO} más
              </span>
            )}
          </div>
        )}
      </div>

      {/* Ventas del periodo (clic en el producto para corregir) */}
      {numVentas === 0 ? (
        <div className={cn(TARJETA, "px-6")}>
          <h2 className={cn(ROTULO, "mb-2")}>Ventas</h2>
          <p className="text-sm italic text-muted-foreground">
            {hayVentas
              ? "No hubo ventas con esos filtros. Prueba con otro periodo o plataforma."
              : `Aún no hay ventas registradas. Usa «+ Registrar venta»${tiendanube.conectada ? " o «Importar de Tienda Nube»" : ""}.`}
          </p>
        </div>
      ) : (
        <>
          <TablaSimple
            cols={verDinero ? COLS_VENTAS : COLS_VENTAS_SIN_DINERO}
            titulo={
              <>
                Ventas del periodo · {numVentas} {numVentas === 1 ? "venta" : "ventas"} ·{" "}
                <span className="text-foreground">
                  {verDinero ? formatearMXN(totalListado) : `${piezas} pzas`}
                </span>
              </>
            }
            columnas={columnasVenta}
            datos={listadas}
            filaKey={(v) => v.id}
            onRowClick={(v) => setVentaDialog(v)}
          />
          {listadas.length < numVentas && (
            <div className="mt-3 flex justify-center">
              <Button
                variant="outline"
                onClick={verMas}
                disabled={cargandoMas}
                className="h-10 rounded-xl text-[13.5px] font-semibold"
              >
                {cargandoMas
                  ? "Cargando…"
                  : `Ver más (${numVentas - listadas.length} restantes)`}
              </Button>
            </div>
          )}
        </>
      )}

      {/* Lo que las plataformas saben y no llega a las ventas. Va al final: es
          contexto de lo de arriba, no el titular. */}
      <Plataformas bloquesCanales={bloquesCanales} pagos={actual.pagos} />

      {ventaDialog && (
        <VentaDialog
          venta={ventaDialog === "nueva" ? null : ventaDialog}
          gestor={gestor}
          direccion={rol === "direccion"}
          /* La venta que se abre puede ser de cualquier canal, no del que esté
             filtrado: aquí manda el permiso global, no el del canal en pantalla. */
          verDinero={dinero.ingresos}
          onClose={cerrarDialogoVenta}
        />
      )}
    </div>
  );
}
