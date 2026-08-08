"use client";

import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";

/* El shell de los formularios de alta/edición (sucesor del viejo DialogoPasos).

   En el teléfono: pantalla completa, un paso por zona con su barra de progreso,
   validación por paso y los pasos no visibles montados con `hidden`
   (display:none) — eso conserva lo ya escrito y, de paso, los saca del orden de
   tabulación y del árbol de accesibilidad sin pelear con el focus trap de
   Base UI.

   En la computadora ya no apila los pasos en una columna de doce campos — eso
   era lo tedioso — sino que arma el diálogo "estilo Linear":

     · lo que hay que ESCRIBIR (título, descripción) va arriba, grande y sin
       cajas — los hijos de <Hero>;
     · lo que ya viene con un buen default (responsable, prioridad, fecha…) va
       en filas de pastillas compactas — cada <Propiedades> es una fila;
     · lo voluminoso y opcional (renglones, comprobantes, presentaciones) va en
       secciones plegables que nacen cerradas — cada <SeccionFormulario>.

   Las pastillas (ver pastilla-propiedad.tsx) son responsivas: bajo md: pintan
   el campo móvil de siempre, así que cada campo se declara UNA sola vez y las
   dos disposiciones salen del mismo árbol.

   Guardar en escritorio va directo, sin la validación por pasos, porque ahí se
   ven todos los campos y cada diálogo ya tiene su propio toast. */

type ZonaComun = {
  /** Encabezado grande del paso en el teléfono: "¿Quién la hace?". */
  pasoTitulo: string;
  /** Renglón de apoyo bajo el título del paso. */
  pasoAyuda?: string;
  /** false ⇒ "Siguiente" avisa qué falta en vez de avanzar. */
  valido?: boolean;
  /** Qué falta, en cristiano: "Ponle un título a la tarea." */
  motivoInvalido?: string;
  children: React.ReactNode;
};

/* Portadores de configuración: nunca se pintan solos. DialogoFormulario lee
   sus props y renderiza `children` dentro de su propia envoltura (el mismo
   truco que <Paso>). Los condicionales que dan false/null se descartan. */
export const Hero: (props: ZonaComun) => null = () => null;

export const Propiedades: (props: ZonaComun) => null = () => null;

export const SeccionFormulario: (props: ZonaComun & {
  /** Rótulo de la sección en escritorio; el paso móvil usa pasoTitulo. */
  titulo: string;
  contador?: string | number | null;
  /** En escritorio la sección nace cerrada salvo que se pida lo contrario. */
  abiertaPorDefecto?: boolean;
}) => null = () => null;

type ZonaElemento = React.ReactElement<
  ZonaComun & { titulo?: string; contador?: string | number | null; abiertaPorDefecto?: boolean }
>;

