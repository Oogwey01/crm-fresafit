import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { equipoCompleto } from "@/lib/supabase/consultas";
import { traerTodo } from "@/lib/canales/paginacion";
import { PanelPersonalizados } from "@/components/personalizados/panel";
import type { Personalizado } from "@/lib/types";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";

export const metadata = { title: "Personalizados · Fresafit" };

/* Los cinturones personalizados en proceso: qué es, de quién, de qué venta, en
   qué punto va y para cuándo se prometió.

   Vive como módulo propio y no dentro de bodega porque quien lo llena es el
   área de diseño: capturan el pedido, suben el diseño que el cliente aprobó y
   lo empujan hasta que se manda. La RLS ya lo acota al equipo interno. */
export default async function PersonalizadosPage() {
  await exigirModulo("personalizados");
  const { supabase } = await usuarioActual();

  /* La hoja de la que salió esto pasa de 500 renglones y sigue creciendo:
     PostgREST corta en 1000 sin avisar, así que se pagina. El equipo viaja para
     el selector y el avatar de quién lleva cada pedido. */
  const [personalizados, equipo] = await Promise.all([
    traerTodo<Personalizado>((desde, hasta) =>
      supabase
        .from("personalizados")
        .select(
          "id, cliente, tipo, modelo, talla, no_venta, canal, fecha_compra, fecha_produccion, fecha_limite, url, foto_path, estado, notas, responsable_id, created_by, created_at, updated_at",
        )
        .order("fecha_limite", { ascending: true, nullsFirst: false })
        .range(desde, hasta),
    ),
    equipoCompleto(),
  ]);

  /* El bucket es privado, pero la página ya NO firma las miniaturas: firmarlas
     todas —una por una, porque la firma con transform no admite lote— eran
     ~160 llamadas a Storage por visita y la tenían en 18 segundos. Cada <img>
     apunta a /api/personalizados/diseno, que valida la sesión y redirige al
     enlace firmado: el navegador pide solo las que entran en pantalla y las
     cachea entre visitas. */
  return <PanelPersonalizados personalizados={personalizados} equipo={equipo} />;
}
