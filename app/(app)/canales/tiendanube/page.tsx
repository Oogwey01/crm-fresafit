import { Suspense } from "react";
import { usuarioActual } from "@/lib/supabase/usuario-actual";
import { vistaDinero } from "@/lib/supabase/vista-dinero";
import { veDineroDeCanal } from "@/lib/permisos-dinero";
import { estadoTiendanube } from "@/lib/tiendanube/api";
import { carritosAbandonadosTN } from "@/lib/canales/salud";
import { diasDesdeHoy } from "@/lib/fecha";
import {
  BloqueCarritos,
  CarritosCargando,
  PanelTiendaNube,
} from "@/components/canales/panel-tiendanube";
import type { ResumenPagos } from "@/lib/canales/pagos";

export const metadata = { title: "Tienda Nube · Fresafit" };

/* Misma ventana que usa Métricas para los datos en vivo: 30 días bastan para
   leer una tendencia y es lo que la API de carritos devuelve sin paginar de más. */
const DIAS = 30;

/* Los carritos se piden a Tienda Nube, que los entrega de 200 en 200 con un
   tope de 2 peticiones por segundo: eso tardaba y bloqueaba TODA la página.
   Ahora va en su propio <Suspense>, así que el resto se manda de inmediato y
   este trozo aterriza cuando conteste (y ya cacheado 15 min, ver salud.ts). */
async function Carritos({ verDinero }: { verDinero: boolean }) {
  return <BloqueCarritos carritos={await carritosAbandonadosTN(DIAS)} verDinero={verDinero} />;
}

export default async function TiendaNubePage() {
  /* Cacheado por request: comparte getUser() y perfil con el layout. */
  const { supabase } = await usuarioActual();
  const verDinero = veDineroDeCanal(await vistaDinero(), "tienda_nube");

  const [pagosRes, estado] = await Promise.all([
    /* Las formas de pago y los cupones son de la ORDEN, no del renglón: viven en
       `sale_orders` y hoy solo Tienda Nube los reporta. La suma la hace la base
       —`sale_orders` quedó cerrada a dirección y a los encargados de canal—, así
       que aquí ya no se baja una orden por fila para sumarlas a mano. */
    supabase.rpc("pagos_canal", { canal_f: "tienda_nube", desde: diasDesdeHoy(-DIAS) }),
    estadoTiendanube(),
  ]);

  if (pagosRes.error) {
    console.warn("[canales/tiendanube] pagos_canal no disponible:", pagosRes.error.message);
  }

  /* Null = o no hay permiso, o la migración no está puesta. En los dos casos el
     panel no pinta el bloque, que es lo correcto: cero formas de pago sería un
     dato, y aquí no lo es. */
  const pagos = (pagosRes.data as ResumenPagos | null) ?? null;

  return (
    <PanelTiendaNube
      conectada={estado.conectada}
      ultimaSync={estado.ultimaSync}
      slotCarritos={
        <Suspense fallback={<CarritosCargando />}>
          <Carritos verDinero={verDinero} />
        </Suspense>
      }
      pagos={pagos}
      dias={DIAS}
    />
  );
}
