import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/* La barra de buscador y filtros de una lista, PEGADA arriba al bajar.

   En listas de cientos o miles de renglones el buscador se perdía a la primera
   vuelta de rueda y había que volver hasta arriba para cambiar una letra.

   En el teléfono se pega bajo el header de navegación (sticky, z-40, 3.5rem de
   alto): de ahí el top-14 y el z-30. En escritorio no hay header, así que va a
   top-0. Los márgenes negativos compensan el padding del shell —p-4 / sm:p-6 /
   md:p-7 en app/(app)/layout.tsx— para que al pegarse tape el ancho completo y
   no deje ver renglones colándose por los costados; el fondo es el del lienzo,
   así que en reposo la barra no se nota.

   Ojo con dónde se monta: `sticky` no funciona si algún ancestro tiene overflow
   distinto de `visible`. El shell no lo tiene a propósito (el scroll horizontal
   vive en las tablas anchas, no en el contenedor). */
export function BarraHerramientas({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "sticky top-14 z-30 -mx-4 mb-3 flex flex-col gap-2.5 border-b bg-lienzo/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6 md:top-0 md:-mx-7 md:px-7 md:py-3",
        className,
      )}
    >
      {children}
    </div>
  );
}
