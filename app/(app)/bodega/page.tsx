import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { equipoCompleto } from "@/lib/supabase/consultas";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { puedeAdministrar } from "@/lib/catalogos";
import { traerTodo } from "@/lib/canales/paginacion";
import type { CanalVenta } from "@/lib/canales/tipos";
import { PanelBodega } from "@/components/bodega/panel";
import type {
  ConjuntoArmado,
  ConjuntoConComponentes,
  EnvioFullConCajas,
  InsumoConPresentaciones,
  InsumoMovimiento,
  InsumoPermiso,
  Product,
  ConteoConProducto,
  RecepcionBodega,
  RecepcionConItems,
  RecepcionItem,
} from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Bodega · Fresafit" };

const COLUMNAS_ARMADO =
  "id, conjunto_id, sku_conjunto, producto_id, tipo, cantidad, lote, detalle, nota," +
  " revierte_a, subido_en, subido_por, created_by, created_at";

/* El cuaderno de bodega: recibir mercancía, armar conjuntos, seguir los
   personalizados, preparar los envíos full y llevar los insumos.

   Es de TODO el equipo interno (los de bodega son rol miembro): la RLS ya lo
   acota y no hay corte de rol aquí. Es módulo propio y no una pestaña de
   inventario —antes colgaba de /inventario/bodega— porque se usa en el piso,
   desde el celular, y no necesita el catálogo completo ni los 90 días de ventas
   que carga /inventario. */
