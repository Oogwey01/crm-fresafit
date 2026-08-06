import { NextResponse } from "next/server";
import { autorizarCron, conActorDePeticion, respuestaError } from "@/lib/canales/http";
import { tomarFotoCanales } from "@/lib/inventario/foto-canales";
import { repararDesviaciones } from "@/lib/inventario/reparacion";

/* Foto del stock en los tres lados (CRM, Tienda Nube, Mercado Libre), y —solo
   para los productos del piloto y solo cuando se puede demostrar que el canal
   se quedó atrás— la reparación de lo que quedó descuadrado. Los criterios y su
   porqué están en lib/inventario/reparacion.ts. Todo lo demás es solo lectura.

   NO va en los crons de vercel.json: el plan Hobby admite 2 tareas programadas
   y solo una vez al día, y las dos están ocupadas por las syncs de Tienda Nube
   y Mercado Libre. La foto necesita correr cada hora, así que la dispara un
   programador externo (cron-job.org / GitHub Actions) llamando a esta ruta con
   `Authorization: Bearer <CRON_SECRET>`. Un usuario interno también puede
   dispararla a mano desde el navegador. */
export async function GET(request: Request) {
  const noAutorizado = await autorizarCron(request);
  if (noAutorizado) return noAutorizado;

  try {
    const { estables, ...foto } = await tomarFotoCanales();
    /* La reparación es diagnóstico y corrección de mantenimiento: si falla, la
       foto —que es el dato— ya está guardada y no debe perderse por ello. */
    let reparacion;
    try {
      /* La corrección la decide el algoritmo, pero si alguien disparó la ruta a
         mano queda su nombre en el historial: es quien la pidió. */
      reparacion = await conActorDePeticion(request, () => repararDesviaciones(estables));
      for (const i of reparacion.incidencias) console.warn("[inventario] descuadre:", i);
    } catch (e) {
      console.error("[inventario] reparación:", e);
    }
    return NextResponse.json({ ok: true, ...foto, estables: estables.length, reparacion });
  } catch (e) {
    return respuestaError(e, "inventario foto de canales", "Falló la foto de inventario.");
  }
}
