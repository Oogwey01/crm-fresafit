"use client";

import * as React from "react";
import {
  Bell,
  Calendar as CalendarIcon,
  Check,
  Tag,
  TriangleAlert,
  UserRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Campo } from "@/components/compartido/campo";
import { CampoOpcion, type OpcionCatalogo } from "@/components/compartido/campo-opcion";
import {
  SelectorProducto,
  etiquetaProducto,
  fichaLigada,
  type ProductoElegible,
} from "@/components/compartido/selector-producto";
import { Calendario, DatePicker } from "@/components/compartido/date-picker";
import {
  ListaOpciones,
  PastillaPropiedad,
  useCerrarPastilla,
} from "@/components/compartido/pastilla-propiedad";
import { Input } from "@/components/ui/input";
import { SelectorEtiquetas } from "@/components/tareas/selector-etiquetas";
import { SelectorPersonas } from "@/components/tareas/selector-personas";
import { ETIQUETAS } from "@/lib/catalogos";
import { formatearFecha, hoyISO, sumarDias } from "@/lib/fecha";
import { cn, iniciales } from "@/lib/utils";
import type { Profile } from "@/lib/types";

/* Las pastillas concretas de los formularios: cada una casa un tipo de dato
   (catálogo, persona, fecha, etiquetas…) con su control de escritorio dentro
   del popover Y su campo móvil de siempre. Ver pastilla-propiedad.tsx para la
   idea general. */

/* ── Catálogo (prioridad, estado, categoría, canal…) ─────────────────────── */

export function PastillaOpcion<T extends string>({
  etiqueta,
  icono,
  opciones,
  valor,
  onCambio,
  ayuda,
  buscable = false,
  sinTinte = false,
  contenidoMovil,
  idMovil,
}: {
  etiqueta: string;
  icono?: LucideIcon;
  opciones: readonly OpcionCatalogo<T>[];
  valor: T;
  onCambio: (v: T) => void;
  /** Renglón de apoyo (va al popover y bajo el campo móvil). */
  ayuda?: string;
  /** Fuerza el input de filtro aunque la lista sea corta. */
  buscable?: boolean;
  /** No tiñe la pastilla aunque la opción traiga color (para filas cargadas). */
  sinTinte?: boolean;
  /** Sustituye el CampoOpcion móvil por un campo a la medida (p. ej. el "dato
      + cambiar" del área de la tarea). */
  contenidoMovil?: React.ReactNode;
  idMovil?: string;
}) {
  const actual = opciones.find((o) => o.id === valor);
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      icono={icono}
      valor={actual?.nombre ?? etiqueta}
      textoValor={actual?.nombre}
      color={sinTinte ? undefined : actual?.color}
      ayuda={ayuda}
      contenidoMovil={
        contenidoMovil ?? (
          <CampoOpcion
            etiqueta={etiqueta}
            opciones={opciones}
            valor={valor}
            onCambio={onCambio}
            ayuda={ayuda}
            id={idMovil}
          />
        )
      }
    >
      <OpcionesConCierre opciones={opciones} valor={valor} onCambio={onCambio} buscable={buscable} />
    </PastillaPropiedad>
  );
}

/* Separado para poder usar useCerrarPastilla DENTRO del popover (el contexto
   lo provee PastillaPropiedad alrededor de children). */
function OpcionesConCierre<T extends string>({
  opciones,
  valor,
  onCambio,
  buscable,
}: {
  opciones: readonly OpcionCatalogo<T>[];
  valor: T;
  onCambio: (v: T) => void;
  buscable: boolean;
}) {
  const cerrar = useCerrarPastilla();
  return (
    <ListaOpciones
      opciones={opciones}
      valor={valor}
      buscable={buscable}
      onElegir={(id) => {
        onCambio(id);
        cerrar();
      }}
    />
  );
}

/* ── Una persona (responsable, quién lo lleva, contado por…) ─────────────── */

