import { Bloque } from "@/components/compartido/esqueleto";

/* Sin esto, al abrir un producto se veía el esqueleto del catálogo (el
   `loading.tsx` del segmento padre): cuatro tarjetas y diez filas de tabla que
   no se parecen en nada a una ficha. Éste imita la ficha real —título, fotos,
   existencias, secciones— para que el cambio no salte. */
export default function Cargando() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <Bloque className="h-9 w-9 rounded-lg" />
      <div className="flex flex-col gap-2">
        <Bloque className="h-6 w-64" />
        <Bloque className="h-4 w-40" />
      </div>
      <Bloque className="aspect-square w-full rounded-lg" />
      <Bloque className="h-16 w-full rounded-lg" />
      <Bloque className="h-24 w-full rounded-lg" />
    </div>
  );
}