export default async function BodegaPage() {
  await exigirModulo("bodega");
  const { supabase, user, rol } = await usuarioActual();

  /* El precio de cada presentación es lo que CUESTA comprarla: egreso, así que
     solo viaja para quien lleva la administración. Lo demás de bodega —qué hay,
     cuánto queda, qué falta— es de todo el equipo.

     La promesa se lanza aquí SIN await: solo la consulta de insumos depende de
     ella (para decidir si pide `precio`), así que encadena adentro del
     Promise.all en vez de frenar a las otras nueve en serie. */
  const dineroP = vistaDinero();
  const columnasInsumo = (egresos: boolean): string =>
    "id, nombre, unidad, stock, minimo, notas, activo, categoria, empresa," +
    " dimensiones, reserva, pedido, maximo, link, clave, created_by, created_at, updated_at," +
    " presentaciones:insumo_presentaciones(id, insumo_id, descripcion, unidades," +
    ` reserva, pedido, link, clave, created_at${egresos ? ", precio" : ""})`;

  /* Cada árbol (conjunto → componentes, envío → cajas → renglones, insumo →
     presentaciones) se pide ya anidado: PostgREST lo arma en la misma consulta.
     Antes se traían las tablas hijas COMPLETAS —las de todos los envíos y todas
     las cargas de la historia— para unirlas aquí con un filter por padre, que
     además de pasear renglones que nadie iba a ver recorría la lista entera una
     vez por cada padre.

     El catálogo de productos entra en esta misma tanda; colgaba después, en
     serie, aunque no dependa de nada de lo anterior. */
  const [
    recepcionesRes,
    conjuntos,
    armadosRes,
    pendientesRes,
    enviosRes,
    insumosCrudos,
    movimientosRes,
    permisosRes,
    equipo,
    productos,
    conteosRes,
  ] = await Promise.all([
    supabase
      .from("recepciones_bodega")
      .select("id, titulo, canal, estado, pedido_proveedor_id, notas, created_by, created_at, cerrada_en")
      .order("created_at", { ascending: false })
      .limit(50),
    /* El catálogo de conjuntos no tiene tope, y PostgREST corta en 1000 sin
       avisar: por eso se pagina. Sus componentes son tres por conjunto, así que
       anidados no hay forma de que estorben. */
    traerTodo<ConjuntoConComponentes>((desde, hasta) =>
      supabase
        .from("conjuntos")
        .select(
          "id, sku, titulo, categoria, talla, producto_id, activo, notas, created_by, created_at, updated_at, componentes:conjunto_componentes(id, conjunto_id, producto_id, sku_componente, rol, cantidad)",
        )
        .order("sku")
        .range(desde, hasta),
    ),
    /* Lo que se armó en bodega. Acotado como los demás historiales del módulo:
       la pantalla enseña los últimos por conjunto, no la historia entera. */
    supabase
      .from("conjunto_armados")
      .select(COLUMNAS_ARMADO)
      .order("created_at", { ascending: false })
      .limit(200),
    /* Y aparte, TODO lo que sigue pendiente de capturar en los canales, sin
       tope: un armado de hace meses que nadie subió tiene que seguir dando la
       lata aunque ya no quepa en los últimos 200. */
    supabase
      .from("conjunto_armados")
      .select(COLUMNAS_ARMADO)
      .is("subido_en", null)
      .order("created_at", { ascending: false }),
    /* Las cajas y sus renglones se pedían sin filtro y sin paginar mientras los
       envíos sí estaban acotados a 50: PostgREST los cortaba en 1000 y en
       pantalla faltaban cajas enteras sin que nadie se enterara. Colgados de su
       envío el problema desaparece, porque lo que se acota es la lista de
       envíos y cada uno se lleva lo suyo. */
    supabase
      .from("envios_full")
      .select(
        "id, destino, nombre, estado, fecha_envio, id_plataforma, paqueteria, tipo_envio, num_guia, fecha_llegada_estimada, notas, created_by, created_at, updated_at, cajas:envio_full_cajas(id, envio_id, numero, largo_cm, ancho_cm, alto_cm, peso_kg, nota, items:envio_full_items(id, caja_id, producto_id, sku, asin, cantidad, empaquetado, cancelado, descontado))",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    dineroP.then((dinero) =>
      traerTodo<InsumoConPresentaciones>((desde, hasta) =>
        supabase
          .from("insumos")
          .select(columnasInsumo(dinero.egresos))
          .order("nombre")
          .range(desde, hasta),
      ),
    ),
    supabase
      .from("insumo_movimientos")
      .select("id, insumo_id, tipo, cantidad, stock_resultante, motivo, created_by, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("insumo_permisos").select("profile_id, puede_descontar, otorgado_por, created_at"),
    equipoCompleto(),
    /* Catálogo liviano: solo lo necesario para emparejar SKUs y ver el stock. */
    traerTodo<ProductoLigeroFila>((desde, hasta) =>
      supabase
        .from("products")
        .select("id, nombre, variante, sku, stock, activo")
        .order("nombre")
        .range(desde, hasta),
    ),
    /* Conteos físicos recientes, con el producto para comparar lo contado contra
       lo que dice el CRM. El desempate por `id` no es adorno: la fecha es un DÍA
       y se repite en cuanto se cuentan varias cosas la misma jornada, así que sin
       él el orden entre esas filas queda al azar de la base y el tope de 200
       podría partir el grupo de forma distinta en cada carga. */
    supabase
      .from("conteos_fisicos")
      .select(
        "id, producto_id, descripcion, cantidad, contado_por, corroborado_por, nota, fecha, created_by, created_at, producto:products!producto_id(id, nombre, variante, sku, stock)",
      )
      .order("fecha", { ascending: false })
      .order("id")
      .limit(200),
  ]);

  /* Los renglones de recepción son los únicos que NO van anidados: una sola
     carga pasa de mil renglones y ahí la paginación explícita es la única forma
     de garantizar que lleguen completos. Lo que sí cambia es que se piden solo
     los de las cargas que se van a pintar —antes venía la tabla entera— y se
     agrupan por carga en una pasada, no recorriéndolos una vez por carga. */
  const idsCargas = (recepcionesRes.data ?? []).map((r) => r.id as string);
  /* En qué canales está publicada la ficha de cada conjunto. Va aparte y no
     como tres columnas más del catálogo ligero: son a lo sumo 84 fichas contra
     las 1126 del catálogo, y ese payload lo carga toda la pantalla de bodega. */
  const idsFicha = [...new Set(conjuntos.map((c) => c.producto_id).filter((id): id is string => !!id))];

  /* Renglones y canales dependen de resultados DISTINTOS del Promise.all de
     arriba, no el uno del otro: juntos en un solo viaje de pared. */
  const [items, canalesRes] = await Promise.all([
    idsCargas.length
      ? traerTodo<RecepcionItem>((desde, hasta) =>
          supabase
            .from("recepcion_items")
            .select(
              "id, recepcion_id, sku, producto_id, unidades_no_procesadas, sku_consolidado, categoria, producto_nombre, talla, esperado, nota, estado, descontado_en, created_at, updated_at",
            )
            .in("recepcion_id", idsCargas)
            .order("created_at")
            .range(desde, hasta),
        )
      : Promise.resolve([] as RecepcionItem[]),
    idsFicha.length
      ? supabase
          .from("products")
          .select("id, tiendanube_product_id, meli_item_id, tiktok_product_id")
          .in("id", idsFicha)
      : Promise.resolve({ data: [] as { id: string; tiendanube_product_id: unknown; meli_item_id: unknown; tiktok_product_id: unknown }[] }),
  ]);

  /* Los últimos 200 más los pendientes de siempre, sin repetir: las dos listas
     se solapan en cuanto hay pendientes recientes. */
  const armados: ConjuntoArmado[] = [
    ...new Map(
      [
        ...((armadosRes.data ?? []) as unknown as ConjuntoArmado[]),
        ...((pendientesRes.data ?? []) as unknown as ConjuntoArmado[]),
      ].map((a) => [a.id, a]),
    ).values(),
  ];
  const canalesFicha: CanalesFicha = Object.fromEntries(
    (canalesRes.data ?? []).map((p) => [
      p.id as string,
      {
        tienda_nube: !!p.tiendanube_product_id,
        mercado_libre: !!p.meli_item_id,
        tiktok_shop: !!p.tiktok_product_id,
      },
    ]),
  );

  const porCarga = new Map<string, RecepcionItem[]>();
  for (const i of items) {
    const lista = porCarga.get(i.recepcion_id);
    if (lista) lista.push(i);
    else porCarga.set(i.recepcion_id, [i]);
  }

  const recepciones: RecepcionConItems[] = (recepcionesRes.data ?? []).map((r) => ({
    ...(r as RecepcionBodega),
    items: porCarga.get(r.id as string) ?? [],
  }));

  /* Lo anidado llega en el orden que le acomode a la base, y estas dos listas sí
     se leen ordenadas: las cajas por su número, que es como van rotuladas en el
     piso, y las presentaciones de la más chica a la más grande, que es como se
     cotizan. Son puñados por padre, así que ordenarlas aquí no cuesta nada. */
  const envios: EnvioFullConCajas[] = (enviosRes.data ?? []).map((e) => {
    const envio = e as EnvioFullConCajas;
    return { ...envio, cajas: [...envio.cajas].sort((a, b) => a.numero - b.numero) };
  });

  const insumos: InsumoConPresentaciones[] = insumosCrudos.map((i) => ({
    ...i,
    presentaciones: [...i.presentaciones].sort((a, b) => a.unidades - b.unidades),
  }));

  const permisos = (permisosRes.data ?? []) as InsumoPermiso[];
  /* Dirección y administración pueden siempre; el resto solo si se le habilitó.
     El botón deshabilitado es cortesía: el candado real es la RPC mover_insumo. */
  const puedeMoverInsumos =
    puedeAdministrar(rol) ||
    permisos.some((p) => p.profile_id === user?.id && p.puede_descontar);

  return (
    <PanelBodega
      recepciones={recepciones}
      conjuntos={conjuntos}
      armados={armados}
      canalesFicha={canalesFicha}
      envios={envios}
      insumos={insumos}
      movimientos={(movimientosRes.data ?? []) as InsumoMovimiento[]}
      permisos={permisos}
      equipo={equipo}
      productos={productos}
      conteos={(conteosRes.data ?? []) as unknown as ConteoConProducto[]}
      puedeMoverInsumos={puedeMoverInsumos}
      admin={puedeAdministrar(rol)}
    />
  );
}

/* Forma cruda de la consulta del catálogo. */
export type ProductoLigeroFila = Pick<
  Product,
  "id" | "nombre" | "variante" | "sku" | "stock" | "activo"
>;

/* Dónde está publicada la ficha de cada conjunto, por id de producto. Sirve
   para decir en qué tiendas hay que capturar a mano lo que se armó. */
export type CanalesFicha = Record<string, Record<CanalVenta, boolean>>;
