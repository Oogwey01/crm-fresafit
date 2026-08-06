import { Suspense } from "react";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { veDineroDeCanal } from "@/lib/permisos-dinero";
import { adjuntarMontos } from "@/lib/supabase/montos";
import { estadoTiendanube } from "@/lib/tiendanube/api";
import { carritosAbandonadosTN, saludML, visitasML } from "@/lib/canales/salud";
import { diasDesdeHoy, hoyISO, rangosDePeriodo } from "@/lib/fecha";
import { COLUMNAS_VENTA_METRICAS, VENTAS_POR_PAGINA } from "@/lib/metricas";
import { PanelMetricas } from "@/components/metricas/panel";
import { BloquesCanales, BloquesCanalesCargando } from "@/components/metricas/plataformas";
import type {
  Product,
  ResumenMetricas,
  RolId,
  VentaMetricas,
} from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Métricas · Fresafit" };

/* Periodo con el que abre el panel. Tiene que coincidir con el estado inicial
   del componente, o la primera pintada mostraría un rango y las cifras de
   otro. */
const PERIODO_INICIAL = "mes" as const;

/* Días de la gráfica de barras. Es una ventana fija: no sigue al periodo
   elegido, pero sí a la plataforma. */
const DIAS_GRAFICA = 14;

/* Ventana de los datos que se piden a los canales en vivo. 30 días es lo que
   Mercado Libre reporta de visitas y basta para leer una tendencia. */
const DIAS_PLATAFORMAS = 30;

/* Lo que hay que preguntarle a Mercado Libre y a Tienda Nube. Son tres llamadas
   a APIs ajenas —y la de visitas de ML tarda de por sí varios segundos—, así que
   iban por delante de todo lo demás: la pantalla no aparecía hasta que las tres
   contestaban, aunque las cifras del negocio (que salen de la base, en
   milisegundos) ya estuvieran listas.

   Metido en su propio <Suspense>, el resto de Métricas se manda de inmediato y
   este trozo aterriza cuando esté. Cada canal que no conteste deja su bloque
   fuera, como antes. */
async function Canales() {
  const dinero = await vistaDinero();
  const [visitas, salud, carritos, mlRes] = await Promise.all([
    visitasML(DIAS_PLATAFORMAS),
    saludML(),
    carritosAbandonadosTN(DIAS_PLATAFORMAS),
    /* Unidades vendidas en Mercado Libre dentro de la MISMA ventana que las
       visitas: comparar 30 días de visitas contra un año de ventas daría una
       conversión inventada. Vive aquí porque solo la usa este bloque. */
    (async () => {
      const { supabase } = await usuarioActual();
      return supabase.rpc("metricas_resumen", {
        desde: diasDesdeHoy(-DIAS_PLATAFORMAS),
        hasta: hoyISO(),
        canal_f: "mercado_libre",
      });
    })(),
  ]);

  return (
    <BloquesCanales
      visitas={visitas}
      salud={salud}
      carritos={carritos}
      ventasML={(mlRes.data as ResumenMetricas | null)?.kpis.piezas ?? 0}
      verDineroTN={veDineroDeCanal(dinero, "tienda_nube")}
    />
  );
}

