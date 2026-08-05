"use client";

import { useState } from "react";
import Image from "next/image";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { urlFotoPersonalizado } from "@/app/(app)/personalizados/actions";

/* El diseño del cinturón, visible dentro de la tabla.

   La miniatura llega ya firmada y redimensionada desde el servidor, así que la
   lista se recorre de un vistazo —«¿cuál era el de Macry?»— sin abrir nada.
   Al ampliar se pide la imagen COMPLETA, y solo entonces: el original pesa
   cerca de un mega y bajarlo ciento sesenta veces para verlo en miniatura no
   tiene sentido.

   `unoptimized` porque la URL viene firmada y caduca: pasarla por el
   optimizador de Next la cachearía con una firma que en una hora ya no sirve
   (y Supabase ya entregó la miniatura en webp). */
export function VerDiseno({ url, path, cliente }: { url: string | null; path: string | null; cliente: string }) {
  const [completa, setCompleta] = useState<string | null>(null);
  const [abriendo, setAbriendo] = useState(false);

  if (!url) return <span className="text-muted-foreground">—</span>;

  async function ampliar() {
    if (!path) return;
    setAbriendo(true);
    const r = await urlFotoPersonalizado(path);
    setAbriendo(false);
    if ("error" in r) {
      toast.error(r.error);
      return;
    }
    setCompleta(r.url);
  }

  return (
    <>
      {/* La caja acota el ALTO y `object-contain` mete el diseño entero dentro:
          nunca se recorta y ninguna fila se dispara. Hace falta porque no todos
          los archivos tienen forma de cinturón — la mayoría son de ~2048×220
          (casi 10:1), pero alguno es una foto vertical y con alto libre ocupaba
          media pantalla. El sobrante NO se pinta: se ve la tarjeta, que es lo
          que hace que el cinturón parezca recortado en vez de ir sobre negro. */}
      <button
        type="button"
        disabled={abriendo}
        onClick={(e) => {
          e.stopPropagation();
          ampliar();
        }}
        title="Ver el diseño en grande"
        className="flex h-16 w-full max-w-[355px] items-center justify-center transition-opacity hover:opacity-70 disabled:opacity-50"
      >
        <Image
          src={url}
          alt={`Diseño del cinturón de ${cliente}`}
          width={760}
          height={80}
          unoptimized
          className="max-h-full w-auto max-w-full rounded object-contain"
        />
      </button>

      {completa && (
        <Dialog open onOpenChange={(v) => !v && setCompleta(null)}>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Diseño de {cliente}</DialogTitle>
            </DialogHeader>
            <Image
              src={completa}
              alt={`Diseño del cinturón de ${cliente}`}
              width={2048}
              height={220}
              unoptimized
              className="h-auto w-full rounded-md"
            />
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
