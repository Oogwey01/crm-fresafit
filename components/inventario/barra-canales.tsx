"use client";

import { Music2, RefreshCw, ShoppingCart, Store, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  sincronizarMercadolibre,
  sincronizarTiendanube,
  sincronizarTiktok,
} from "@/app/(app)/inventario/actions";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Los tres canales usan el mismo par de botones (Conectar / Sincronizar); era
   el mismo JSX triplicado en el panel. El id coincide con la ruta de OAuth
   (/api/<id>/conectar).

   `confirmacion` existe porque estos botones no son gratis: cada uno recorre el
   catálogo entero y las ventas del canal, tarda minutos y se dispara solo por
   cron. Estaban a un clic de distancia de "Conectar", que es justo el vecino
   más peligroso para tocar sin querer. */
const CANALES: {
  id: "tiendanube" | "mercadolibre" | "tiktok";
  etiquetaSync: string;
  etiquetaConectar: string;
  icono: LucideIcon;
  confirmacion: string;
  sincronizar: () => Promise<{ ok: true; detalle: string } | { error: string }>;
}[] = [
  {
    id: "tiendanube",
    etiquetaSync: "Sincronizar",
    etiquetaConectar: "Conectar Tienda Nube",
    icono: Store,
    confirmacion:
      "Sincronizar Tienda Nube: se vuelven a leer el catálogo y las ventas. Puede tardar unos minutos. ¿Seguir?",
    sincronizar: sincronizarTiendanube,
  },
  {
    id: "mercadolibre",
    etiquetaSync: "Mercado Libre",
    etiquetaConectar: "Conectar Mercado Libre",
    icono: ShoppingCart,
    confirmacion:
      "Sincronizar Mercado Libre: se vuelven a leer las publicaciones y las ventas. Puede tardar unos minutos. ¿Seguir?",
    sincronizar: sincronizarMercadolibre,
  },
  {
    id: "tiktok",
    etiquetaSync: "TikTok Shop",
    etiquetaConectar: "Conectar TikTok Shop",
    icono: Music2,
    confirmacion:
      "Sincronizar TikTok Shop: se vuelven a leer el catálogo y las ventas. Puede tardar unos minutos. ¿Seguir?",
    sincronizar: sincronizarTiktok,
  },
];

export function BarraCanales({
  tiendanube,
  mercadolibre,
  tiktok,
}: {
  tiendanube: { conectada: boolean };
  mercadolibre: { conectada: boolean };
  tiktok: { conectada: boolean };
}) {
  const conectadas = {
    tiendanube: tiendanube.conectada,
    mercadolibre: mercadolibre.conectada,
    tiktok: tiktok.conectada,
  };
  return (
    <>
      {CANALES.map((canal) => (
        <BotonCanal key={canal.id} canal={canal} conectada={conectadas[canal.id]} />
      ))}
    </>
  );
}

/* Cada canal lleva su propia transición: sincronizar uno deshabilita SOLO su
   botón (antes eran tres useTransition separados en el panel). */
function BotonCanal({
  canal,
  conectada,
}: {
  canal: (typeof CANALES)[number];
  conectada: boolean;
}) {
  const { pending: sincronizando, ejecutar } = useAccionServidor();

  function sincronizar() {
    ejecutar(canal.sincronizar, {
      confirmar: canal.confirmacion,
      error: "No se pudo sincronizar. Revisa tu conexión.",
      /* El detalle lo arma el server action (cuántos productos, cuántas
         ventas), así que el toast sale de la respuesta y no de un literal. */
      alExito: (r) => {
        toast.success(r.detalle);
      },
    });
  }

  const Icono = canal.icono;
  return conectada ? (
    <Button
      variant="outline"
      onClick={sincronizar}
      disabled={sincronizando}
      className="h-auto flex-1 gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:flex-none"
    >
      <RefreshCw className={cn("size-[15px]", sincronizando && "animate-spin")} strokeWidth={1.9} aria-hidden="true" />
      {sincronizando ? "Sincronizando…" : canal.etiquetaSync}
    </Button>
  ) : (
    <Button
      variant="outline"
      onClick={() => {
        window.location.href = `/api/${canal.id}/conectar`;
      }}
      className="h-auto flex-1 gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:flex-none"
    >
      <Icono className="size-[15px]" strokeWidth={1.9} aria-hidden="true" />
      {canal.etiquetaConectar}
    </Button>
  );
}
