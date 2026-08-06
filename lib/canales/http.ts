import { NextResponse } from "next/server";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import { conActor } from "@/lib/inventario/actor";

/* ¿Viene del programador externo con el secreto, y no de una persona? */
function esCron(request: Request): boolean {
  const auth = request.headers.get("authorization");
  return !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
}

/* Autorización de las rutas que dispara un cron externo (cron-job.org) con
   `Authorization: Bearer CRON_SECRET`, o un usuario interno a mano. Era el
   mismo bloque copiado en las 6 rutas. Devuelve la respuesta 401 lista para
   retornar, o null si la petición está autorizada — el contrato (código y
   cuerpo) es EXACTAMENTE el que ya consumen los crons externos. */
export async function autorizarCron(request: Request): Promise<NextResponse | null> {
  if (esCron(request)) return null;
  const { user, rol } = await usuarioActual();
  if (!user || !esInterno(rol)) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }
  return null;
}

/* Firma en el historial de stock lo que se escriba dentro de `fn` con la
   persona que disparó ESTA petición a mano; null si la disparó el cron. Así una
   sincronización picada desde el navegador queda distinguible de la de las 6:00,
   que es de nadie. Al cron no le cuesta ninguna consulta extra (se corta antes
   de preguntar por el usuario), y a la persona tampoco: `usuarioActual` está
   cacheada por petición y `autorizarCron` ya la llamó. */
export async function conActorDePeticion<T>(request: Request, fn: () => Promise<T>): Promise<T> {
  if (esCron(request)) return conActor(null, fn);
  const { user } = await usuarioActual();
  return conActor(user?.id ?? null, fn);
}

/* Base https pública donde las plataformas pueden entregarnos webhooks. El
   origin de la petición NO sirve como fuente: el cron de Vercel invoca por la
   URL del deployment (*-projects.vercel.app), que está detrás de la Deployment
   Protection y responde 401 a cualquier entrega. Por eso manda una base fija:
   APP_URL si está definida, si no el dominio de producción que Vercel expone,
   y el origin queda solo como último recurso. Devuelve null cuando no hay
   ninguna base pública (dev local), y ahí no se registran webhooks. */
export function basePublica(origin: string): string | null {
  const produccion = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  const base = process.env.APP_URL || (produccion && `https://${produccion}`) || origin;
  if (!base.startsWith("https://") || base.includes("localhost")) return null;
  return base.replace(/\/+$/, "");
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
