import { notFound } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { leerDatosIntegracion } from "@/lib/canales/integraciones";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { adjuntarCostos } from "@/lib/supabase/montos";
import type { VistaDinero } from "@/lib/permisos-dinero";
import { esGestor } from "@/lib/catalogos";
import { diasDesdeHoy } from "@/lib/fecha";
import { claveFamilia, nombreBase } from "@/lib/inventario/familia";
import { ESCRITURA_CANALES } from "@/lib/inventario/escritura-canales";
import {
  calcularReabastecimiento,
  paramsReordenDesdeEnv,
  type EnCamino,
  type VentaReorden,
} from "@/lib/inventario/reabastecimiento";
import { compararTallas, tallaDeVariante } from "@/lib/talla";
import { FichaProductoPagina } from "@/components/inventario/ficha-producto-pagina";
import type { FotoDeFicha, ProductConProveedor, RolId, Supplier } from "@/lib/types";

export const metadata = { title: "Producto · Fresafit" };

/* Misma ventana con la que abre «Qué pedir», para que la ficha y la tabla
   cuenten lo mismo. */
const VENTANA_REORDEN = 30;

/* Columnas de la ficha: todas menos `imagenes`, que es la galería importada de
   los canales (~950 KB sobre el catálogo entero) y que la vista pide aparte al
   montarse. */
/* El costo es egreso y el precio ingreso: ninguno viaja para quien no puede
   verlos, porque con los dos al lado el margen del SKU es una resta. El costo
   ni se pide a la tabla —está fuera del alcance del token— y se une después
   desde `producto_costos`. */
function columnasFicha(dinero: VistaDinero): string {
  return (
    "id, nombre, variante, sku, tipo, stock, stock_minimo," +
    " proveedor_id, activo, bajo_pedido, descontinuado, notas, imagen_url," +
    " meli_item_id, meli_variation_id, meli_logistic_type, meli_stock_full, meli_permalink," +
    " meli_user_product_id, tiendanube_product_id, tiendanube_variant_id, tiendanube_permalink," +
    " tiktok_product_id, tiktok_sku_id, tiktok_stock, created_at, created_by, updated_at," +
    " proveedor:suppliers!proveedor_id(id, nombre, dias_entrega)" +
    (dinero.ingresos ? ", precio" : "")
  );
}

/* Página propia de un producto. Antes era un pop-up del catálogo, y con él la
   ficha heredaba dos problemas: en el teléfono no cabía, y para llegar había que
   cargar el inventario completo aunque vinieras de un enlace.

   Aquí se pide SOLO lo de este producto: la ficha, sus tallas hermanas, los
   renglones que comparten su SKU (el reorden agrupa por SKU, no por talla) y las
   ventas de ese puñado de ids. Nada de bajar el catálogo entero. */
