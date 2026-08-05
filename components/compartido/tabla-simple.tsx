import { Fragment, type MouseEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Tabla compartida con modo dual:
   - Escritorio (md+): tabla en grid, idéntica a la de siempre (con scroll
     horizontal si hace falta), donde cada celda es el JSX que devuelve `celda`.
   - Móvil (<md): cada registro se apila como TARJETA, con los campos en dos
     columnas (etiqueta arriba, valor abajo) y sin scroll horizontal. La columna
     marcada `esTitulo` es el encabezado de la tarjeta.

     Antes cada campo era un renglón entero etiqueta ↔ valor: con cuatro o cinco
     campos cortos —SKU, tipo, precio— la tarjeta medía media pantalla y estaba
     casi toda vacía por dentro. En dos columnas ocupa la mitad y se lee igual.

   Cada módulo define sus columnas con una función `celda(row)` que devuelve el
   MISMO JSX que antes iba en la fila (botones, enlaces, steppers, selects…), así
   que la interacción se conserva en ambos modos. */

export type Columna<T> = {
  clave: string;
  label: string;
  celda: (row: T) => ReactNode;
  /** Encabezado de la tarjeta en móvil (y celda normal en escritorio). */
  esTitulo?: boolean;
  /** Clases del valor en la tarjeta móvil. */
  cardValorClassName?: string;
  /** En la tarjeta móvil ocupa el renglón completo en vez de media columna.
      Es para lo que no cabe en la mitad: controles (−/+ de stock), botones de
      acción, pastillas con texto largo. */
  cardAncho?: boolean;
};

export function TablaSimple<T>({
  cols,
  columnas,
  datos,
  filaKey,
  titulo,
  filaClassName,
  minW = "min-w-[760px]",
  vacio = "Sin datos.",
  onRowClick,
}: {
  cols: string; // clase grid-cols-[...] común a encabezado y filas (escritorio)
  columnas: Columna<T>[];
  datos: T[];
  filaKey: (row: T) => string;
  titulo?: ReactNode; // rótulo de sección
  filaClassName?: (row: T) => string; // clases extra por fila/tarjeta
  minW?: string;
  vacio?: ReactNode;
  /* Si se pasa, TODA la fila (o tarjeta en móvil) es clickeable. Los clics sobre
     controles internos (botones, selects, enlaces, inputs…) NO la disparan. */
  onRowClick?: (row: T) => void;
}) {
  const tituloCol = columnas.find((c) => c.esTitulo);
  const camposCard = columnas.filter((c) => !c.esTitulo);

  /* Ignora el clic de fila cuando cae sobre un control interactivo, para no
     robarle el clic a los +/− de stock, selects de estado, enlaces, etc. */
  const clicFila = (row: T) => (e: MouseEvent) => {
    if (!onRowClick) return;
    if ((e.target as HTMLElement).closest("button,a,select,input,textarea,label,[role=combobox],[role=menuitem]")) {
      return;
    }
    onRowClick(row);
  };

  return (
    <>
      {/* --- Escritorio: tabla --- */}
      <div className="hidden overflow-x-auto rounded-2xl border bg-card shadow-sm md:block">
        <div className={minW}>
          {titulo && (
            <div className="px-6 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {titulo}
            </div>
          )}
          <div
            className={cn(
              "grid gap-2 border-b px-6 py-3 text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground",
              titulo ? "bg-transparent" : "bg-muted/40",
              cols,
            )}
          >
            {columnas.map((c) => (
              <div key={c.clave}>{c.label}</div>
            ))}
          </div>
          {datos.length === 0 ? (
            <div className="px-6 py-8 text-center text-sm italic text-muted-foreground">{vacio}</div>
          ) : (
            datos.map((row) => (
              <div
                key={filaKey(row)}
                onClick={onRowClick ? clicFila(row) : undefined}
                className={cn(
                  "grid items-center gap-2 border-b px-6 py-3 text-sm last:border-b-0 hover:bg-accent/30",
                  cols,
                  onRowClick && "cursor-pointer",
                  filaClassName?.(row),
                )}
              >
                {columnas.map((c) => (
                  <Fragment key={c.clave}>{c.celda(row)}</Fragment>
                ))}
              </div>
            ))
          )}
        </div>
      </div>

      {/* --- Móvil: tarjetas --- */}
      <div className="space-y-3 md:hidden">
        {titulo && (
          <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {titulo}
          </div>
        )}
        {datos.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">{vacio}</p>
        ) : (
          datos.map((row) => (
            <div
              key={filaKey(row)}
              onClick={onRowClick ? clicFila(row) : undefined}
              /* overflow-hidden: la celda de título suele ser un <button>, que
                 mide lo que su contenido (un nombre de cliente largo desbordaba
                 la tarjeta y con ella la pantalla, y el teléfono contestaba
                 alejando el zoom). El `[&>*]:max-w-full` lo devuelve al ancho
                 de la tarjeta para que su `truncate` sí recorte. */
              className={cn(
                "overflow-hidden rounded-2xl border bg-card p-3.5 shadow-sm",
                onRowClick && "cursor-pointer",
                filaClassName?.(row),
              )}
            >
              {tituloCol && (
                <div className="mb-2.5 min-w-0 text-[14.5px] font-semibold [&>*]:max-w-full">
                  {tituloCol.celda(row)}
                </div>
              )}
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
                {camposCard.map((c) => (
                  <div key={c.clave} className={cn("min-w-0", c.cardAncho && "col-span-2")}>
                    {/* Las columnas de acciones no tienen rótulo en escritorio;
                        un <dt> vacío solo dejaría un hueco encima del botón. */}
                    {c.label && (
                      <dt className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {c.label}
                      </dt>
                    )}
                    <dd className={cn("min-w-0 text-[13.5px]", c.label && "mt-0.5", c.cardValorClassName)}>
                      {c.celda(row)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          ))
        )}
      </div>
    </>
  );
}
