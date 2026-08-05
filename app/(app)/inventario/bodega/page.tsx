import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { puedeAdministrar } from "@/lib/catalogos";
import { traerTodo } from "@/lib/canales/paginacion";
import { PanelBodega } from "@/components/bodega/panel";
import type {
  ConjuntoConComponentes,
  EnvioFullConCajas,
  InsumoConPresentaciones,
  InsumoMovimiento,
  InsumoPermiso,
  Product,
  Profile,
  RecepcionBodega,
  RecepcionConItems,
  RecepcionItem,
} from "@/lib/types";

export const metadata = { title: "Bodega · Fresafit" };

/* El cuaderno de bodega: recibir mercancía, armar conjuntos, seguir los
   personalizados, preparar los envíos full y llevar los insumos.

   Es de TODO el equipo interno (los de bodega son rol miembro): la RLS ya lo
   acota y no hay corte de rol aquí. Va en subruta y no como otra pestaña de
   inventario porque se usa en el piso, desde el celular, y no necesita el
   catálogo completo ni los 90 días de ventas que carga /inventario. */
export default async function BodegaPage() {
  const { supabase, user, rol } = await usuarioActual();

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
    enviosRes,
    insumosCrudos,
    movimientosRes,
    permisosRes,
    equipoRes,
    productos,
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
          "id, sku, titulo, categoria, talla, activo, notas, created_by, created_at, updated_at, componentes:conjunto_componentes(id, conjunto_id, producto_id, sku_componente, rol, cantidad)",
        )
        .order("sku")
        .range(desde, hasta),
    ),
    /* Las cajas y sus renglones se pedían sin filtro y sin paginar mientras los
       envíos sí estaban acotados a 50: PostgREST los cortaba en 1000 y en
       pantalla faltaban cajas enteras sin que nadie se enterara. Colgados de su
       envío el problema desaparece, porque lo que se acota es la lista de
       envíos y cada uno se lleva lo suyo. */
    supabase
      .from("envios_full")
      .select(
        "id, destino, nombre, estado, fecha_envio, notas, created_by, created_at, updated_at, cajas:envio_full_cajas(id, envio_id, numero, dimensiones, peso_kg, items:envio_full_items(id, caja_id, producto_id, sku, asin, cantidad, empaquetado, cancelado, descontado))",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    traerTodo<InsumoConPresentaciones>((desde, hasta) =>
      supabase
        .from("insumos")
        .select(
          "id, nombre, unidad, stock, minimo, notas, activo, categoria, empresa, dimensiones, reserva, pedido, maximo, link, clave, created_by, created_at, updated_at, presentaciones:insumo_presentaciones(id, insumo_id, descripcion, unidades, precio, reserva, pedido, link, clave, created_at)",
        )
        .order("nombre")
        .range(desde, hasta),
    ),
    supabase
      .from("insumo_movimientos")
      .select("id, insumo_id, tipo, cantidad, stock_resultante, motivo, created_by, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase.from("insumo_permisos").select("profile_id, puede_descontar, otorgado_por, created_at"),
    supabase.from("profiles").select("id, nombre, rol, area, color").order("nombre"),
    /* Catálogo liviano: solo lo necesario para emparejar SKUs y ver el stock. */
    traerTodo<ProductoLigeroFila>((desde, hasta) =>
      supabase
        .from("products")
        .select("id, nombre, variante, sku, stock, activo")
        .order("nombre")
        .range(desde, hasta),
    ),
  ]);

  /* Los renglones de recepción son los únicos que NO van anidados: una sola
     carga pasa de mil renglones y ahí la paginación explícita es la única forma
     de garantizar que lleguen completos. Lo que sí cambia es que se piden solo
     los de las cargas que se van a pintar —antes venía la tabla entera— y se
     agrupan por carga en una pasada, no recorriéndolos una vez por carga. */
  const idsCargas = (recepcionesRes.data ?? []).map((r) => r.id as string);
  const items = idsCargas.length
    ? await traerTodo<RecepcionItem>((desde, hasta) =>
        supabase
          .from("recepcion_items")
          .select(
            "id, recepcion_id, sku, producto_id, unidades_no_procesadas, sku_consolidado, categoria, producto_nombre, talla, estado, descontado_en, created_at, updated_at",
          )
          .in("recepcion_id", idsCargas)
          .order("created_at")
          .range(desde, hasta),
      )
    : [];

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
      envios={envios}
      insumos={insumos}
      movimientos={(movimientosRes.data ?? []) as InsumoMovimiento[]}
      permisos={permisos}
      equipo={(equipoRes.data ?? []) as Profile[]}
      productos={productos}
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
