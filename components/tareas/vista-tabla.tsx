"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { AREAS, ESTADOS, PRIORIDADES, obtenerEstado, obtenerPrioridad } from "@/lib/catalogos";
import { esVencida, formatearFecha, formatearFechaHora } from "@/lib/fecha";
import {
  tieneNovedades,
  trabajaLaTarea,
  type TaskConResponsable,
  type EstadoId,
  type PrioridadId,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { AvataresEquipo } from "@/components/tareas/avatares-equipo";
import { ChipsEtiquetas } from "@/components/tareas/filtro-etiquetas";

/* Rejilla de la tabla. Hay cuatro porque dos columnas son condicionales —
   Cliente (solo con tareas de la agencia) y Etiquetas (solo si alguna las
   trae)— y las clases de Tailwind tienen que existir enteras en el código, no
   armarse concatenando. Orden: Tarea · [Cliente] · [Etiquetas] · Responsable ·
   Estado · Prioridad · Fecha · Última actualización. */
const REJILLA = {
  "": {
    cols: "grid-cols-[minmax(160px,1fr)_150px_140px_120px_100px_150px]",
    minW: "min-w-[760px]",
  },
  cliente: {
    cols: "grid-cols-[minmax(160px,1fr)_130px_150px_140px_120px_100px_150px]",
    minW: "min-w-[890px]",
  },
  etiquetas: {
    cols: "grid-cols-[minmax(160px,1fr)_170px_150px_140px_120px_100px_150px]",
    minW: "min-w-[930px]",
  },
  "cliente+etiquetas": {
    cols: "grid-cols-[minmax(160px,1fr)_130px_170px_150px_140px_120px_100px_150px]",
    minW: "min-w-[1060px]",
  },
} as const;

function PastillaEstado({ estado }: { estado: string }) {
  const e = obtenerEstado(estado);
  if (!e) return null;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold text-white"
      style={{ backgroundColor: e.color }}
    >
      {e.nombre}
    </span>
  );
}

function Prioridad({ prioridad }: { prioridad: string }) {
  const p = obtenerPrioridad(prioridad);
  if (!p) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-sm">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: p.color }} />
      {p.nombre}
    </span>
  );
}

