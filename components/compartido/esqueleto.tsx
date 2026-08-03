import { cn } from "@/lib/utils";

/* Piezas para los `loading.tsx` de cada módulo. Next envuelve la página en un
   <Suspense> con este contenido, así que al navegar el armazón (sidebar y
   encabezado) queda a la vista de inmediato y aquí se dibuja el hueco de lo que
   viene en camino, en lugar de dejar la pantalla anterior congelada.

   Las medidas imitan el layout real de cada módulo para que el cambio de
   esqueleto a contenido no salte. */

export function Bloque({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} />;
}

/* Encabezado: título + subtítulo + botones de acción a la derecha. */
export function EsqueletoEncabezado({ acciones = 2 }: { acciones?: number }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="flex flex-col gap-2">
        <Bloque className="h-7 w-52" />
        <Bloque className="h-4 w-72" />
      </div>
      <div className="flex gap-2">
        {Array.from({ length: acciones }).map((_, i) => (
          <Bloque key={i} className="h-9 w-32 rounded-[11px]" />
        ))}
      </div>
    </div>
  );
}

/* Fila de tarjetas de indicadores. */
export function EsqueletoTarjetas({ n = 4 }: { n?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="rounded-2xl border bg-card p-5 shadow-sm">
          <Bloque className="h-3 w-24" />
          <Bloque className="mt-3 h-7 w-32" />
          <Bloque className="mt-2 h-3 w-20" />
        </div>
      ))}
    </div>
  );
}

/* Tabla: encabezado y filas, con el mismo contenedor que TablaSimple. */
export function EsqueletoTabla({ filas = 8 }: { filas?: number }) {
  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      <div className="flex gap-4 border-b px-4 py-3">
        <Bloque className="h-3 flex-1" />
        <Bloque className="hidden h-3 w-24 sm:block" />
        <Bloque className="hidden h-3 w-20 md:block" />
        <Bloque className="h-3 w-16" />
      </div>
      <div className="flex flex-col">
        {Array.from({ length: filas }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b px-4 py-3 last:border-b-0">
            <Bloque className="h-4 flex-1" />
            <Bloque className="hidden h-4 w-24 sm:block" />
            <Bloque className="hidden h-4 w-20 md:block" />
            <Bloque className="h-4 w-16" />
          </div>
        ))}
      </div>
    </div>
  );
}

/* Armazón común: encabezado + (opcional) tarjetas + tabla. */
export function EsqueletoModulo({
  tarjetas = 4,
  filas = 8,
  acciones = 2,
}: {
  tarjetas?: number;
  filas?: number;
  acciones?: number;
}) {
  return (
    <div className="flex flex-col gap-5">
      <EsqueletoEncabezado acciones={acciones} />
      {tarjetas > 0 && <EsqueletoTarjetas n={tarjetas} />}
      <EsqueletoTabla filas={filas} />
    </div>
  );
}
