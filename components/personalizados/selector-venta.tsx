"use client";

import { useEffect, useState } from "react";
import { Check, TriangleAlert } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Campo } from "@/components/compartido/campo";
import { PastillaPropiedad, useCerrarPastilla } from "@/components/compartido/pastilla-propiedad";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import { buscarVentas, type VentaCandidata } from "@/app/(app)/personalizados/actions";
import { obtenerCanal } from "@/lib/catalogos";
import { formatearFecha } from "@/lib/fecha";
import { cn } from "@/lib/utils";

/* ============================================================================
   Elegir de qué venta salió un personalizado.
   ----------------------------------------------------------------------------
   El «Nº de venta» se tecleaba a mano copiándolo del panel de la tienda: un
   dígito de más y la ficha queda colgando de un número que no existe, que es
   justo la llave con la que maquila busca el diseño.

   Se escribe igual que antes —el campo SIGUE aceptando texto libre: hay ventas
   que nunca entraron al CRM y cientos de fichas ya capturadas así—, pero al
   teclear salen las órdenes que coinciden y debajo se dice si lo escrito quedó
   ligado a una venta de verdad.

   La lista NO viaja con la página: son miles de órdenes, así que se buscan en el
   servidor (buscarVentas) a partir de dos caracteres, igual que maquila busca
   personalizados en vez de listarlos.
   ============================================================================ */

/* Lo que se guarda en `no_venta`: el folio visible al cliente, que es lo que la
   gente reconoce y lo que cruza contra maquila. Sin folio —órdenes viejas— se
   cae al id de la orden en la plataforma, que es lo que se copiaría a mano. */
export function folioDeVenta(v: VentaCandidata): string {
  return v.numero ?? v.referencia_orden;
}

/* "TN #4728 · 12 ago · Juan Pérez" */
function etiquetaVenta(v: VentaCandidata): string {
  const canal = obtenerCanal(v.canal)?.nombre ?? v.canal;
  return [`${canal} #${folioDeVenta(v)}`, formatearFecha(v.fecha), v.cliente]
    .filter(Boolean)
    .join(" · ");
}

export function SelectorVenta({
  id,
  valor,
  ventaLigada,
  onCambio,
  autoFocus,
  className,
}: {
  id?: string;
  /* El folio tecleado. Controlado por quien use el componente. */
  valor: string;
  /* La venta ya ligada, si la hay: se respeta aunque el texto no case exacto. */
  ventaLigada: VentaCandidata | null;
  /* Al escribir llega (texto, null); al elegir de la lista, (folio, venta). */
  onCambio: (texto: string, venta: VentaCandidata | null) => void;
  autoFocus?: boolean;
  className?: string;
}) {
  const [abierto, setAbierto] = useState(false);
  const [activo, setActivo] = useState(-1); // -1 = ninguna resaltada
  /* La consulta va contra el texto ya reposado: sin esto se dispararía una
     búsqueda por cada tecla. */
  const [consulta, setConsulta] = useState(valor.trim());

  useEffect(() => {
    const t = setTimeout(() => setConsulta(valor.trim()), 250);
    return () => clearTimeout(t);
  }, [valor]);

  const { datos, cargando } = useDetalleRemoto(async () => {
    if (consulta.length < 2) return { ventas: [] as VentaCandidata[] };
    const r = await buscarVentas(consulta);
    return "error" in r ? { ventas: [] as VentaCandidata[] } : r.datos;
  }, consulta);

  const opciones = datos?.ventas ?? [];
  const visible = abierto && opciones.length > 0;

  function elegir(v: VentaCandidata) {
    onCambio(folioDeVenta(v), v);
    setAbierto(false);
    setActivo(-1);
  }

  function alTeclear(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!opciones.length) return;
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

    if (e.key === "Enter" && visible && activo >= 0) {
      /* Sin esto, Enter enviaría el diálogo con la venta a medio elegir. */
      e.preventDefault();
      elegir(opciones[activo]);
      return;
    }

    if (e.key === "Escape" && visible) {
      /* La primera Escape cierra la lista, no el diálogo entero. */
      e.preventDefault();
      e.stopPropagation();
      setAbierto(false);
      setActivo(-1);
    }
  }

  /* La liga vale mientras el texto siga siendo el de esa venta: si se reescribe
     el folio a mano, lo que se ve abajo tiene que dejar de prometer una liga. */
  const ligada = ventaLigada && folioDeVenta(ventaLigada) === valor.trim() ? ventaLigada : null;

  return (
    <div className={cn("relative min-w-0 flex-1", className)}>
      <Input
        id={id}
        autoFocus={autoFocus}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-autocomplete="list"
        placeholder="4728, o el número de la orden…"
        className="font-mono"
        value={valor}
        onChange={(e) => {
          /* Teclear desliga: el texto manda mientras no se elija de la lista. */
          onCambio(e.target.value, null);
          setAbierto(true);
          setActivo(-1);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => {
          setAbierto(false);
          setActivo(-1);
        }}
        onKeyDown={alTeclear}
      />

      {valor.trim() &&
        (ligada ? (
          <p className="mt-1 flex items-center gap-1 truncate text-[11.5px] text-muted-foreground">
            <Check className="size-3 shrink-0 text-emerald-600" strokeWidth={2.5} />
            <span className="truncate">{etiquetaVenta(ligada)}</span>
          </p>
        ) : (
          <p className="mt-1 flex items-center gap-1 text-[11.5px] text-amber-600 dark:text-amber-500">
            <TriangleAlert className="size-3 shrink-0" strokeWidth={2.2} />
            {cargando && valor.trim().length >= 2
              ? "Buscando esta venta…"
              : "Sin venta ligada en el CRM"}
          </p>
        ))}

      {visible && (
        <ul
          role="listbox"
          className="absolute top-full right-0 left-0 z-50 mt-1 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          {opciones.map((v, i) => (
            <li
              key={v.id}
              role="option"
              aria-selected={i === activo}
              /* mousedown, no click: el blur del campo llegaría antes. */
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(v);
              }}
              onMouseEnter={() => setActivo(i)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5",
                i === activo && "bg-accent",
              )}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12.5px] font-semibold">
                  #{folioDeVenta(v)}
                </div>
                <div className="truncate text-[12px] text-muted-foreground">
                  {obtenerCanal(v.canal)?.nombre ?? v.canal} · {formatearFecha(v.fecha)}
                  {v.cliente ? ` · ${v.cliente}` : ""}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* La pastilla del formulario: el mismo selector dentro del popover de
   escritorio y como campo suelto en el teléfono, igual que PastillaProducto. */
