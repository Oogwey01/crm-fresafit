"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  completarInline,
  filtrarSugerencias,
  normalizar,
  type Sugerencia,
} from "@/lib/finanzas/sugerencias";

/* Campo de texto libre con memoria: propone lo que ya se ha capturado antes,
   ordenado por cuántas veces se usó, y completa solo lo que se va tecleando.
   No es un catálogo cerrado — siempre se puede escribir algo nuevo.

   La lista solo sale MIENTRAS se escribe: un campo vacío no estorba con nada, y
   Enter cierra la captura del campo y salta al siguiente.

   Dentro de un diálogo, la lista se pinta en flujo (absolute bajo el campo) en
   vez de en un popover: así el campo nunca pierde el foco y el teclado sigue
   escribiendo mientras se ve la lista. */
export function CampoSugerido({
  id,
  value,
  onChange,
  onElegir,
  sugerencias,
  placeholder,
  autoFocus,
  autocompletar = false,
  siguiente,
  detalle,
  className,
}: {
  id?: string;
  value: string;
  onChange: (texto: string) => void;
  /* Se llama solo cuando se toma una de la lista (clic, Enter o Tab). */
  onElegir?: (s: Sugerencia) => void;
  sugerencias: Sugerencia[];
  placeholder?: string;
  autoFocus?: boolean;
  /* Escribe solo el resto de la sugerencia y lo deja seleccionado, como el
     navegador. Se reserva para el campo principal: en los secundarios estorba. */
  autocompletar?: boolean;
  /* id del campo al que se salta con Enter. Sin esto, Enter solo confirma. */
  siguiente?: string;
  detalle?: (s: Sugerencia) => string | null;
  className?: string;
}) {
  const idLista = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  /* Selección pendiente del completado: se aplica tras el render, no antes —
     el value es controlado y hasta que React no pinta, el texto no está ahí. */
  const seleccionPendiente = useRef<[number, number] | null>(null);

  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1); // -1 = ninguna resaltada
  /* Lo que se tecleó de verdad cuando el campo se completó solo. La lista se
     filtra con esto: si no, al completar «goo» → «Google Workspace julio 2026»
     desaparecerían de la lista los otros «Google…» que también servían. */
  const [tecleado, setTecleado] = useState<string | null>(null);

  const consulta =
    tecleado && normalizar(value).startsWith(normalizar(tecleado)) ? tecleado : value;

  const opciones = useMemo(
    () => filtrarSugerencias(sugerencias, consulta),
    [sugerencias, consulta],
  );

  useEffect(() => {
    const sel = seleccionPendiente.current;
    if (!sel) return;
    seleccionPendiente.current = null;
    inputRef.current?.setSelectionRange(sel[0], sel[1]);
  });

  /* Con el campo vacío no se propone nada: las sugerencias son ayuda para quien
     ya empezó a escribir, no un menú que salta al entrar al campo. */
  const visible = abierto && !!normalizar(consulta) && opciones.length > 0;

  function cerrar() {
    setAbierto(false);
    setActivo(-1);
    setTecleado(null);
  }

  function elegir(s: Sugerencia) {
    onChange(s.texto);
    onElegir?.(s);
    cerrar();
  }

  /* Enter confirma lo que haya en el campo y pasa al siguiente: capturar un
     gasto es teclear y seguir, sin levantar la mano al ratón. */
  function saltarAlSiguiente() {
    if (!siguiente) {
      inputRef.current?.blur();
      return;
    }
    document.getElementById(siguiente)?.focus();
  }

  function alEscribir(e: React.ChangeEvent<HTMLInputElement>) {
    const escrito = e.target.value;
    setAbierto(true);
    setActivo(-1);

    /* Solo se completa al AÑADIR texto: al borrar, volver a poner lo borrado
       deja el campo imposible de vaciar. */
    const anadiendo = escrito.length > value.length;
    const alFinal = e.target.selectionStart === escrito.length;
    /* completarInline respeta lo tecleado (mayúsculas incluidas) y le pega el
       resto de la sugerencia, que queda seleccionado: seguir escribiendo lo
       reemplaza y Supr/Backspace lo borra. */
    const completado =
      autocompletar && anadiendo && alFinal ? completarInline(sugerencias, escrito) : null;
    if (!completado) {
      onChange(escrito);
      setTecleado(null);
      return;
    }

    onChange(completado);
    setTecleado(escrito);
    seleccionPendiente.current = [escrito.length, completado.length];
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!opciones.length || !normalizar(consulta)) return;
      e.preventDefault();
      if (!abierto) {
        setAbierto(true);
        setActivo(0);
        return;
      }
      const paso = e.key === "ArrowDown" ? 1 : -1;
      setActivo((i) => {
        const n = i + paso;
        if (n < 0) return opciones.length - 1;
        if (n >= opciones.length) return 0;
        return n;
      });
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      /* Con una sugerencia resaltada, Enter la toma; si no, se queda lo escrito
         (incluido lo que el campo completó solo). En los dos casos, sigue. */
      if (visible && activo >= 0) elegir(opciones[activo]);
      else cerrar();
      saltarAlSiguiente();
      return;
    }

    if (e.key === "Tab" && visible && activo >= 0) {
      elegir(opciones[activo]);
      return;
    }

    if (e.key === "Escape" && visible) {
      /* Sin esto, la primera Escape cerraría el diálogo entero. */
      e.preventDefault();
      e.stopPropagation();
      setAbierto(false);
      setActivo(-1);
    }
  }

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        id={id}
        autoFocus={autoFocus}
        autoComplete="off"
        placeholder={placeholder}
        value={value}
        onChange={alEscribir}
        onKeyDown={alTeclear}
        onBlur={cerrar}
        role="combobox"
        aria-expanded={visible}
        aria-controls={visible ? idLista : undefined}
        aria-autocomplete="list"
        aria-activedescendant={visible && activo >= 0 ? `${idLista}-${activo}` : undefined}
        className={className}
      />

      {visible && (
        <ul
          id={idLista}
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 max-h-56 overflow-y-auto overscroll-contain rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {opciones.map((s, i) => {
            const extra = detalle?.(s);
            return (
              <li
                key={s.texto}
                id={`${idLista}-${i}`}
                role="option"
                aria-selected={i === activo}
                /* mousedown, no click: el blur del campo llegaría antes. */
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(s);
                }}
                onMouseEnter={() => setActivo(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                  i === activo && "bg-accent",
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">{s.texto}</div>
                  {extra && (
                    <div className="truncate text-[11.5px] text-muted-foreground">{extra}</div>
                  )}
                </div>
                <span className="shrink-0 text-[11.5px] tabular-nums text-muted-foreground">
                  {s.usos === 1 ? "1 vez" : `${s.usos} veces`}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
