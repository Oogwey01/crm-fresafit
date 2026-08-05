import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { respuestaError } from "@/lib/canales/http";
import { usuarioActual } from "@/lib/supabase/usuario-actual";

/* Purga de bitácoras: tira lo que pasa de 90 días en `stock_log`,
   `stock_canal_log`, `task_activity` y las notificaciones YA LEÍDAS. El criterio
   y su porqué están en supabase/migrations/20260830000000_retencion_logs.sql;
   aquí solo se dispara.

   NO va en los crons de vercel.json (los del plan Hobby ya están ocupados por
   las tres syncs): lo llama un programador externo (cron-job.org) una vez por
   semana con `Authorization: Bearer <CRON_SECRET>`. No hace falta más: borra por
   fecha de corte, así que correrla tarde solo significa borrar un poco más.

   POR QUÉ ESTA RUTA NO USA `autorizarCron`, COMO SÍ HACEN LAS OTRAS CINCO.
   Ese ayudante da por bueno a cualquiera del equipo interno —incluidos `miembro`
   y `coordinador`—, y para las syncs está bien: son idempotentes, volver a
   importar ventas no rompe nada. Aquí no, porque esto BORRA y no hay deshacer.

   Y hay una trampa que conviene dejar escrita: `purgar_logs` se protege sola
   comprobando que quien la llama sea dirección o el propio cron, pero esta ruta
   la invoca con la llave de SERVICIO, así que esa guarda ve «service_role» y
   aprueba siempre, venga de quien venga la petición. El candado de la base no
   alcanza a la ruta; tiene que estar aquí.

   Por eso el corte es explícito y en dos niveles:
     · Con CRON_SECRET → borra de verdad. Es el proceso programado.
     · Con sesión de DIRECCIÓN → solo ensayo: cuenta lo que caería. Sirve para
       mirarlo desde el navegador antes de decidir, sin poder disparar el borrado
       de un clic — y sin que lo dispare un enlace que alguien mande por chat,
       porque esto es un GET y la cookie de sesión viaja sola.
     · Cualquier otro → 401.

   Dirección no pierde capacidad: para purgar a mano está
   `select public.purgar_logs(false);` en el SQL Editor, que es un sitio al que
   nadie llega por accidente. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const esCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;

  let ensayo = new URL(request.url).searchParams.get("ensayo") === "1";

  if (!esCron) {
    const { user, rol } = await usuarioActual();
    if (!user || rol !== "direccion") {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
    ensayo = true; // por sesión solo se mira, nunca se borra
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("purgar_logs", { solo_contar: ensayo });
    if (error) throw error;
    return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
  } catch (e) {
    return respuestaError(e, "purga de bitácoras", "Falló la purga de bitácoras.");
  }
}
