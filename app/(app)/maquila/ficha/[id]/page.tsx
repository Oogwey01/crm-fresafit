import { notFound } from "next/navigation";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { exigirModulo } from "@/lib/supabase/guardia-modulo";
import { COLUMNAS_PEDIDO_MAQUILA } from "@/lib/maquila/consultas";
import { FichaImprimible } from "@/components/maquila/ficha-imprimible";
import type { PedidoMaquila } from "@/lib/types";

export const metadata = { title: "Ficha de producción · Fresafit" };

/* La hoja que acompaña la pieza en el taller (ver el componente). La consulta
   pasa por la sesión: la RLS decide — Eduardo imprime las suyas, el equipo
   todas, y un pedido sin pagar no existe para él. */
export default async function FichaMaquilaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await exigirModulo("maquila");
  const { supabase } = await usuarioActual();
  const { id } = await params;

  const { data } = await supabase
    .from("maquila_pedidos")
    .select(COLUMNAS_PEDIDO_MAQUILA)
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();

  return <FichaImprimible pedido={data as unknown as PedidoMaquila} />;
}
