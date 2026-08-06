import { Suspense } from "react";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import type { VistaDinero } from "@/lib/permisos-dinero";
import { esGestor } from "@/lib/catalogos";
import { traerTodo } from "@/lib/canales/paginacion";
import { PanelClientes } from "@/components/clientes/panel";
import { PanelInfluencers } from "@/components/influencers/panel";
import type { ProductoLigero } from "@/lib/influencers/tipos";
import type {
  Customer,
  CustomerConStats,
  Influencer,
  InfluencerEntrega,
  InfluencerEvaluacion,
  RolId,
} from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Clientes · Fresafit" };

/* Fila de la RPC stats_por_cliente() (agregado en la base; mismo criterio que
   el cálculo en JS que sustituye: ventas con cliente y no canceladas). */
type StatCliente = { cliente_id: string; compras: number; total: number | null; ultima: string | null };

export default async function ClientesPage() {
  await exigirModulo("clientes");
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;

  const [dinero, clientes, statsRes] = await Promise.all([
    /* Solo decide qué columnas se pintan, no qué se consulta: viaja junto a
       las demás en vez de frenarlas en serie. */
    vistaDinero(),
    /* Paginado: sin esto PostgREST cortaba en 1000 filas SIN avisar y la
       pantalla mostraba 1000 de 2539 clientes, con los totales calculados
       solo sobre esa parte. Se piden además las 10 columnas que usa el módulo,
       no las 12 de la tabla.

       Iba envuelto en `conColumnasOpcionales` porque ciudad/estado/cp eran de
       una migración recién escrita (20260807000000_direccion_envio.sql) que
       podía faltar. Ya está aplicada desde hace tiempo —es anterior a las de
       Bodega e Influencers, que llevan semanas corriendo en producción—, así
       que se piden directo: el andamiaje repetía la consulta entera al fallar y
       aquí eso significaba repetir CADA tanda de la paginación.

       El orden lleva `id` de desempate porque paginar por rangos necesita un
       criterio único y hay clientes homónimos. */
    traerTodo<Customer>((desde, hasta) =>
      supabase
        .from("customers")
        .select(
          "id, nombre, correo, telefono, canal, notas, ciudad, estado, cp," +
            " tiendanube_customer_id, mercadolibre_buyer_id, tiktok_buyer_id",
        )
        .order("nombre")
        .order("id")
        .range(desde, hasta),
    ),
    /* Estadísticas por cliente calculadas en Postgres: antes se bajaban hasta
       10.000 ventas con join solo para sumarlas aquí (y se serializaban
       íntegras al navegador; el historial ahora se carga al abrir la ficha). */
    supabase.rpc("stats_por_cliente"),
  ]);

  const stats = new Map(
    ((statsRes.data ?? []) as StatCliente[]).map((s) => [s.cliente_id, s]),
  );

  /* El programa de influencers es la otra mitad de este módulo: gente que trae
     ventas. Solo lo ven gestores (maneja comisiones y crédito en producto), así
     que para el resto del equipo ni siquiera se piden las tablas —la RLS lo
     impide igual, pero cuatro consultas que van a volver vacías son cuatro
     viajes de más—.

     Va en su propio <Suspense> y no en el `await` de arriba: son cuatro tablas
     que solo se miran al cambiar de pestaña, y esperarlas dejaba en blanco la
     lista de clientes, que es a lo que se entra. */
  const gestor = esGestor(rol);

  const conStats: CustomerConStats[] = clientes.map((c) => {
    const s = stats.get(c.id);
    return {
      ...c,
      compras: s?.compras ?? 0,
      /* Null —no cero— cuando no se puede ver: la RPC ya decide por su cuenta y
         un cero se leería como un cliente que nunca ha comprado. */
      total: s?.total == null ? null : Number(s.total),
      ultimaCompra: s?.ultima ?? null,
      recurrente: (s?.compras ?? 0) >= 2,
    };
  });

  return (
    <PanelClientes
      clientes={conStats}
      rol={rol}
      dinero={dinero}
      programa={
        gestor ? (
          <Suspense fallback={<p className="text-sm italic text-muted-foreground">Cargando el programa…</p>}>
            <Influencers />
          </Suspense>
        ) : null
      }
    />
  );
}

/* Las cuatro tablas del programa, ya pintadas. */
async function Influencers() {
  const { supabase } = await usuarioActual();
  const dinero = await vistaDinero();
  const programa = await traerPrograma(supabase, dinero);
  return (
    <PanelInfluencers
      influencers={programa.influencers}
      entregas={programa.entregas}
      evaluaciones={programa.evaluaciones}
      productos={programa.productos}
      dinero={dinero}
      embebido
    />
  );
}

/* Las tres tablas del programa de influencers más el catálogo liviano que usa
   el diálogo de material entregado. */
export type ProgramaInfluencers = {
  influencers: Influencer[];
  entregas: InfluencerEntrega[];
  evaluaciones: InfluencerEvaluacion[];
  productos: ProductoLigero[];
};

type ClienteSupabase = Awaited<ReturnType<typeof usuarioActual>>["supabase"];

async function traerPrograma(
  supabase: ClienteSupabase,
  dinero: VistaDinero,
): Promise<ProgramaInfluencers> {
  /* Los PORCENTAJES del trato (descuento, comisión) se quedan: son las
     condiciones que el coordinador negocia y sin ellas no puede trabajar. Lo que
     se va son los pesos —el crédito al mes, el valor de lo entregado y lo que
     vendió su código—, que son dinero del negocio. */
  const columnasInfluencer: string =
    "id, nombre, correo, celular, ig_usuario, ig_seguidores, tiktok_usuario," +
    " tiktok_seguidores, tipo_contenido, etapa, tier, codigo, descuento_pct," +
    " comision_pct, inicio_prueba, notas, created_by, created_at, updated_at" +
    (dinero.egresos ? ", credito_mensual" : "");
  const columnasEntrega: string =
    "id, influencer_id, fecha, producto_id, descripcion, talla, cantidad, notas," +
    " created_by, created_at" +
    (dinero.egresos ? ", valor" : "");
  const columnasEvaluacion: string =
    "id, influencer_id, periodo, usos_codigo, videos, stories, participaciones," +
    " contenido_organico, observaciones, created_by, created_at" +
    (dinero.ingresos ? ", ventas_monto" : "");

  const [influencersRes, entregasRes, evaluacionesRes, productosRes] = await Promise.all([
    supabase
      .from("influencers")
      .select(columnasInfluencer)
      .order("nombre"),
    supabase
      .from("influencer_entregas")
      .select(columnasEntrega)
      .order("fecha", { ascending: false })
      .limit(500),
    supabase
      .from("influencer_evaluaciones")
      .select(columnasEvaluacion)
      .order("periodo", { ascending: false })
      .limit(500),
    /* Catálogo liviano solo para elegir qué se entregó (nombre + SKU). */
    supabase
      .from("products")
      .select(`id, nombre, variante, sku${dinero.ingresos ? ", precio" : ""}`)
      .eq("activo", true)
      .order("nombre")
      .limit(1000),
  ]);

  return {
    influencers: (influencersRes.data ?? []) as unknown as Influencer[],
    entregas: (entregasRes.data ?? []) as unknown as InfluencerEntrega[],
    evaluaciones: (evaluacionesRes.data ?? []) as unknown as InfluencerEvaluacion[],
    productos: (productosRes.data ?? []) as unknown as ProductoLigero[],
  };
}
