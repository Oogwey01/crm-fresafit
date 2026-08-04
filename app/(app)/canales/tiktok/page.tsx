import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { traerTodo } from "@/lib/canales/paginacion";
import { estadoTiktok } from "@/lib/tiktok/api";
import { finanzasTikTok } from "@/lib/tiktok/finanzas";
import { saludCatalogoTikTok, type FichaCanal } from "@/lib/tiktok/salud-catalogo";
import { PanelTikTok, type PesoCanal } from "@/components/canales/panel-tiktok";
import { diasDesdeHoy } from "@/lib/fecha";

export const metadata = { title: "TikTok Shop · Fresafit" };

/* Ventana del peso del canal. 60 días aguantan la estacionalidad de una tienda
   que vende por contenido, donde una semana buena distorsiona el mes. */
const DIAS = 60;

type VentaCanal = { canal: string; cantidad: number; monto: number };

export default async function TikTokPage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase } = await usuarioActual();

  const [fichas, ventas, estado, finanzas] = await Promise.all([
    /* El catálogo COMPLETO, no solo lo de TikTok: el cruce es por SKU y hacen
       falta las fichas del otro lado para encontrar las partidas y comparar
       precios.

       Paginado, porque el catálogo pasa de 1 000 y PostgREST corta ahí sin
       avisar: leer solo la primera página escondería justo las fichas que no
       entran, que es el error que esta pantalla existe para detectar. */
    traerTodo<FichaCanal>((desde, hasta) =>
      supabase
        .from("products")
        .select(
          "id, nombre, variante, sku, precio, stock, tiktok_stock, tiktok_product_id, tiendanube_product_id, meli_item_id, activo",
        )
        .order("nombre")
        .range(desde, hasta),
    ).catch((e: Error) => {
      console.warn("[canales/tiktok] catálogo no disponible:", e.message);
      return [] as FichaCanal[];
    }),
    /* Todos los canales, no solo TikTok: la participación necesita el total. */
    traerTodo<VentaCanal>((desde, hasta) =>
      supabase
        .from("sales")
        .select("canal, cantidad, monto")
        .gte("fecha", diasDesdeHoy(-DIAS))
        .or("estado.is.null,estado.neq.cancelado")
        .range(desde, hasta),
    ).catch((e: Error) => {
      console.warn("[canales/tiktok] ventas no disponibles:", e.message);
      return [] as VentaCanal[];
    }),
    estadoTiktok(),
    /* Lo que la plataforma cobra. Cacheado 15 min y tolerante a fallo: si TikTok
       no contesta, la página se pinta sin ese bloque. */
    finanzasTikTok(DIAS),
  ]);

  let monto = 0;
  let piezas = 0;
  let renglones = 0;
  let total = 0;
  for (const v of ventas) {
    const m = Number(v.monto || 0);
    total += m;
    if (v.canal !== "tiktok_shop") continue;
    monto += m;
    piezas += v.cantidad || 0;
    renglones++;
  }

  const peso: PesoCanal = {
    monto,
    piezas,
    renglones,
    participacion: total > 0 ? (monto / total) * 100 : 0,
    dias: DIAS,
  };

  return (
    <PanelTikTok
      conectada={estado.conectada}
      ultimaSync={estado.ultimaSync}
      salud={saludCatalogoTikTok(fichas)}
      peso={peso}
      finanzas={finanzas}
    />
  );
}
