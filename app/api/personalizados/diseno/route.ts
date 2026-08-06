import { NextResponse } from "next/server";
import { exigirRol } from "@/lib/supabase/guardia";

/* El diseño de un personalizado, servido por redirección a su enlace firmado.

   Antes la página firmaba TODAS las miniaturas en el render (~160 llamadas a
   Storage, porque la firma con transform no admite lote): era lo que tenía a
   /personalizados en 18 segundos. Con esta ruta la página no firma nada: cada
   <img> apunta aquí, el navegador pide solo las que entran en pantalla (lazy
   por defecto de next/image) y la firma se genera de una en una, bajo demanda.

   El `Cache-Control` dura menos que la firma (55 min contra 60): el navegador
   reutiliza la redirección entre visitas sin riesgo de quedarse con una firma
   ya caducada.

   La guardia es la misma de los server actions del módulo (`exigirRol`); las
   políticas del bucket la refuerzan por debajo, como en todo lo demás. */

const MINIATURA = { width: 760, height: 200, resize: "contain" as const, quality: 60 };
const UNA_HORA = 60 * 60;

export async function GET(request: Request) {
  const cx = await exigirRol("interno");
  if ("error" in cx) return NextResponse.json({ error: cx.error }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const path = searchParams.get("path") ?? "";
  /* Solo rutas del propio bucket: nada de escaparse con `..` ni rutas vacías. */
  if (!path || path.includes("..")) {
    return NextResponse.json({ error: "Ruta inválida." }, { status: 400 });
  }

  /* `full=1` entrega el archivo original (el diálogo de ampliar); sin él, la
     miniatura con las MISMAS medidas que se firmaban antes: caja máxima de
     760×200 con `contain` —el cinturón entero, sin recortes— y webp si el
     navegador lo acepta. */
  const completa = searchParams.get("full") === "1";
  const { data, error } = await cx.supabase.storage
    .from("personalizados")
    .createSignedUrl(path, UNA_HORA, completa ? undefined : { transform: MINIATURA });
  if (error || !data) {
    return NextResponse.json(
      { error: error?.message ?? "No se pudo generar el enlace." },
      { status: 404 },
    );
  }

  return NextResponse.redirect(data.signedUrl, {
    status: 302,
    headers: { "Cache-Control": "private, max-age=3300" },
  });
}
