"use client";

import * as React from "react";
import { Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/* La pieza central del rediseño de formularios en escritorio: en vez de una
   columna de diez campos con label, las propiedades que ya traen un buen
   default (prioridad media, fecha hoy, responsable yo…) se muestran como
   pastillas compactas en una fila — se leen de un vistazo y solo se tocan para
   cambiar. Al tocar una se abre un popover con el control de verdad.

   Bajo md: la pastilla desaparece y en su lugar se pinta `contenidoMovil`: el
   campo de siempre del wizard móvil (CampoOpcion en pastillas-radio, el
   calendario desplegado, los chips de personas). Así el teléfono no cambia ni
   un píxel donde ya estaba bien.

   Estados del disparador:
   - con valor → texto del valor, con el tinte al 12% si el catálogo trae color
     (el truco `1F` de <Pastilla>);
   - vacío y opcional (`vacia`) → "+ Añadir X" punteado y atenuado: se ve que
     se puede, no estorba. */

const CerrarPastillaContexto = React.createContext<(() => void) | null>(null);

/** Para que el control dentro del popover cierre al elegir (single-select). */
export function useCerrarPastilla(): () => void {
  const cerrar = React.useContext(CerrarPastillaContexto);
  return cerrar ?? (() => {});
}

export function PastillaPropiedad({
  etiqueta,
  icono: Icono,
  valor,
  textoValor,
  vacia = false,
  etiquetaVacia,
  color,
  ayuda,
  anchoPopover,
  contenidoMovil,
  children,
}: {
  /** Nombre de la propiedad: "Prioridad". Va al aria-label y al title. */
  etiqueta: string;
  icono?: LucideIcon;
  /** Contenido visual del disparador con valor (texto, avatar, puntos…). */
  valor?: React.ReactNode;
  /** El valor en texto plano para accesibilidad: "Media". */
  textoValor?: string;
  /** true ⇒ el disparador se pinta como "+ Añadir" punteado. */
  vacia?: boolean;
  /** Texto del estado vacío: "Etiquetas", "Alguien más". */
  etiquetaVacia?: string;
  /** Color de catálogo del valor actual: tiñe el fondo al 12%. */
  color?: string;
  /** Renglón de apoyo al pie del popover. */
  ayuda?: string;
  /** Clase de ancho del popover ("w-80"); por defecto se ajusta al contenido. */
  anchoPopover?: string;
  /** El campo completo que se pinta bajo md: (con su propio label). */
  contenidoMovil?: React.ReactNode;
  /** El control dentro del popover en md:. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const cerrar = React.useCallback(() => setOpen(false), []);

  return (
    <>
      {contenidoMovil && <div className="md:hidden">{contenidoMovil}</div>}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          title={etiqueta}
          aria-label={`${etiqueta}: ${textoValor ?? etiquetaVacia ?? "sin valor"}`}
          className={cn(
            "hidden h-7 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-2.5 md:inline-flex",
            "text-[12.5px] font-medium outline-none transition-colors",
            "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
            vacia
              ? "border-dashed text-muted-foreground hover:bg-accent hover:text-foreground"
              : "bg-card text-foreground hover:bg-accent",
          )}
          style={!vacia && color ? { backgroundColor: `${color}1F`, borderColor: `${color}80` } : undefined}
        >
          {vacia ? (
            <>
              <Plus className="size-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">{etiquetaVacia ?? etiqueta}</span>
            </>
          ) : (
            <>
              {Icono && (
                <Icono
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                  style={color ? { color } : undefined}
                />
              )}
              <span className="max-w-[10rem] truncate">{valor}</span>
            </>
          )}
        </PopoverTrigger>
        <PopoverContent className={cn("p-2", anchoPopover ?? "w-auto min-w-44")}>
          <CerrarPastillaContexto.Provider value={cerrar}>
            <div className="flex flex-col gap-1">
              <span className="px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {etiqueta}
              </span>
              {children}
              {ayuda && (
                <span className="max-w-64 px-1 pt-0.5 text-xs text-muted-foreground">{ayuda}</span>
              )}
            </div>
          </CerrarPastillaContexto.Provider>
        </PopoverContent>
      </Popover>
    </>
  );
}

/* Lista de opciones para dentro del popover de una pastilla — el equivalente
   compacto de un Select, sin anidar el Select de shadcn en un popover. */
export function ListaOpciones<T extends string>({
  opciones,
  valor,
  onElegir,
  buscable = false,
}: {
  opciones: readonly { id: T; nombre: string; color?: string }[];
  valor: T | null;
  onElegir: (id: T) => void;
  /** Input de filtro arriba; se enciende solo con listas largas (>8). */
  buscable?: boolean;
}) {
  const [filtro, setFiltro] = React.useState("");
  const conBusqueda = buscable || opciones.length > 8;
  const visibles = filtro.trim()
    ? opciones.filter((o) => o.nombre.toLowerCase().includes(filtro.trim().toLowerCase()))
    : opciones;

  return (
    <div className="flex flex-col gap-1">
      {conBusqueda && (
        <input
          type="text"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar…"
          aria-label="Buscar opción"
          className="mb-1 h-8 rounded-lg border border-input bg-transparent px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      )}
      <div className="flex max-h-64 flex-col overflow-y-auto">
        {visibles.map((o) => {
          const activa = o.id === valor;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => onElegir(o.id)}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent",
                activa && "font-semibold",
              )}
            >
              {o.color && (
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ backgroundColor: o.color }}
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{o.nombre}</span>
              {activa && <span className="ml-auto text-primary">✓</span>}
            </button>
          );
        })}
        {visibles.length === 0 && (
          <span className="px-2 py-1.5 text-[13px] text-muted-foreground">Sin resultados.</span>
        )}
      </div>
    </div>
  );
}
