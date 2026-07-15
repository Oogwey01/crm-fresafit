import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/* Tabla compartida con modo dual:
   - Escritorio (md+): tabla en grid, idéntica a la de siempre (con scroll
     horizontal si hace falta), donde cada celda es el JSX que devuelve `celda`.
   - Móvil (<md): cada registro se apila como TARJETA etiqueta:valor, sin scroll
     horizontal. La columna marcada `esTitulo` es el encabezado de la tarjeta.

   Cada módulo define sus columnas con una función `celda(row)` que devuelve el
   MISMO JSX que antes iba en la fila (botones, enlaces, steppers, selects…), así
   que la interacción se conserva en ambos modos. */

export type Columna<T> = {
  clave: string;
  label: string;
  celda: (row: T) => ReactNode;
  /** Encabezado de la tarjeta en móvil (y celda normal en escritorio). */
  esTitulo?: boolean;
  /** No mostrar este campo en la tarjeta móvil (p. ej. columnas decorativas). */
  ocultarEnCard?: boolean;
  /** Clases del valor en la tarjeta móvil. */
  cardValorClassName?: string;
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
}: {
  cols: string; // clase grid-cols-[...] común a encabezado y filas (escritorio)
  columnas: Columna<T>[];
  datos: T[];
  filaKey: (row: T) => string;
  titulo?: ReactNode; // rótulo de sección
  filaClassName?: (row: T) => string; // clases extra por fila/tarjeta
  minW?: string;
  vacio?: ReactNode;
}) {
  const tituloCol = columnas.find((c) => c.esTitulo);
  const camposCard = columnas.filter((c) => !c.esTitulo && !c.ocultarEnCard);

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
                className={cn(
                  "grid items-center gap-2 border-b px-6 py-3 text-sm last:border-b-0 hover:bg-accent/30",
                  cols,
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
              className={cn("rounded-2xl border bg-card p-4 shadow-sm", filaClassName?.(row))}
            >
              {tituloCol && (
                <div className="mb-2.5 text-[15px] font-semibold">{tituloCol.celda(row)}</div>
              )}
              <dl className="flex flex-col gap-2">
                {camposCard.map((c) => (
                  <div key={c.clave} className="flex items-baseline justify-between gap-4 text-sm">
                    <dt className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {c.label}
                    </dt>
                    <dd className={cn("min-w-0 text-right", c.cardValorClassName)}>
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