export function PastillaVenta({
  etiqueta,
  valor,
  ventaLigada,
  onCambio,
  ayuda,
  idMovil,
}: {
  etiqueta: string;
  valor: string;
  ventaLigada: VentaCandidata | null;
  onCambio: (texto: string, venta: VentaCandidata | null) => void;
  ayuda?: string;
  idMovil?: string;
}) {
  const ligada = ventaLigada && folioDeVenta(ventaLigada) === valor.trim();
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      vacia={!valor.trim()}
      etiquetaVacia={etiqueta}
      valor={
        <span className="flex items-center gap-1.5">
          {ligada ? (
            <Check className="size-3.5 shrink-0 text-emerald-600" strokeWidth={2.5} aria-hidden="true" />
          ) : (
            <TriangleAlert
              className="size-3.5 shrink-0 text-amber-600 dark:text-amber-500"
              strokeWidth={2.2}
              aria-hidden="true"
            />
          )}
          <span className="truncate font-mono">{valor}</span>
        </span>
      }
      textoValor={
        valor.trim()
          ? ligada
            ? etiquetaVenta(ventaLigada!)
            : `${valor} — sin venta ligada`
          : undefined
      }
      ayuda={ayuda}
      anchoPopover="w-80"
      contenidoMovil={
        <Campo etiqueta={etiqueta} opcional ayuda={ayuda} htmlFor={idMovil}>
          <SelectorVenta
            id={idMovil}
            valor={valor}
            ventaLigada={ventaLigada}
            onCambio={onCambio}
          />
        </Campo>
      }
    >
      <VentaConCierre valor={valor} ventaLigada={ventaLigada} onCambio={onCambio} />
    </PastillaPropiedad>
  );
}

function VentaConCierre({
  valor,
  ventaLigada,
  onCambio,
}: {
  valor: string;
  ventaLigada: VentaCandidata | null;
  onCambio: (texto: string, venta: VentaCandidata | null) => void;
}) {
  const cerrar = useCerrarPastilla();
  return (
    <SelectorVenta
      valor={valor}
      ventaLigada={ventaLigada}
      onCambio={(texto, venta) => {
        onCambio(texto, venta);
        /* Con venta se eligió de la lista: ya está. Al teclear llega null y el
           popover sigue abierto para poder seguir escribiendo. */
        if (venta) cerrar();
      }}
      className="w-full"
    />
  );
}
