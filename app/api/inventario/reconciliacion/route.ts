import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { autorizarCron, respuestaError } from "@/lib/canales/http";
import { reconciliarInventario } from "@/lib/inventario/reconciliacion";

/* Reconciliación en segundo plano: lee el stock en vivo de los canales, lo
   compara contra el CRM y guarda el resultado en `reconciliacion_snapshots` para
   que el panel lo muestre al instante. Igual que /api/inventario/foto, NO va en
   los crons de vercel.json (el plan Hobby ya los tiene ocupados): lo dispara un
   programador externo (cron-job.org / GitHub Actions) con
   `Authorization: Bearer <CRON_SECRET>`. Un usuario interno también puede
   dispararlo a mano. */
export async function GET(request: Request) {
  const noAutorizado = await autorizarCron(request);
  if (noAutorizado) return noAutorizado;

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
    return respuestaError(e, "inventario reconciliacion", "Falló la reconciliación.");
  }
}
