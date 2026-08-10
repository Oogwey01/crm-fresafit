import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { traerTodo } from "@/lib/canales/paginacion";
import { esDireccion, esMaquilero, puedeAdministrar } from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import {
  COLUMNAS_PEDIDO_MAQUILA,
  cargarCalendarioMaquila,
  cargarAnticiposMaquila,
  cargarConsignacionMaquila,
  cargarCortesMaquila,
  cargarCostosDePedidos,
  cargarDisenosMaquila,
  cargarGuiasMaquila,
  cargarMovsConsignacion,
  listarCostosMaquila,
} from "@/lib/maquila/consultas";
import { PanelMaquila } from "@/components/maquila/panel";
import { VistaMaquilero } from "@/components/maquila/vista-maquilero";
import type { ProductoElegible } from "@/components/compartido/selector-producto";
import type { MaquilaProductoConFicha, PedidoMaquila } from "@/lib/types";

export const metadata = { title: "Maquila México · Fresafit" };

/* Producción bajo pedido con Eduardo. UNA ruta con dos caras: el maquilero ve
   su tablero (la RLS ya le quitó lo no pagado y todo dinero de venta); el
   equipo ve además la bandeja de espera, las fichas y la configuración.

   `hoyISO()` se toma UNA vez aquí y baja por props (patrón instanteDeCorte):
   dos pedidos con la misma promesa deben clasificar igual en todo el render. */
export default async function MaquilaPage() {
  await exigirModulo("maquila");
  const { supabase, rol, perfil } = await usuarioActual();
  const hoy = hoyISO();

  /* Orden por urgencia con desempate único (las fechas se repiten); lo sin
     fecha (esperando pago) al final. Paginado: PostgREST corta en 1000. */
  const [pedidos, guias] = await Promise.all([
    traerTodo<PedidoMaquila>((desde, hasta) =>
      supabase
        .from("maquila_pedidos")
        .select(COLUMNAS_PEDIDO_MAQUILA)
        .order("fecha_prometida", { ascending: true, nullsFirst: false })
        .order("id", { ascending: true })
        .range(desde, hasta),
    ),
    cargarGuiasMaquila(supabase),
  ]);

  /* La consignación se calcula CON los pedidos ya cargados: el "comprometido"
     sale de lo que sigue vivo y aún no ha salido. */
  const insumos = await cargarConsignacionMaquila(supabase, pedidos);

  if (esMaquilero(rol)) {
    return (
      <VistaMaquilero
        pedidos={pedidos}
        guias={guias}
        insumos={insumos}
        hoy={hoy}
        nombre={perfil?.nombre ?? "Eduardo"}
      />
    );
  }

  /* El dinero de maquila es confidencial: tarifas y costo por pieza solo para
     dirección y administración. Sin el permiso NO se hace el viaje —la RLS
     devolvería vacío igual, pero así el dato ni sale de la base. */
  const dinero = await vistaDinero();

  /* Lo demás es del equipo: fichas de maquila (con su producto para listar y
     buscar), catálogo elegible para marcar fichas nuevas, y la configuración. */
  const [
    fichas,
    productos,
    calendario,
    costos,
    movimientos,
    costosPedido,
    cortes,
    anticipos,
    disenos,
  ] = await Promise.all([
      traerTodo<MaquilaProductoConFicha>((desde, hasta) =>
        supabase
          .from("maquila_productos")
          .select(
            "producto_id, modelo, acabado, combo, activo, created_by, created_at, updated_at," +
              " producto:products!producto_id(id, nombre, variante, sku)",
          )
          .order("created_at", { ascending: false })
          .order("producto_id")
          .range(desde, hasta),
      ),
      traerTodo<ProductoElegible>((desde, hasta) =>
        supabase
          .from("products")
          .select("id, nombre, variante, sku, stock, activo")
          .eq("activo", true)
          .order("nombre")
          .order("id")
          .range(desde, hasta),
      ),
      cargarCalendarioMaquila(supabase),
      /* Todo lo que sigue es dinero: sin el permiso no se hace el viaje. */
      dinero.egresos ? listarCostosMaquila(supabase) : Promise.resolve([]),
      cargarMovsConsignacion(supabase),
      dinero.egresos
        ? cargarCostosDePedidos(
            supabase,
            pedidos.map((p) => p.id),
          )
        : Promise.resolve(new Map<string, number>()),
      dinero.egresos ? cargarCortesMaquila(supabase) : Promise.resolve([]),
      dinero.egresos ? cargarAnticiposMaquila(supabase) : Promise.resolve([]),
      cargarDisenosMaquila(supabase),
    ]);

  return (
    <PanelMaquila
      pedidos={pedidos}
      guias={guias}
      insumos={insumos}
      movimientos={movimientos}
      disenos={disenos}
      fichas={fichas}
      productos={productos}
      config={calendario.config}
      festivos={calendario.festivos}
      costos={costos}
      costosPorPedido={Object.fromEntries(costosPedido)}
      cortes={cortes}
      anticipos={anticipos}
      hoy={hoy}
      esAdmin={puedeAdministrar(rol)}
      esDireccion={esDireccion(rol)}
      veDinero={dinero.egresos}
    />
  );
}
