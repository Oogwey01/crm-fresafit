import { NextResponse } from "next/server";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";

/* Autorización de las rutas que dispara un cron externo (cron-job.org) con
   `Authorization: Bearer CRON_SECRET`, o un usuario interno a mano. Era el
   mismo bloque copiado en las 6 rutas. Devuelve la respuesta 401 lista para
   retornar, o null si la petición está autorizada — el contrato (código y
   cuerpo) es EXACTAMENTE el que ya consumen los crons externos. */
export async function autorizarCron(request: Request): Promise<NextResponse | null> {
  const auth = request.headers.get("authorization");
  const esCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (esCron) return null;
  const { user, rol } = await usuarioActual();
  if (!user || !esInterno(rol)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  return null;
}

/* Cierre de error uniforme de esas mismas rutas: loguea con su ámbito y
   responde 500 con el mensaje de la excepción (o el texto por defecto). */
export function respuestaError(e: unknown, ambito: string, porDefecto: string): NextResponse {
  console.error(`[${ambito}]`, e);
  const detalle = e instanceof Error ? e.message : porDefecto;
  return NextResponse.json({ error: detalle }, { status: 500 });
}
