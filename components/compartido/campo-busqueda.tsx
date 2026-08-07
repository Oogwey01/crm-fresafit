"use client";

import { useEffect, useRef } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* El buscador de las listas. En estas pantallas buscar NO es un filtro más: es
   lo primero que hace quien entra a una lista de mil renglones. Por eso el campo
   va grande y en su propio renglón, con la lupa dentro, el atajo a la vista, el
   recuento de lo que va quedando y una cruz para vaciarlo —en el piso se busca
   desde el teléfono y borrar letra por letra es un fastidio—.

   El criterio de coincidencia vive en lib/busqueda.ts para que todas las listas
   busquen igual; esto es solo el control. Va dentro de <BarraHerramientas> para
   que además se quede pegado al bajar. */

/* Los campos montados ahora mismo, para el atajo de teclado. Se comparte UN
   listener entre todos en vez de uno por instancia: cuando dos pantallas montan
   buscador a la vez (una lista con su diálogo abierto encima), lo que hay que
   decidir es a cuál va el foco, y eso solo se puede decidir viéndolos juntos. */
const campos = new Set<HTMLInputElement>();

/* El de más arriba en el documento y visible. `offsetParent` en null = está en
   una pestaña oculta o un panel plegado: enfocarlo haría saltar la página a un
   sitio que no se ve. */
function campoAEnfocar() {
  const visibles = [...campos].filter((el) => el.offsetParent !== null);
  return visibles.sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  )[0];
}

function alTeclear(e: KeyboardEvent) {
  const destino = e.target;
  /* Si ya se está escribiendo en algún sitio, el atajo no existe: teclear un
     SKU con «/» en cualquier campo secuestraría el foco a media palabra. */
  const escribiendo =
    destino instanceof HTMLElement &&
    (destino.tagName === "INPUT" || destino.tagName === "TEXTAREA" || destino.isContentEditable);
  const barra = e.key === "/" && !escribiendo && !e.metaKey && !e.ctrlKey && !e.altKey;
  const combo = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";
  if (!barra && !combo) return;
  /* Con un diálogo abierto el atajo no existe: la lista de atrás sigue montada
     y visible por los bordes, y saltar allá sacaría a la persona del formulario
     que está llenando. */
  if (document.querySelector('[role="dialog"]')) return;
  const campo = campoAEnfocar();
  if (!campo) return;
  e.preventDefault();
  campo.focus();
  campo.select();
}

export function CampoBusqueda({
  valor,
  onCambio,
  placeholder = "Buscar…",
  conteo,
  className,
}: {
  valor: string;
  onCambio: (v: string) => void;
  placeholder?: string;
  /* Cuántos renglones quedan de cuántos, para enseñarlo dentro del campo: sin
     esto, filtrar mil fichas a ocho se ve igual que filtrarlas a cero hasta que
     bajas la vista a la tabla. `unidad` es el plural («productos», «clientes»). */
  conteo?: { visibles: number; total: number; unidad: string };
  className?: string;
}) {
  const campo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const nodo = campo.current;
    if (!nodo) return;
    campos.add(nodo);
    if (campos.size === 1) window.addEventListener("keydown", alTeclear);
    return () => {
      campos.delete(nodo);
      if (campos.size === 0) window.removeEventListener("keydown", alTeclear);
    };
  }, []);

  return (
    <div className={cn("relative flex w-full items-center", className)}>
      <Search
        className="pointer-events-none absolute left-3.5 size-[18px] text-muted-foreground"
        strokeWidth={1.9}
      />
      <Input
        ref={campo}
        aria-label={placeholder}
        placeholder={placeholder}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        onKeyDown={(e) => {
          /* Esc limpia; con el campo ya vacío, devuelve el teclado a la página
             en vez de dejarte atrapado en el input. */
          if (e.key !== "Escape") return;
          if (valor) onCambio("");
          else e.currentTarget.blur();
        }}
        className={cn(
          "h-11 rounded-xl bg-card pl-11 text-[15px] shadow-sm md:h-12 md:text-[15px]",
          conteo ? "pr-11 sm:pr-36" : "pr-11",
        )}
      />
      <div className="absolute right-2 flex items-center gap-1.5">
        {conteo && (
          <span className="hidden text-[12.5px] tabular-nums text-muted-foreground sm:inline">
            {conteo.visibles === conteo.total
              ? `${conteo.total} ${conteo.unidad}`
              : `${conteo.visibles} de ${conteo.total}`}
          </span>
        )}
        {valor ? (
          <button
            type="button"
            onClick={() => {
              onCambio("");
              campo.current?.focus();
            }}
            aria-label="Limpiar la búsqueda"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-4" strokeWidth={2} />
          </button>
        ) : (
          /* El atajo, a la vista: nadie descubre una tecla que no se anuncia.
             Se esconde en el teléfono, que no tiene teclado. */
          <kbd className="hidden rounded border bg-muted px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground md:inline">
            /
          </kbd>
        )}
      </div>
    </div>
  );
}
