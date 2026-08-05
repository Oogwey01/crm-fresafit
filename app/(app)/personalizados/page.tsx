import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { traerTodo } from "@/lib/canales/paginacion";
import { urlesFirmadas } from "@/lib/storage";
import { PanelPersonalizados } from "@/components/personalizados/panel";
import type { Personalizado } from "@/lib/types";

export const metadata = { title: "Personalizados · Fresafit" };

/* Los cinturones personalizados en proceso: qué es, de quién, de qué venta, en
   qué punto va y para cuándo se prometió.

   Vive como módulo propio y no dentro de bodega porque quien lo llena es el
   área de diseño: capturan el pedido, suben el diseño que el cliente aprobó y
   lo empujan hasta que se manda. La RLS ya lo acota al equipo interno. */
export default async function PersonalizadosPage() {
  const { supabase } = await usuarioActual();

  /* La hoja de la que salió esto pasa de 500 renglones y sigue creciendo:
     PostgREST corta en 1000 sin avisar, así que se pagina. */
  const personalizados = await traerTodo<Personalizado>((desde, hasta) =>
    supabase
      .from("personalizados")
      .select(
        "id, cliente, tipo, modelo, talla, no_venta, canal, fecha_compra, fecha_produccion, fecha_limite, url, foto_path, estado, notas, created_by, created_at, updated_at",
      )
      .order("fecha_limite", { ascending: true, nullsFirst: false })
      .range(desde, hasta),
  );

  /* El bucket es privado, así que cada diseño necesita un enlace firmado. Se
     firman todos aquí para poder pintar la miniatura dentro de la tabla: es lo
     que evita tener que abrir cada ficha para ver de qué cinturón se trata.

     Se piden REDIMENSIONADOS dentro de una caja de 760×200: los archivos
     originales rondan los 830 KB y ciento sesenta de esos serían 130 MB de
     página. La caja es un máximo —el cinturón entra entero y conserva su forma,
     ver `urlesFirmadas`—, y va al doble de lo que mide en pantalla para que se
     vea nítido en pantallas retina. La imagen completa se pide aparte, solo al
     ampliar una. Los enlaces caducan en una hora y esta página se vuelve a
     renderizar en cada visita. */
  const urlsDiseno = await urlesFirmadas(
    supabase,
    "personalizados",
    personalizados.map((p) => p.foto_path).filter((p): p is string => Boolean(p)),
    { ancho: 760, alto: 200 },
  );

  return <PanelPersonalizados personalizados={personalizados} urlsDiseno={urlsDiseno} />;
}
