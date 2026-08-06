import { NextResponse } from "next/server";
import { exigirRol } from "@/lib/supabase/guardia";
import { leerDatosIntegracion } from "@/lib/canales/integraciones";
import { conexionTiendanube, dominioAdminTN, urlEtiquetaTN } from "@/lib/tiendanube/api";

/* La guía de una orden de Tienda Nube, lo más directo que su API permita.

   Primero se intenta el PDF de la etiqueta (los fulfillment orders lo traen con
   URL firmada cuando la etiqueta ya se generó y el token tiene el scope
   read_fulfillment_orders). Si no hay —orden sin etiqueta todavía, token viejo
   sin el scope— se cae al plan B: la orden en el admin de la tienda, que es
   donde se imprime. Así el botón de /pedidos siempre lleva a ALGO útil y el día
   que la API coopere, sale el PDF sin tocar nada. */
export async function GET(request: Request) {
  const cx = await exigirRol("interno");
  if ("error" in cx) return NextResponse.json({ error: cx.error }, { status: 401 });

  const orden = new URL(request.url).searchParams.get("orden")?.trim() ?? "";
  if (!/^\d+$/.test(orden)) {
    return NextResponse.json({ error: "Falta el número de orden." }, { status: 400 });
  }

  const tn = await conexionTiendanube();
  if (!tn) {
    return NextResponse.json({ error: "Tienda Nube no está conectada." }, { status: 409 });
  }

  const etiqueta = await urlEtiquetaTN(tn, Number(orden));
  if (etiqueta) return NextResponse.redirect(etiqueta);

  /* Plan B: la orden en el admin. El dominio quedó guardado por la sync; si aún
     no, se le pregunta a la API una vez. */
  const datos = await leerDatosIntegracion("tiendanube").catch(
    () => ({}) as Record<string, unknown>,
  );
  const dominio =
    (typeof datos.dominio_admin === "string" && datos.dominio_admin.trim()) ||
    (await dominioAdminTN(tn).catch(() => null));
  if (!dominio) {
    return NextResponse.json(
      { error: "Sin etiqueta por API y sin dominio del panel: sincroniza Tienda Nube primero." },
      { status: 404 },
    );
  }
  return NextResponse.redirect(`https://${dominio}/admin/v2/orders/${orden}`);
}