export function VistaTabla({
  tareas,
  currentUserId,
  gestor,
  puedeEditar,
  onAbrir,
  onMoverEstado,
  onCambiarPrioridad,
  checklistPorTarea,
}: {
  tareas: TaskConResponsable[];
  currentUserId: string;
  gestor: boolean;
  /* ¿Manda sobre esta tarea en concreto? (gestor, o quien la creó). Llega como
     función porque depende de la fila, no solo del rol. */
  puedeEditar: (t: TaskConResponsable) => boolean;
  onAbrir: (t: TaskConResponsable) => void;
  onMoverEstado: (id: string, estado: EstadoId) => void;
  onCambiarPrioridad: (id: string, prioridad: PrioridadId) => void;
  checklistPorTarea?: Record<string, { total: number; hechos: number }>;
}) {
  const [colapsados, setColapsados] = useState<Set<string>>(new Set());
  function toggle(areaId: string) {
    setColapsados((prev) => {
      const s = new Set(prev);
      if (s.has(areaId)) s.delete(areaId);
      else s.add(areaId);
      return s;
    });
  }

  const grupos = AREAS.map((a) => ({ area: a, items: tareas.filter((t) => t.area === a.id) })).filter(
    (g) => g.items.length > 0,
  );

  if (grupos.length === 0) {
    return <p className="text-sm italic text-muted-foreground">No hay tareas para mostrar.</p>;
  }

  /* Columnas condicionales: una columna que sale vacía en todos los renglones
     solo estrecha a las demás. */
  const hayCliente = tareas.some((t) => t.espacio === "agencia");
  const hayEtiquetas = tareas.some((t) => (t.etiquetas ?? []).length > 0);
  const rejilla =
    REJILLA[
      (hayCliente && hayEtiquetas
        ? "cliente+etiquetas"
        : hayCliente
          ? "cliente"
          : hayEtiquetas
            ? "etiquetas"
            : "") as keyof typeof REJILLA
    ];

  const columnas: Columna<TaskConResponsable>[] = [
    {
      clave: "tarea",
      label: "Tarea",
      esTitulo: true,
      celda: (t) => {
        const chk = checklistPorTarea?.[t.id];
        return (
          <div className="flex min-w-0 items-center gap-2">
            {tieneNovedades(t) && (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                title="Hay algo nuevo desde la última vez que la abriste"
                aria-label="Con novedades"
              />
            )}
            <button
              type="button"
              onClick={() => onAbrir(t)}
              className="truncate text-left font-medium hover:underline"
              title={t.titulo}
            >
              {t.titulo}
            </button>
            {chk && chk.total > 0 && (
              <span
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground"
                title="Subtareas completadas"
              >
                ☑ {chk.hechos}/{chk.total}
              </span>
            )}
          </div>
        );
      },
    },
    /* Cliente: solo cuando lo que se lista trae tareas de la agencia. En el
       tablero de Fresafit sería una columna vacía en todos los renglones. */
    ...(hayCliente
      ? [
          {
            clave: "cliente",
            label: "Cliente",
            celda: (t: TaskConResponsable) =>
              t.empresa ? (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                  style={{ backgroundColor: `${t.empresa.color}1f`, color: t.empresa.color }}
                >
                  {t.empresa.nombre}
                </span>
              ) : (
                <span className="text-[12px] text-muted-foreground">De la agencia</span>
              ),
          },
        ]
      : []),
    /* Etiquetas: el mismo dato que ya se veía en las tarjetas del tablero,
       ahora también aquí, que es donde se revisa el trabajo de corrido. */
    ...(hayEtiquetas
      ? [
          {
            clave: "etiquetas",
            label: "Etiquetas",
            /* En la tarjeta del teléfono ocupan el renglón entero: en media
               columna los chips se apilan de uno en uno. */
            cardAncho: true,
            celda: (t: TaskConResponsable) => <ChipsEtiquetas ids={t.etiquetas} />,
          },
        ]
      : []),
    {
      clave: "responsable",
      label: "Responsable",
      celda: (t) => (
        <AvataresEquipo tarea={t} tamano="md" className="justify-end md:justify-start" />
      ),
    },
    {
      clave: "estado",
      label: "Estado",
      /* Editable en celda si trabaja la tarea, la creó o es gestor. */
      celda: (t) =>
        gestor || puedeEditar(t) || trabajaLaTarea(t, currentUserId) ? (
          <Select value={t.estado} onValueChange={(v) => v && onMoverEstado(t.id, v as EstadoId)}>
            <SelectTrigger className="ml-auto h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 md:ml-0">
              <PastillaEstado estado={t.estado} />
            </SelectTrigger>
            <SelectContent>
              {ESTADOS.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <PastillaEstado estado={t.estado} />
        ),
    },
    {
      clave: "prioridad",
      label: "Prioridad",
      /* Editable en celda por quien manda en la tarea (gestor o quien la creó). */
      celda: (t) =>
        puedeEditar(t) ? (
          <Select value={t.prioridad} onValueChange={(v) => v && onCambiarPrioridad(t.id, v as PrioridadId)}>
            <SelectTrigger className="ml-auto h-auto w-fit gap-1 border-0 bg-transparent p-0 shadow-none focus-visible:ring-0 md:ml-0">
              <Prioridad prioridad={t.prioridad} />
            </SelectTrigger>
            <SelectContent>
              {PRIORIDADES.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <Prioridad prioridad={t.prioridad} />
        ),
    },
    {
      clave: "fecha",
      label: "Fecha",
      celda: (t) => {
        const vencida = esVencida(t.fecha_limite, t.estado);
        return t.fecha_limite ? (
          <span className={cn("inline-flex items-center gap-1", vencida && "font-semibold text-red-600")}>
            {vencida && <AlertTriangle className="size-3.5" aria-label="Vencida" />}
            {formatearFecha(t.fecha_limite)}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        );
      },
    },
    {
      /* Cuándo se movió por última vez, contando comentarios e historial. Es lo
         que Armando quería ver "desde fuera", sin abrir cada tarea. */
      clave: "actividad",
      label: "Última actualización",
      celda: (t) =>
        t.ultima_actividad_at ? (
          <span
            className={cn("text-[13px]", tieneNovedades(t) && "font-semibold text-foreground")}
            title={new Date(t.ultima_actividad_at).toLocaleString("es-MX", {
              timeZone: "America/Mexico_City",
            })}
          >
            {formatearFechaHora(t.ultima_actividad_at)}
          </span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        ),
    },
  ];

  /* Una TablaSimple por área; el rótulo de cada una es el encabezado de grupo
     clicable (colapsa/expande ocultando sus filas). */
  return (
    <div className="flex flex-col gap-4">
      {grupos.map(({ area, items }) => {
        const cerrado = colapsados.has(area.id);
        return (
          <TablaSimple
            key={area.id}
            cols={rejilla.cols}
            minW={rejilla.minW}
            columnas={columnas}
            datos={items}
            filaKey={(t) => t.id}
            /* Toda la fila abre la tarea: apuntarle al título era innecesariamente
               fino, sobre todo en tablet. Los controles de la fila (los selects de
               estado y prioridad) siguen funcionando: TablaSimple ignora el clic
               cuando cae sobre un control. */
            onRowClick={onAbrir}
            titulo={
              <button
                type="button"
                onClick={() => toggle(area.id)}
                className="flex w-full items-center gap-2.5 text-left normal-case tracking-normal"
              >
                {cerrado ? (
                  <ChevronRight className="size-3.5 text-muted-foreground" />
                ) : (
                  <ChevronDown className="size-3.5 text-muted-foreground" />
                )}
                <span className="inline-block size-2 rounded-[3px]" style={{ backgroundColor: area.color }} />
                <span className="text-[13.5px] font-bold text-foreground">{area.nombre}</span>
                <span className="rounded-full bg-muted px-2 text-xs font-semibold text-muted-foreground">
                  {items.length}
                </span>
              </button>
            }
            filaClassName={() => (cerrado ? "hidden" : "")}
          />
        );
      })}
    </div>
  );
}
