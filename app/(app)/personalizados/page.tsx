import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { equipoCompleto } from "@/lib/supabase/consultas";
import { traerTodo } from "@/lib/canales/paginacion";
import { PanelPersonalizados } from "@/components/personalizados/panel";
import { enlacesDeOrden } from "@/lib/personalizados/desde-maquila";
import { correosDeClientes } from "@/lib/personalizados/correo-cliente";
import { leerDatosIntegracion } from "@/lib/canales/integraciones";
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
  const [personalizados, equipo, datosTN] = await Promise.all([
    traerTodo<Personalizado>((desde, hasta) =>
      supabase
        .from("personalizados")
        .select(
          "id, cliente, tipo, modelo, talla, no_venta, sale_order_id, canal, fecha_compra, fecha_produccion, fecha_limite, url, foto_path, estado, notas, responsable_id, correo_enviado_en, correo_enviado_a, created_by, created_at, updated_at",
        )
        /* En el orden en que se vendieron: el que lleva más esperando, primero.
           Es como el diseñador se pone al día — atiende la cola, no la busca.
           Las fichas viejas de la hoja sin fecha de compra se van al final: sin
           ese dato no hay lugar en la cola que les toque.

           Desempate por `created_at` y luego por `id`: las 73 fichas que la
           siembra crea de una pasada comparten fecha, y sin un criterio único
           Postgres puede devolverlas en distinto orden entre páginas — con
           `traerTodo` eso duplicaría unas y perdería otras. */
        .order("fecha_compra", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(desde, hasta),
    ),
    equipoCompleto(),
    /* El panel de Tienda Nube vive en el subdominio de cada tienda, así que el
       enlace a la venta necesita ese dato. Lo deja la sync en
       `integraciones.datos`; sin él, el botón no aparece para Tienda Nube
       (Mercado Libre no lo necesita). Mismo patrón que /pedidos. */
    leerDatosIntegracion("tiendanube").catch(() => ({}) as Record<string, unknown>),
  ]);

  /* Los dos van después y no en el Promise.all porque necesitan los ids que
     acaba de traer la consulta de arriba.
       · `enlaces`: a dónde lleva el botón de la venta en el panel del canal.
       · `correos`: a quién se le puede mandar la confirmación del pedido. Solo
         Tienda Nube da correo real, así que la mayoría de las fichas no sale en
         el mapa — es justo eso lo que apaga el botón en vez de dejar que
         alguien lo apriete y se lleve un error. */
  const [enlaces, correos] = await Promise.all([
    enlacesDeOrden(
      supabase,
      personalizados.map((p) => p.id),
      typeof datosTN.dominio_admin === "string" ? datosTN.dominio_admin : null,
    ),
    correosDeClientes(supabase, personalizados),
  ]);

  /* El bucket es privado, pero la página ya NO firma las miniaturas: firmarlas
     todas —una por una, porque la firma con transform no admite lote— eran
     ~160 llamadas a Storage por visita y la tenían en 18 segundos. Cada <img>
     apunta a /api/personalizados/diseno, que valida la sesión y redirige al
     enlace firmado: el navegador pide solo las que entran en pantalla y las
     cachea entre visitas. */
  return (
    <PanelPersonalizados
      personalizados={personalizados}
      equipo={equipo}
      enlacesOrden={Object.fromEntries(enlaces)}
      correosCliente={Object.fromEntries(correos)}
    />
  );
}