export function PastillaPersona({
  etiqueta,
  equipo,
  valor,
  onCambio,
  opcionNula,
  ayuda,
  contenidoMovil,
}: {
  etiqueta: string;
  equipo: Profile[];
  /** id del perfil o el id de `opcionNula` ("none"). */
  valor: string;
  onCambio: (v: string) => void;
  /** La opción "nadie": { id: "none", nombre: "Sin asignar" }. */
  opcionNula?: { id: string; nombre: string };
  ayuda?: string;
  /** Sustituye el campo móvil por defecto por uno a la medida. */
  contenidoMovil?: React.ReactNode;
}) {
  const persona = equipo.find((p) => p.id === valor) ?? null;
  const opciones = [
    ...(opcionNula ? [{ id: opcionNula.id, nombre: opcionNula.nombre }] : []),
    ...equipo.map((p) => ({ id: p.id, nombre: p.nombre })),
  ];
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      valor={
        persona ? (
          <span className="flex items-center gap-1.5">
            <AvatarMini nombre={persona.nombre} color={persona.color} />
            {primerNombre(persona.nombre)}
          </span>
        ) : (
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <UserRound className="size-3.5" aria-hidden="true" />
            {opcionNula?.nombre ?? etiqueta}
          </span>
        )
      }
      textoValor={persona?.nombre ?? opcionNula?.nombre}
      ayuda={ayuda}
      contenidoMovil={
        contenidoMovil ?? (
          <CampoOpcion etiqueta={etiqueta} opciones={opciones} valor={valor} onCambio={onCambio} ayuda={ayuda} />
        )
      }
    >
      <ListaPersonas equipo={equipo} valor={valor} onCambio={onCambio} opcionNula={opcionNula} />
    </PastillaPropiedad>
  );
}

function ListaPersonas({
  equipo,
  valor,
  onCambio,
  opcionNula,
}: {
  equipo: Profile[];
  valor: string;
  onCambio: (v: string) => void;
  opcionNula?: { id: string; nombre: string };
}) {
  const cerrar = useCerrarPastilla();
  const [filtro, setFiltro] = React.useState("");
  const visibles = filtro.trim()
    ? equipo.filter((p) => p.nombre.toLowerCase().includes(filtro.trim().toLowerCase()))
    : equipo;

  function elegir(id: string) {
    onCambio(id);
    cerrar();
  }

  return (
    <div className="flex flex-col gap-1">
      {equipo.length > 8 && (
        <input
          type="text"
          value={filtro}
          onChange={(e) => setFiltro(e.target.value)}
          placeholder="Buscar…"
          aria-label="Buscar persona"
          className="mb-1 h-8 rounded-lg border border-input bg-transparent px-2.5 text-[13px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
      )}
      <div className="flex max-h-64 flex-col overflow-y-auto">
        {opcionNula && !filtro.trim() && (
          <button
            type="button"
            onClick={() => elegir(opcionNula.id)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground transition-colors hover:bg-accent",
              valor === opcionNula.id && "font-semibold text-foreground",
            )}
          >
            <UserRound className="size-4" aria-hidden="true" />
            {opcionNula.nombre}
            {valor === opcionNula.id && <span className="ml-auto text-primary">✓</span>}
          </button>
        )}
        {visibles.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => elegir(p.id)}
            className={cn(
              "flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors hover:bg-accent",
              valor === p.id && "font-semibold",
            )}
          >
            <AvatarMini nombre={p.nombre} color={p.color} />
            <span className="truncate">{p.nombre}</span>
            {valor === p.id && <span className="ml-auto text-primary">✓</span>}
          </button>
        ))}
        {visibles.length === 0 && (
          <span className="px-2 py-1.5 text-[13px] text-muted-foreground">Sin resultados.</span>
        )}
      </div>
    </div>
  );
}

/* ── Varias personas (coasignados) ───────────────────────────────────────── */

