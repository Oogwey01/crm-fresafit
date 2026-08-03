"use client";

import { useTransition } from "react";
import { Music2, RefreshCw, ShoppingCart, Store, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  sincronizarMercadolibre,
  sincronizarTiendanube,
  sincronizarTiktok,
} from "@/app/(app)/inventario/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/* Los tres canales usan el mismo par de botones (Conectar / Sincronizar); era
   el mismo JSX triplicado en el panel. El id coincide con la ruta de OAuth
   (/api/<id>/conectar). */
const CANALES: {
  id: "tiendanube" | "mercadolibre" | "tiktok";
  etiquetaSync: string;
  etiquetaConectar: string;
  icono: LucideIcon;
  sincronizar: () => Promise<{ ok: true; detalle: string } | { error: string }>;
}[] = [
  {
    id: "tiendanube",
    etiquetaSync: "Sincronizar",
    etiquetaConectar: "Conectar Tienda Nube",
    icono: Store,
    sincronizar: sincronizarTiendanube,
  },
  {
    id: "mercadolibre",
    etiquetaSync: "Mercado Libre",
    etiquetaConectar: "Conectar Mercado Libre",
    icono: ShoppingCart,
    sincronizar: sincronizarMercadolibre,
  },
  {
    id: "tiktok",
    etiquetaSync: "TikTok Shop",
    etiquetaConectar: "Conectar TikTok Shop",
    icono: Music2,
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
  const [sincronizando, startSync] = useTransition();

  function sincronizar() {
    startSync(async () => {
      const r = await canal.sincronizar();
      if ("error" in r) toast.error(r.error);
      else toast.success(r.detalle);
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
