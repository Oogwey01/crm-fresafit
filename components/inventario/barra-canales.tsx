"use client";

import { Music2, Plug, RefreshCw, ShoppingCart, Store, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import {
  sincronizarMercadolibre,
  sincronizarTiendanube,
  sincronizarTiktok,
} from "@/app/(app)/inventario/actions";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
      "Sincronizar Tienda Nube: se vuelve a leer el catálogo (productos, precios y stock). Las ventas se importan solas con la pasada diaria. Puede tardar unos minutos. ¿Seguir?",
    sincronizar: sincronizarTiendanube,
  },
  {
    id: "mercadolibre",
    etiquetaSync: "Mercado Libre",
    etiquetaConectar: "Conectar Mercado Libre",
    icono: ShoppingCart,
    confirmacion:
      "Sincronizar Mercado Libre: se vuelven a leer las publicaciones (catálogo, precios y stock). Las ventas se importan solas con la pasada diaria. Puede tardar unos minutos. ¿Seguir?",
    sincronizar: sincronizarMercadolibre,
  },
  {
    id: "tiktok",
    etiquetaSync: "TikTok Shop",
    etiquetaConectar: "Conectar TikTok Shop",
    icono: Music2,
    confirmacion:
      "Sincronizar TikTok Shop: se vuelve a leer el catálogo (fichas, fotos y el stock que reporta TikTok). Las ventas se importan solas con la pasada diaria. Puede tardar unos minutos. ¿Seguir?",
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
      {/* Escritorio: un botón por canal, como siempre. `md:contents` deja que
          los tres sigan siendo hijos directos del flex de la cabecera. */}
      <div className="hidden md:contents">
        {CANALES.map((canal) => (
          <BotonCanal key={canal.id} canal={canal} conectada={conectadas[canal.id]} />
        ))}
      </div>

      {/* Teléfono: los tres detrás de un menú. Sincronizar a mano es
          mantenimiento —el cron lo hace solo— y no merece tres botones a ancho
          completo delante del catálogo, que es a lo que se entra. */}
      <DropdownMenu>
        <DropdownMenuTrigger
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-auto w-full gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:hidden",
          )}
        >
          <Plug className="size-4" strokeWidth={1.9} aria-hidden="true" />
          Canales
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {CANALES.map((canal) => (
            <ItemCanal key={canal.id} canal={canal} conectada={conectadas[canal.id]} />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/* El mismo par conectar/sincronizar, como renglón de menú. */
function ItemCanal({
  canal,
  conectada,
}: {
  canal: (typeof CANALES)[number];
  conectada: boolean;
}) {
  const { pending: sincronizando, ejecutar } = useAccionServidor();
  const Icono = canal.icono;

  if (!conectada) {
    return (
      <DropdownMenuItem
        onClick={() => {
          window.location.href = `/api/${canal.id}/conectar`;
        }}
      >
        <Icono aria-hidden="true" />
        {canal.etiquetaConectar}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenuItem
      disabled={sincronizando}
      /* closeOnClick=false: el menú se cerraba antes de que apareciera la
         confirmación, y con él desaparecía el contexto de qué se iba a
         sincronizar. */
      closeOnClick={false}
      onClick={() =>
        ejecutar(canal.sincronizar, {
          confirmar: canal.confirmacion,
          error: "No se pudo sincronizar. Revisa tu conexión.",
          alExito: (r) => {
            toast.success(r.detalle);
          },
        })
      }
    >
      <RefreshCw className={cn(sincronizando && "animate-spin")} aria-hidden="true" />
      {sincronizando ? "Sincronizando…" : `Sincronizar ${canal.etiquetaSync}`}
    </DropdownMenuItem>
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