export function PastillaPersonas({
  etiqueta,
  etiquetaVacia,
  equipo,
  seleccionados,
  principalId,
  onToggle,
  ayuda,
}: {
  etiqueta: string;
  /** Texto del "+": "Alguien más". */
  etiquetaVacia: string;
  equipo: Profile[];
  seleccionados: string[];
  principalId: string | null;
  onToggle: (id: string) => void;
  ayuda?: string;
}) {
  const elegidos = equipo.filter((p) => seleccionados.includes(p.id));
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      vacia={elegidos.length === 0}
      etiquetaVacia={etiquetaVacia}
      valor={
        <span className="flex items-center gap-1.5">
          <span className="flex -space-x-1.5">
            {elegidos.slice(0, 4).map((p) => (
              <AvatarMini key={p.id} nombre={p.nombre} color={p.color} conBorde />
            ))}
          </span>
          {elegidos.length === 1
            ? primerNombre(elegidos[0].nombre)
            : `${elegidos.length} personas`}
        </span>
      }
      textoValor={elegidos.map((p) => primerNombre(p.nombre)).join(", ") || undefined}
      ayuda={ayuda}
      anchoPopover="w-80"
      contenidoMovil={
        <Campo etiqueta={etiqueta} opcional ayuda={ayuda}>
          <SelectorPersonas
            equipo={equipo}
            seleccionados={seleccionados}
            principalId={principalId}
            onToggle={onToggle}
          />
        </Campo>
      }
    >
      <SelectorPersonas
        equipo={equipo}
        seleccionados={seleccionados}
        principalId={principalId}
        onToggle={onToggle}
      />
    </PastillaPropiedad>
  );
}

/* ── Fecha (límite, de compra, de pago…) ─────────────────────────────────── */

export function PastillaFecha({
  etiqueta,
  etiquetaVacia = "Fecha",
  valor,
  onCambio,
  limpiable = false,
  min,
  max,
  ayuda,
  contenidoMovil,
}: {
  etiqueta: string;
  etiquetaVacia?: string;
  valor: string; // "AAAA-MM-DD" o ""
  onCambio: (iso: string) => void;
  limpiable?: boolean;
  min?: string;
  max?: string;
  ayuda?: string;
  /** Sustituye el campo móvil por defecto por uno a la medida. */
  contenidoMovil?: React.ReactNode;
}) {
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      icono={CalendarIcon}
      vacia={!valor}
      etiquetaVacia={etiquetaVacia}
      valor={textoFecha(valor)}
      textoValor={valor ? textoFecha(valor) : undefined}
      ayuda={ayuda}
      contenidoMovil={
        contenidoMovil ?? (
          <Campo etiqueta={etiqueta} ayuda={ayuda}>
            <DatePicker value={valor} onChange={onCambio} limpiable={limpiable} min={min} max={max} abiertoEnMovil />
          </Campo>
        )
      }
    >
      <CalendarioConCierre valor={valor} onCambio={onCambio} min={min} max={max} limpiable={limpiable} />
    </PastillaPropiedad>
  );
}

function CalendarioConCierre({
  valor,
  onCambio,
  min,
  max,
  limpiable,
}: {
  valor: string;
  onCambio: (iso: string) => void;
  min?: string;
  max?: string;
  limpiable: boolean;
}) {
  const cerrar = useCerrarPastilla();
  return (
    <div className="flex flex-col">
      <Calendario
        valor={valor}
        min={min}
        max={max}
        onCambio={(iso) => {
          onCambio(iso);
          cerrar();
        }}
      />
      {limpiable && valor && (
        <button
          type="button"
          onClick={() => {
            onCambio("");
            cerrar();
          }}
          className="mt-1 ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="size-3.5" aria-hidden="true" />
          Quitar fecha
        </button>
      )}
    </div>
  );
}