export default async function ProductoPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, rol: rolCrudo } = await usuarioActual();
  const rol = (rolCrudo ?? "miembro") as RolId;
  const dinero = await vistaDinero();
  const COLUMNAS = columnasFicha(dinero);
  const { id } = await params;

  const { data: base, error } = await supabase
    .from("products")
    .select(COLUMNAS)
    .eq("id", id)
    .maybeSingle();
  /* Que la consulta falle NO es que la ficha no exista: traducir las dos cosas a
     404 manda a buscar un producto borrado cuando lo que pasó fue que el select
     ni corrió —una columna que la migración todavía no creó, por ejemplo—. */
  if (error) throw new Error(error.message);
  const producto = base as unknown as ProductConProveedor | null;
  if (!producto) notFound();

  /* Las hermanas se buscan por PREFIJO del nombre: `nombreBase` recorta la cola
     de talla («Cinturón Akatsuki - M» → «Cinturón Akatsuki»), así que todas las
     variantes del producto empiezan por ahí. Lo que traiga de más lo descarta
     `claveFamilia`, que es el criterio de verdad. */
  const prefijo = nombreBase(producto.nombre);
  const sku = producto.sku?.trim();

  const [familiaRes, fotosRes, mismoSkuRes, proveedoresRes, datosTN] = await Promise.all([
    supabase.from("products").select(COLUMNAS).ilike("nombre", `${prefijo}%`).limit(60),
    supabase
      .from("product_photos")
      .select("id, producto_id, storage_path, orden")
      .eq("producto_id", producto.id)
      .order("orden"),
    /* Renglones que comparten SKU: la misma talla publicada en varios canales.
       Sin SKU el grupo es la ficha sola. */
    sku
      ? supabase.from("products").select(COLUMNAS).eq("sku", sku).limit(30)
      : Promise.resolve({ data: null }),
    supabase.from("suppliers").select("*").order("nombre"),
    /* El admin de Tienda Nube vive en el subdominio de cada tienda: el enlace
       «Ver en Tienda Nube» necesita ese dato. Lo deja la sync en
       `integraciones.datos`; si aún no ha corrido, el enlace no aparece. */
    leerDatosIntegracion("tiendanube").catch(() => ({}) as Record<string, unknown>),
  ]);

  const fotos = (fotosRes.data ?? []) as FotoDeFicha[];
  /* El costo se une aquí, desde `producto_costos`. Solo el de ESTA ficha: es la
     única que lo pinta. */
  const [conCosto] = await adjuntarCostos(supabase, [producto], dinero.egresos);
  const conFotos: ProductConProveedor = { ...conCosto, fotos_propias: fotos };

  const clave = claveFamilia(producto);
  const hermanas = ((familiaRes.data ?? []) as unknown as ProductConProveedor[])
    .filter((p) => claveFamilia(p) === clave)
    /* La ficha abierta es la que trae las fotos ya cargadas. */
    .map((p) => (p.id === producto.id ? conFotos : p))
    .sort((a, b) => {
      const ta = tallaDeVariante(a.variante);
      const tb = tallaDeVariante(b.variante);
      if (ta && tb) return compararTallas(ta, tb);
      return (a.variante ?? "").localeCompare(b.variante ?? "", "es", { numeric: true });
    });

  const delGrupo = ((mismoSkuRes.data ?? [conFotos]) as unknown as ProductConProveedor[]);
  const idsGrupo = delGrupo.map((p) => p.id);

  /* Ventas y unidades en camino SOLO de esos ids: las dos son funciones que
     devuelven una tabla, así que PostgREST deja filtrarlas en la base en vez de
     traer el histórico completo para tirarlo aquí. */
  const [ventasRes, enCaminoRes] = await Promise.all([
    supabase
      .rpc("ventas_reorden", { desde: diasDesdeHoy(-VENTANA_REORDEN) })
      .in("producto_id", idsGrupo),
    supabase.rpc("unidades_en_camino").in("producto_id", idsGrupo),
  ]);

  const enCamino: EnCamino = {};
  for (const f of (enCaminoRes.data ?? []) as { producto_id: string; unidades: number }[]) {
    enCamino[f.producto_id] = Number(f.unidades);
  }

  const grupos = calcularReabastecimiento({
    productos: delGrupo,
    ventas: (ventasRes.data ?? []) as unknown as VentaReorden[],
    enCamino,
    ventanaDias: VENTANA_REORDEN,
    params: paramsReordenDesdeEnv(),
  });
  /* null cuando el producto queda fuera del cálculo (inactivo, bajo pedido o
     descontinuado); la vista lo explica en vez de fingir cifras. */
  const grupo = grupos.find((g) => g.productoIds.includes(producto.id)) ?? null;

  return (
    <FichaProductoPagina
      producto={conFotos}
      hermanas={hermanas}
      grupo={grupo}
      ventanaDias={VENTANA_REORDEN}
      proveedores={(proveedoresRes.data ?? []) as Supplier[]}
      gestor={esGestor(rol)}
      dinero={dinero}
      escrituraCanales={ESCRITURA_CANALES}
      dominioTiendaNube={
        typeof datosTN.dominio_admin === "string" ? datosTN.dominio_admin : null
      }
    />
  );
}