export function DialogoFormulario({
  titulo,
  onCerrar,
  onGuardar,
  etiquetaGuardar,
  pending,
  onBorrar,
  anchoEscritorio = "md:max-w-xl",
  children,
}: {
  /** Nombre del diálogo: "Nueva tarea". */
  titulo: string;
  onCerrar: () => void;
  onGuardar: () => void;
  /** "Crear tarea" / "Guardar cambios". */
  etiquetaGuardar: string;
  pending: boolean;
  /** Presente solo cuando se puede borrar (edición + permiso). */
  onBorrar?: () => void;
  /** Ancho de la caja en computadora; en el teléfono siempre es pantalla completa. */
  anchoEscritorio?: string;
  /** Una tira de <Hero> / <Propiedades> / <SeccionFormulario>. */
  children: React.ReactNode;
}) {
  const zonas = React.Children.toArray(children).filter(React.isValidElement) as ZonaElemento[];
  const total = zonas.length;

  const [indice, setIndice] = React.useState(0);
  /* El aviso de "falta el título" no aparece hasta que alguien intenta avanzar:
     regañar antes de que escriban es ruido. */
  const [intentado, setIntentado] = React.useState(false);
  /* Qué secciones están abiertas en escritorio, por rótulo (el índice baila
     cuando una zona condicional aparece o desaparece). */
  const [abiertas, setAbiertas] = React.useState<Record<string, boolean>>({});
  const refCuerpo = React.useRef<HTMLDivElement>(null);

  const actualIdx = Math.min(indice, Math.max(total - 1, 0));
  const actual = zonas[actualIdx]?.props;
  const esUltimo = actualIdx === total - 1;

  /* Cada paso arranca desde arriba: heredar el scroll del anterior descoloca. */
  React.useEffect(() => {
    refCuerpo.current?.scrollTo({ top: 0 });
  }, [actualIdx]);

  function irA(destino: number) {
    setIntentado(false);
    setIndice(destino);
  }

  function siguiente() {
    if (actual?.valido === false) {
      setIntentado(true);
      return;
    }
    irA(Math.min(actualIdx + 1, total - 1));
  }

  /* Guardar desde el último paso valida TODOS: si algo falta atrás, salta a ese
     paso en lugar de mandar un error genérico sobre un campo que no se ve. */
  function intentarGuardar() {
    const malo = zonas.findIndex((z) => z.props.valido === false);
    if (malo !== -1) {
      setIndice(malo);
      setIntentado(true);
      return;
    }
    onGuardar();
  }

  const mensaje = intentado && actual?.valido === false ? actual.motivoInvalido : null;

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          // Teléfono: pantalla completa anclada arriba. El popup deja de
          // scrollear y se vuelve una columna cabecera / cuerpo / barra, así las
          // dos barras quedan fijas sin sticky ni márgenes negativos.
          // El sm:max-w-none es imprescindible: sin él, entre 640 y 767px el
          // sm:max-w-sm de la base encogería la pantalla completa a 384px.
          "top-0 left-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0",
          "flex-col gap-0 overflow-y-hidden rounded-none p-0 sm:max-w-none",
          // Computadora: caja centrada con su scroll propio, algo más ancha que
          // la de pasos porque las pastillas se acomodan en filas.
          "md:top-1/2 md:left-1/2 md:h-auto md:max-h-[calc(100dvh-2rem)]",
          "md:-translate-x-1/2 md:-translate-y-1/2 md:gap-4 md:overflow-y-auto",
          "md:rounded-xl md:p-5",
          anchoEscritorio,
        )}
      >
        <div className="flex shrink-0 flex-col gap-2.5 border-b bg-popover px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 md:gap-2 md:border-0 md:bg-transparent md:p-0">
          {total > 1 && (
            <div
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={total}
              aria-valuenow={actualIdx + 1}
              aria-label={`Paso ${actualIdx + 1} de ${total}: ${actual?.pasoTitulo ?? ""}`}
              className="flex items-center gap-1.5 md:hidden"
            >
              {zonas.map((z, i) => (
                <button
                  key={i}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  disabled={i > actualIdx + 1 || (i === actualIdx + 1 && actual?.valido === false)}
                  onClick={() => irA(i)}
                  className={cn(
                    "relative h-1 flex-1 rounded-full transition-colors duration-300",
                    "before:absolute before:inset-x-0 before:-inset-y-3 before:content-['']",
                    i <= actualIdx ? "bg-primary" : "bg-foreground/10",
                  )}
                />
              ))}
            </div>
          )}

          <div className="flex items-center gap-1">
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Cerrar"
                  className="-ml-2.5 size-11 shrink-0 rounded-lg text-muted-foreground md:absolute md:top-2 md:right-2 md:ml-0 md:size-8"
                />
              }
            >
              <X className="size-5 md:size-4" aria-hidden="true" />
            </DialogClose>
            {/* En el teléfono manda el título del paso; en la computadora el
                nombre del diálogo es el encabezado, discreto, porque el
                protagonista es el hero. */}
            <DialogTitle className="truncate text-[13px] font-semibold text-muted-foreground md:text-sm md:font-medium">
              {titulo}
            </DialogTitle>
            {total > 1 && (
              <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-muted-foreground md:hidden">
                {actualIdx + 1} de {total}
              </span>
            )}
          </div>

          <p className="font-heading text-[17px] leading-tight font-semibold md:hidden">
            {actual?.pasoTitulo}
          </p>
          {actual?.pasoAyuda && (
            <p className="text-xs text-muted-foreground md:hidden">{actual.pasoAyuda}</p>
          )}
          <span className="sr-only" aria-live="polite">
            {total > 1 ? `Paso ${actualIdx + 1} de ${total}: ${actual?.pasoTitulo ?? ""}` : ""}
          </span>
        </div>

        {/* min-h-0 no es adorno: sin él flex-1 no encoge y el scroll nunca entra. */}
        <div
          ref={refCuerpo}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pt-3 pb-4 md:flex-none md:gap-3.5 md:overflow-visible md:p-0"
        >
          {zonas.map((z, i) => {
            const oculta = i !== actualIdx; // solo cuenta bajo md:
            const comun = cn(
              oculta && "hidden md:flex",
              !oculta && "animate-in fade-in-0 duration-150 md:animate-none",
            );

            if (z.type === Hero) {
              return (
                <div key={i} className={cn("flex flex-col gap-3 md:gap-1", comun)}>
                  {z.props.children}
                </div>
              );
            }

            if (z.type === SeccionFormulario) {
              const rotulo = z.props.titulo ?? z.props.pasoTitulo;
              const abierta = abiertas[rotulo] ?? z.props.abiertaPorDefecto ?? false;
              return (
                <div key={rotulo} className={cn("flex flex-col gap-3", comun, "md:gap-0")}>
                  {/* El encabezado plegable solo existe en escritorio: en el
                      teléfono la sección ES un paso y siempre se ve. */}
                  <button
                    type="button"
                    aria-expanded={abierta}
                    onClick={() => setAbiertas((prev) => ({ ...prev, [rotulo]: !abierta }))}
                    className="hidden w-full items-center gap-2 border-t pt-2.5 pb-1.5 text-left md:flex"
                  >
                    <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                      {rotulo}
                    </h3>
                    {z.props.contador != null && (
                      <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
                        {z.props.contador}
                      </span>
                    )}
                    <ChevronDown
                      className={cn(
                        "ml-auto size-4 shrink-0 text-muted-foreground transition-transform",
                        !abierta && "-rotate-90",
                      )}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </button>
                  <div className={cn("flex flex-col gap-3", !abierta && "md:hidden")}>
                    {z.props.children}
                  </div>
                </div>
              );
            }

            // Propiedades: fila de pastillas en escritorio.
            return (
              <div
                key={i}
                className={cn(
                  "flex flex-col gap-3 md:flex-row md:flex-wrap md:items-center md:gap-1.5",
                  comun,
                )}
              >
                {z.props.children}
              </div>
            );
          })}
        </div>

        <div className="shrink-0 border-t bg-popover px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
          {mensaje && <p className="mb-2 text-xs font-medium text-destructive">{mensaje}</p>}
          <div className="flex items-center gap-2">
            {actualIdx > 0 && (
              <Button
                variant="outline"
                className="h-12 shrink-0 px-4 text-[15px]"
                onClick={() => irA(actualIdx - 1)}
                disabled={pending}
              >
                <ChevronLeft className="size-5" aria-hidden="true" />
                Atrás
              </Button>
            )}
            <Button
              className="h-12 flex-1 text-[15px]"
              onClick={esUltimo ? intentarGuardar : siguiente}
              disabled={pending}
            >
              {esUltimo ? (pending ? "Guardando…" : etiquetaGuardar) : "Siguiente"}
              {!esUltimo && <ChevronRight className="size-5" aria-hidden="true" />}
            </Button>
          </div>
          {onBorrar && esUltimo && (
            <Button
              variant="destructive"
              className="mt-2 h-11 w-full"
              onClick={onBorrar}
              disabled={pending}
            >
              Borrar
            </Button>
          )}
        </div>

        {/* En computadora manda el pie CRUD de siempre. */}
        <PieDialogoCRUD
          className="hidden md:flex"
          pending={pending}
          etiquetaGuardar={etiquetaGuardar}
          onGuardar={onGuardar}
          onCancelar={onCerrar}
          onBorrar={onBorrar}
        />
      </DialogContent>
    </Dialog>
  );
}
