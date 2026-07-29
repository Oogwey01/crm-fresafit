import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { usuarioActual, esInterno } from "@/lib/supabase/usuario-actual";
import { reconciliarInventario } from "@/lib/inventario/reconciliacion";

/* Reconciliación en segundo plano: lee el stock en vivo de los canales, lo
   compara contra el CRM y guarda el resultado en `reconciliacion_snapshots` para
   que el panel lo muestre al instante. Igual que /api/inventario/foto, NO va en
   los crons de vercel.json (el plan Hobby ya los tiene ocupados): lo dispara un
   programador externo (cron-job.org / GitHub Actions) con
   `Authorization: Bearer <CRON_SECRET>`. Un usuario interno también puede
   dispararlo a mano. */
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  const esCron = !!process.env.CRON_SECRET && auth === `Bearer ${process.env.CRON_SECRET}`;
  if (!esCron) {
    const { user, rol } = await usuarioActual();
    if (!user || !esInterno(rol)) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }
  }

  try {
    const resumen = await reconciliarInventario();
    const admin = createAdminClient();
    const { error } = await admin
      .from("reconciliacion_snapshots")
      .upsert({ id: "actual", resumen, creado_en: new Date().toISOString() });
    if (error) throw error;
    return NextResponse.json({
      ok: true,
      revisados: resumen.revisados,
      descuadres: resumen.descuadres.length,
    });
  } catch (e) {
    console.error("[inventario] reconciliacion:", e);
    const detalle = e instanceof Error ? e.message : "Falló la reconciliación.";
    return NextResponse.json({ error: detalle }, { status: 500 });
  }
}