/** "Hoy" y "Mañana" se leen más rápido que "07/08"; el resto va formateado. */
function textoFecha(iso: string): string {
  if (!iso) return "";
  const hoy = hoyISO();
  if (iso === hoy) return "Hoy";
  if (iso === sumarDias(hoy, 1)) return "Mañana";
  return formatearFecha(iso);
}

/* ── Fecha y hora (recordatorios) ────────────────────────────────────────── */

export function PastillaFechaHora({
  etiqueta,
  etiquetaVacia,
  valor,
  onCambio,
  ayuda,
  opcional = true,
  contenidoMovil,
  idMovil,
}: {
  etiqueta: string;
  /** "Aviso" — lo que dice el "+" cuando no hay valor. */
  etiquetaVacia: string;
  valor: string; // formato de <input type="datetime-local"> o ""
  onCambio: (v: string) => void;
  ayuda?: string;
  /** false ⇒ el label móvil no dice "(opcional)" (casi todos estos campos lo son). */
  opcional?: boolean;
  /** Sustituye el campo móvil por defecto por uno a la medida. */
  contenidoMovil?: React.ReactNode;
  idMovil?: string;
}) {
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      icono={Bell}
      vacia={!valor}
      etiquetaVacia={etiquetaVacia}
      valor={textoFechaHora(valor)}
      textoValor={valor ? textoFechaHora(valor) : undefined}
      ayuda={ayuda}
      contenidoMovil={
        contenidoMovil ?? (
          <Campo etiqueta={etiqueta} opcional={opcional} ayuda={ayuda} htmlFor={idMovil}>
            <Input
              id={idMovil}
              type="datetime-local"
              value={valor}
              onChange={(e) => onCambio(e.target.value)}
            />
          </Campo>
        )
      }
    >
      <div className="flex flex-col gap-1.5">
        <Input
          type="datetime-local"
          aria-label={etiqueta}
          value={valor}
          onChange={(e) => onCambio(e.target.value)}
        />
        {valor && (
          <button
            type="button"
            onClick={() => onCambio("")}
            className="ml-auto flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="size-3.5" aria-hidden="true" />
            Quitar aviso
          </button>
        )}
      </div>
    </PastillaPropiedad>
  );
}

/** "07/08, 14:30" a partir del valor del input datetime-local. */
function textoFechaHora(v: string): string {
  if (!v) return "";
  const [fecha, hora] = v.split("T");
  if (!fecha || !hora) return v;
  return `${textoFecha(fecha)}, ${hora}`;
}

/* ── Etiquetas de tarea ──────────────────────────────────────────────────── */

export function PastillaEtiquetas({
  area,
  seleccionadas,
  onToggle,
}: {
  area: string;
  seleccionadas: string[];
  onToggle: (id: string) => void;
}) {
  const puestas = ETIQUETAS.filter((e) => seleccionadas.includes(e.id));
  return (
    <PastillaPropiedad
      etiqueta="Etiquetas"
      icono={Tag}
      vacia={puestas.length === 0}
      etiquetaVacia="Etiquetas"
      valor={
        <span className="flex items-center gap-1.5">
          <span className="flex items-center gap-0.5">
            {puestas.slice(0, 4).map((e) => (
              <span
                key={e.id}
                className="size-2 rounded-full"
                style={{ backgroundColor: e.color }}
                aria-hidden="true"
              />
            ))}
          </span>
          {puestas.length === 1 ? puestas[0].nombre : `${puestas.length} etiquetas`}
        </span>
      }
      textoValor={puestas.map((e) => e.nombre).join(", ") || undefined}
      anchoPopover="w-80"
      contenidoMovil={
        <Campo etiqueta="Etiquetas">
          <SelectorEtiquetas area={area} seleccionadas={seleccionadas} onToggle={onToggle} />
        </Campo>
      }
    >
      <SelectorEtiquetas area={area} seleccionadas={seleccionadas} onToggle={onToggle} />
    </PastillaPropiedad>
  );
}