export default async function MetricasPage() {
  await exigirModulo("metricas");
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const rangos = rangosDePeriodo(PERIODO_INICIAL);
  const ventana = { desde: diasDesdeHoy(-(DIAS_GRAFICA - 1)), hasta: hoyISO() };

  const [
    /* La pantalla abre en «todas las plataformas», así que el importe solo
       viaja para quien ve los ingresos del negocio: el permiso de un solo canal
       no alcanza a la suma. Al cambiar de plataforma, `listarVentas` vuelve a
       preguntarlo con el canal ya elegido. Solo se usa DESPUÉS del Promise.all
       (adjuntarMontos y props), así que viaja junto a las demás. */
    dinero,
    actualRes,
    anteriorRes,
    ventanaRes,
    ventasRes,
    productosRes,
    algunaVentaRes,
    tiendanube,
  ] = await Promise.all([
    vistaDinero(),
    /* Las cifras ya sumadas en la base. Antes de esto la página bajaba 5.000
       renglones de ventas y 20.000 órdenes al navegador para hacer aquí las
       mismas cuentas — y con un tope que dejaba fuera lo más viejo del año. */
    supabase.rpc("metricas_resumen", {
      desde: rangos.actual.desde,
      hasta: rangos.actual.hasta,
      canal_f: null,
    }),
    supabase.rpc("metricas_resumen", {
      desde: rangos.anterior.desde,
      hasta: rangos.anterior.hasta,
      canal_f: null,
    }),
    supabase.rpc("metricas_resumen", {
      desde: ventana.desde,
      hasta: ventana.hasta,
      canal_f: null,
    }),
    /* Primera página de la tabla de ventas: los renglones sueltos siguen
       haciendo falta para revisarlos y corregirlos uno a uno. El resto las pide
       «Ver más» al servidor. */
    supabase
      .from("sales")
      .select(COLUMNAS_VENTA_METRICAS)
      .gte("fecha", rangos.actual.desde)
      .lte("fecha", rangos.actual.hasta)
      .or("estado.is.null,estado.neq.cancelado")
      .order("fecha", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(0, VENTAS_POR_PAGINA - 1),
    /* Catálogo ACTIVO: lo único que sale de aquí es la lista de «productos sin
       movimiento», que ya descarta los inactivos. Los clientes ya no viajan con
       la página: eran ~2.500 filas serializadas en cada carga para alimentar un
       buscador del diálogo de venta, que ahora los pide al abrirse. */
    supabase
      .from("products")
      .select("id, nombre, variante, sku, activo")
      .eq("activo", true)
      .order("nombre"),
    /* ¿Hay alguna venta, en cualquier fecha? Es solo para elegir el mensaje
       cuando el periodo sale vacío: «aún no hay ventas» y «no hay con estos
       filtros» piden respuestas distintas. Una fila basta para saberlo. */
    supabase.from("sales").select("id").limit(1),
    estadoTiendanube(),
  ]);
  const verDinero = dinero.ingresos;

  /* Si el resumen falla —lo más probable, que la migración aún no se haya
     pegado— la página lo dice en vez de pintar ceros como si fueran datos. */
  const errorResumen =
    actualRes.error?.message ?? anteriorRes.error?.message ?? ventanaRes.error?.message ?? null;
  if (errorResumen) {
    console.warn("[metricas] metricas_resumen no disponible:", errorResumen);
  }

  const vacio: ResumenMetricas = {
    dinero: verDinero,
    kpis: { total: verDinero ? 0 : null, piezas: 0, ventas: 0, ticket: verDinero ? 0 : null },
    bruto_por_canal: [],
    unidades_por_canal: [],
    por_producto: [],
    por_dia: [],
    pagos: { pagos: [], cupones: [], aMeses: 0, conDatoDePago: 0 },
    ordenes_periodo: 0,
  };

  const actual = (actualRes.data as ResumenMetricas | null) ?? vacio;

  /* El importe de cada renglón sale de `ventas_montos`, no de la tabla: la
     columna está fuera del alcance del token (ver 20260902000000). */
  const ventasIniciales = await adjuntarMontos(
    supabase,
    (ventasRes.data ?? []) as unknown as VentaMetricas[],
    verDinero,
  );

  return (
    <PanelMetricas
      inicial={{
        actual,
        anterior: (anteriorRes.data as ResumenMetricas | null) ?? vacio,
        dias: ((ventanaRes.data as ResumenMetricas | null) ?? vacio).por_dia,
      }}
      ventasIniciales={ventasIniciales}
      errorResumen={errorResumen}
      hayVentas={(algunaVentaRes.data ?? []).length > 0}
      productos={
        (productosRes.data ?? []) as Pick<
          Product,
          "id" | "nombre" | "variante" | "sku" | "activo"
        >[]
      }
      rol={rol}
      dinero={dinero}
      tiendanube={tiendanube}
      bloquesCanales={
        <Suspense fallback={<BloquesCanalesCargando />}>
          <Canales />
        </Suspense>
      }
    />
  );
}
