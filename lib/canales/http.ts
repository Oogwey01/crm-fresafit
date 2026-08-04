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

/* Opciones de reimportación leídas de la URL de una ruta de sync:
     ?completo=1        → rescanea la ventana entera, ignorando la última sync
     ?dias=180          → cuántos días atrás mirar
   Sirven para REPARAR el histórico: las ventas importadas antes de que la fecha
   se convirtiera a hora de México quedaron en el día equivocado, y solo se
   corrigen volviendo a pasar la sincronización por encima de ellas. */
export function opcionesReimportacion(request: Request): { completo?: boolean; dias?: number } {
  const p = new URL(request.url).searchParams;
  const completo = p.get("completo") === "1" || p.get("completo") === "true";
  const dias = Number(p.get("dias"));
  return {
    completo: completo || dias > 0,
    dias: Number.isFinite(dias) && dias > 0 ? Math.min(dias, 730) : undefined,
  };
}

/* Cierre de error uniforme de esas mismas rutas: loguea con su ámbito y
   responde 500 con el mensaje de la excepción (o el texto por defecto). */
export function respuestaError(e: unknown, ambito: string, porDefecto: string): NextResponse {
  console.error(`[${ambito}]`, e);
  const detalle = e instanceof Error ? e.message : porDefecto;
  return NextResponse.json({ error: detalle }, { status: 500 });
}
