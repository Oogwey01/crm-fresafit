import { NextResponse } from "next/server";
import { autorizarCron, respuestaError } from "@/lib/canales/http";
import { conciliarEnvios } from "@/lib/pedidos/conciliar-envios";

/* Cierra los pedidos que ya llegaron: rastrea la guía de cada envío pendiente y
   pone el estado que corresponda (entregado, devuelto), o lo cierra por
   antigüedad si nadie contesta. El porqué y las excepciones —los personalizados
   no se cierran solos— están en lib/pedidos/conciliar-envios.ts.

   NO va en los crons de vercel.json: el plan Hobby permite tres y ya los ocupan
   las syncs de los canales. Lo llama el mismo programador externo que la purga
   (cron-job.org) con `Authorization: Bearer <CRON_SECRET>`, una vez al día
   DESPUÉS de las syncs —a partir de las 7:30— para que el rastreo no discuta con
   un estado que el canal acaba de refrescar.

   Es idempotente y no borra nada: correrla de más solo repregunta por las mismas
   guías, así que `autorizarCron` (que admite también al equipo interno) alcanza.
   Se puede disparar a mano desde el navegador para ver qué encuentra. */
export async function GET(request: Request) {
  const noAutorizado = await autorizarCron(request);
  if (noAutorizado) return noAutorizado;

  try {
    const resumen = await conciliarEnvios();
    /* Si el rastreo no respondió, se responde 502 y no 200: una corrida muda que
       devuelve "0 entregados" se lee como "hoy no llegó nada", y así el
       programador externo la marca en rojo y la caída se nota. */
    if (resumen.rastreoCaido) {
      return NextResponse.json(
        { ok: false, error: "El servicio de rastreo no respondió; no se cambió ningún pedido.", ...resumen },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, ...resumen });
  } catch (e) {
    return respuestaError(e, "conciliación de envíos", "Falló la conciliación de envíos.");
  }
}
