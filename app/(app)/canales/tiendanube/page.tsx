import { Suspense } from "react";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { estadoTiendanube } from "@/lib/tiendanube/api";
import { carritosAbandonadosTN } from "@/lib/canales/salud";
import { resumirPagos } from "@/lib/canales/pagos";
import { diasDesdeHoy } from "@/lib/fecha";
import {
  BloqueCarritos,
  CarritosCargando,
  PanelTiendaNube,
} from "@/components/canales/panel-tiendanube";
import type { OrdenMetricas } from "@/lib/types";

export const metadata = { title: "Tienda Nube · Fresafit" };

/* Misma ventana que usa Métricas para los datos en vivo: 30 días bastan para
   leer una tendencia y es lo que la API de carritos devuelve sin paginar de más. */
const DIAS = 30;

/* Los carritos se piden a Tienda Nube, que los entrega de 200 en 200 con un
   tope de 2 peticiones por segundo: eso tardaba y bloqueaba TODA la página.
   Ahora va en su propio <Suspense>, así que el resto se manda de inmediato y
   este trozo aterriza cuando conteste (y ya cacheado 15 min, ver salud.ts). */
async function Carritos() {
  return <BloqueCarritos carritos={await carritosAbandonadosTN(DIAS)} />;
}

export default async function TiendaNubePage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase } = await usuarioActual();

  const [ordenesRes, estado] = await Promise.all([
    /* Las formas de pago y los cupones son de la ORDEN, no del renglón: viven en
       `sale_orders` y hoy solo Tienda Nube los reporta. */
    supabase
      .from("sale_orders")
      .select("canal, fecha, total, subtotal, envio, descuento, metodo_pago, cupon, meses")
      .eq("canal", "tienda_nube")
      .gte("fecha", diasDesdeHoy(-DIAS))
      .neq("estado", "cancelled")
      .limit(5000),
    estadoTiendanube(),
  ]);

  if (ordenesRes.error) {
    console.warn("[canales/tiendanube] sale_orders no disponible:", ordenesRes.error.message);
  }

  return (
    <PanelTiendaNube
      conectada={estado.conectada}
      ultimaSync={estado.ultimaSync}
      slotCarritos={
        <Suspense fallback={<CarritosCargando />}>
          <Carritos />
        </Suspense>
      }
      pagos={resumirPagos((ordenesRes.data ?? []) as OrdenMetricas[])}
      dias={DIAS}
    />
  );
}