/* ── Texto o número corto (cantidad, código, % de comisión…) ─────────────── */

export function PastillaEntrada({
  etiqueta,
  icono,
  valor,
  onCambio,
  tipo = "text",
  placeholder,
  prefijo,
  sufijo,
  ayuda,
  opcional = false,
  idMovil,
}: {
  etiqueta: string;
  icono?: LucideIcon;
  valor: string;
  onCambio: (v: string) => void;
  tipo?: "text" | "number";
  placeholder?: string;
  /** Se pega antes del valor en la pastilla: "$". */
  prefijo?: string;
  /** Se pega después: "%", "pzas". */
  sufijo?: string;
  ayuda?: string;
  /** true ⇒ vacío se pinta como "+ Añadir"; false ⇒ muestra la etiqueta. */
  opcional?: boolean;
  idMovil?: string;
}) {
  const texto = valor ? `${prefijo ?? ""}${valor}${sufijo ? ` ${sufijo}` : ""}` : "";
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      icono={icono}
      vacia={!valor && opcional}
      etiquetaVacia={etiqueta}
      valor={valor ? texto : <span className="text-muted-foreground">{etiqueta}</span>}
      textoValor={texto || undefined}
      ayuda={ayuda}
      contenidoMovil={
        <Campo etiqueta={etiqueta} opcional={opcional} ayuda={ayuda} htmlFor={idMovil}>
          <Input
            id={idMovil}
            type={tipo}
            placeholder={placeholder}
            value={valor}
            onChange={(e) => onCambio(e.target.value)}
          />
        </Campo>
      }
    >
      <EntradaConCierre
        etiqueta={etiqueta}
        tipo={tipo}
        placeholder={placeholder}
        valor={valor}
        onCambio={onCambio}
      />
    </PastillaPropiedad>
  );
}

function EntradaConCierre({
  etiqueta,
  tipo,
  placeholder,
  valor,
  onCambio,
}: {
  etiqueta: string;
  tipo: "text" | "number";
  placeholder?: string;
  valor: string;
  onCambio: (v: string) => void;
}) {
  const cerrar = useCerrarPastilla();
  return (
    <Input
      type={tipo}
      aria-label={etiqueta}
      placeholder={placeholder}
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") cerrar();
      }}
      className="w-48"
    />
  );
}

/* ── Ficha del inventario (SKU con sugerencias) ──────────────────────────── */

/* El SKU se sigue pudiendo teclear libre (hay piezas sin ficha), pero mientras
   se escribe salen las coincidencias del catálogo y la pastilla dice de un
   vistazo si lo capturado quedó ligado a una ficha o no. */
