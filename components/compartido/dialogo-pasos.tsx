"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";

/* Los diálogos de alta (tarea, gasto, producto…) son formularios largos. En la
   computadora eso está bien: se ven los diez campos de un golpe y se llenan en
   el orden que uno quiera. En el teléfono era la misma columna de doce campos
   metida en una caja con scroll propio — se llenaba a ciegas y el botón de
   guardar vivía tres pantallas abajo.

   DialogoPasos parte ese formulario en pantallas de dos o tres campos SOLO en
   móvil, con una barra de líneas arriba que dice por dónde vas. A partir de md:
   los pasos se pintan uno tras otro y el diálogo es exactamente el de siempre.

   Los pasos que no se están viendo siguen MONTADOS y solo se apagan con `hidden`
   (display:none): eso conserva lo ya escrito y, de paso, los saca del orden de
   tabulación y del árbol de accesibilidad sin tener que pelear con el focus trap
   de Base UI. */

export type PasoProps = {
  /** Encabezado grande del paso en el teléfono: "¿Quién la hace?". */
  titulo: string;
  /** Renglón de apoyo bajo el título. */
  ayuda?: string;
  /** false ⇒ "Siguiente" avisa qué falta en vez de avanzar. */
  valido?: boolean;
  /** Qué falta, en cristiano: "Ponle un título a la tarea." */
  motivoInvalido?: string;
  children: React.ReactNode;
};

/* Portador de configuración: nunca se pinta solo. DialogoPasos lee sus props y
   renderiza `children` dentro de su propia envoltura, así puede controlar la
   visibilidad y la animación sin cloneElement ni un contexto de por medio. */
export const Paso: (props: PasoProps) => null = () => null;

export function DialogoPasos({
  titulo,
  onCerrar,
  onGuardar,
  etiquetaGuardar,
  pending,
  onBorrar,
  anchoEscritorio = "md:max-w-lg",
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
  /** Una tira de <Paso>. Los condicionales que dan false/null se descartan. */
  children: React.ReactNode;
}) {
  const pasos = React.Children.toArray(children).filter(
    React.isValidElement,
  ) as React.ReactElement<PasoProps>[];
  const total = pasos.length;

  const [indice, setIndice] = React.useState(0);
  /* El aviso de "falta el título" no aparece hasta que alguien intenta avanzar:
     regañar antes de que escriban es ruido. */
  const [intentado, setIntentado] = React.useState(false);
  const refCuerpo = React.useRef<HTMLDivElement>(null);

  const actualIdx = Math.min(indice, Math.max(total - 1, 0));
  const actual = pasos[actualIdx]?.props;
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
    const malo = pasos.findIndex((p) => p.props.valido === false);
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
          // Computadora: la caja centrada de siempre, con su scroll propio.
          "md:top-1/2 md:left-1/2 md:h-auto md:max-h-[calc(100dvh-2rem)]",
          "md:-translate-x-1/2 md:-translate-y-1/2 md:gap-4 md:overflow-y-auto",
          "md:rounded-xl md:p-4",
          anchoEscritorio,
        )}
      >
        <div className="flex shrink-0 flex-col gap-2.5 border-b bg-popover px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3 md:gap-2 md:border-0 md:bg-transparent md:p-0">
          {/* Las líneas: hechas y actual en rosa, pendientes en gris. El
              pseudo-elemento le da ~28px de alto táctil sin engordar los 4 que
              se ven. Fuera del tab order a propósito: son un atajo, la
              navegación de verdad es la barra de abajo. */}
          {total > 1 && (
            <div
              role="progressbar"
              aria-valuemin={1}
              aria-valuemax={total}
              aria-valuenow={actualIdx + 1}
              aria-label={`Paso ${actualIdx + 1} de ${total}: ${actual?.titulo ?? ""}`}
              className="flex items-center gap-1.5 md:hidden"
            >
              {pasos.map((p, i) => (
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
            {/* En el teléfono el nombre del diálogo es el contexto y baja de
                jerarquía; el que manda es el título del paso. En md: vuelve a
                ser el encabezado de siempre. */}
            <DialogTitle className="truncate text-[13px] font-semibold text-muted-foreground md:text-base md:font-medium md:text-foreground">
              {titulo}
            </DialogTitle>
            {total > 1 && (
              <span className="ml-auto shrink-0 text-xs font-semibold tabular-nums text-muted-foreground md:hidden">
                {actualIdx + 1} de {total}
              </span>
            )}
          </div>

          <p className="font-heading text-[17px] leading-tight font-semibold md:hidden">
            {actual?.titulo}
          </p>
          {actual?.ayuda && (
            <p className="text-xs text-muted-foreground md:hidden">{actual.ayuda}</p>
          )}
          <span className="sr-only" aria-live="polite">
            {total > 1 ? `Paso ${actualIdx + 1} de ${total}: ${actual?.titulo ?? ""}` : ""}
          </span>
        </div>

        {/* min-h-0 no es adorno: sin él flex-1 no encoge y el scroll nunca entra. */}
        <div
          ref={refCuerpo}
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pt-3 pb-4 md:flex-none md:overflow-visible md:p-0"
        >
          {pasos.map((p, i) => (
            <div
              key={i}
              className={cn(
                "flex flex-col gap-3",
                i !== actualIdx && "hidden md:flex",
                i === actualIdx && "animate-in fade-in-0 duration-150 md:animate-none",
              )}
            >
              {p.props.children}
            </div>
          ))}
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

        {/* En computadora manda el pie CRUD de siempre: mismo componente, misma
            disposición. Guardar va directo, sin la validación por pasos, porque
            ahí se ven todos los campos y cada diálogo ya tiene su propio toast. */}
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