export function PastillaProducto({
  etiqueta = "SKU",
  valor,
  productoId,
  productos,
  onCambio,
  ayuda,
  opcional = true,
  idMovil,
}: {
  etiqueta?: string;
  /** El SKU tecleado. */
  valor: string;
  /** Ficha elegida de la lista, si la hay. */
  productoId: string | null;
  productos: ProductoElegible[];
  /** Al teclear llega (texto, null); al elegir de la lista, (sku, id). */
  onCambio: (sku: string, productoId: string | null) => void;
  ayuda?: string;
  opcional?: boolean;
  idMovil?: string;
}) {
  const ligado = fichaLigada(valor, productoId, productos);
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      vacia={!valor && opcional}
      etiquetaVacia={etiqueta}
      valor={
        <span className="flex items-center gap-1.5">
          {ligado ? (
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
        valor
          ? ligado
            ? `${valor} — ${etiquetaProducto(ligado)}`
            : `${valor} — sin ficha en inventario`
          : undefined
      }
      ayuda={ayuda}
      anchoPopover="w-72"
      contenidoMovil={
        <Campo etiqueta={etiqueta} opcional={opcional} ayuda={ayuda} htmlFor={idMovil}>
          <SelectorProducto
            id={idMovil}
            valor={valor}
            productoId={productoId}
            productos={productos}
            onCambio={onCambio}
          />
        </Campo>
      }
    >
      <ProductoConCierre
        valor={valor}
        productoId={productoId}
        productos={productos}
        onCambio={onCambio}
      />
    </PastillaPropiedad>
  );
}

function ProductoConCierre({
  valor,
  productoId,
  productos,
  onCambio,
}: {
  valor: string;
  productoId: string | null;
  productos: ProductoElegible[];
  onCambio: (sku: string, productoId: string | null) => void;
}) {
  const cerrar = useCerrarPastilla();
  return (
    <SelectorProducto
      valor={valor}
      productoId={productoId}
      productos={productos}
      onCambio={(sku, id) => {
        onCambio(sku, id);
        /* Con id se eligió de la lista: ya está, se cierra como el resto de las
           pastillas. Al teclear llega null y el popover sigue abierto. */
        if (id) cerrar();
      }}
      className="w-full"
    />
  );
}

/* ── Interruptor (activo, bajo pedido, descontinuado…) ───────────────────── */

export function PastillaInterruptor({
  etiqueta,
  icono: Icono,
  valor,
  onCambio,
  color = "#e84393",
}: {
  etiqueta: string;
  icono?: LucideIcon;
  valor: boolean;
  onCambio: (v: boolean) => void;
  /** Color del estado encendido; por defecto el primario. */
  color?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={valor}
      aria-label={etiqueta}
      onClick={() => onCambio(!valor)}
      className={cn(
        "inline-flex h-9 max-w-full shrink-0 items-center gap-1.5 rounded-full border px-3 md:h-7 md:px-2.5",
        "text-[13px] font-medium outline-none transition-colors md:text-[12.5px]",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        valor ? "text-foreground" : "border-dashed text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
      style={valor ? { backgroundColor: `${color}1F`, borderColor: `${color}80` } : undefined}
    >
      {Icono && <Icono className="size-3.5 shrink-0" aria-hidden="true" />}
      <span className="truncate">{etiqueta}</span>
      <span
        className={cn("size-2 shrink-0 rounded-full", !valor && "bg-muted-foreground/40")}
        style={valor ? { backgroundColor: color } : undefined}
        aria-hidden="true"
      />
    </button>
  );
}

/* ── Dato de solo lectura (totales calculados, área automática…) ─────────── */

export function PastillaDato({
  etiqueta,
  valor,
  icono: Icono,
  contenidoMovil,
}: {
  etiqueta: string;
  valor: React.ReactNode;
  icono?: LucideIcon;
  /** El campo que se pinta bajo md:, si el dato también se enseña ahí. */
  contenidoMovil?: React.ReactNode;
}) {
  return (
    <>
      {contenidoMovil && <div className="md:hidden">{contenidoMovil}</div>}
      <span
        title={etiqueta}
        className="hidden h-7 max-w-full shrink-0 items-center gap-1.5 rounded-full border border-transparent bg-muted px-2.5 text-[12.5px] font-medium text-muted-foreground md:inline-flex"
      >
        {Icono && <Icono className="size-3.5 shrink-0" aria-hidden="true" />}
        <span className="max-w-[12rem] truncate">{valor}</span>
      </span>
    </>
  );
}

/* ── Piezas chicas compartidas ───────────────────────────────────────────── */

function AvatarMini({
  nombre,
  color,
  conBorde = false,
}: {
  nombre: string;
  color: string;
  conBorde?: boolean;
}) {
  return (
    <span
      className={cn(
        "flex size-4.5 shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white",
        conBorde && "ring-2 ring-popover",
      )}
      style={{ backgroundColor: color }}
      aria-hidden="true"
    >
      {iniciales(nombre)}
    </span>
  );
}

function primerNombre(nombre: string): string {
  return nombre.trim().split(/\s+/)[0] ?? nombre;
}
