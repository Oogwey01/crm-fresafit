"use client";

import { useOptimistic, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { AlertTriangle, ChevronDown, Clapperboard, Clock, Info, List, LayoutGrid, Calendar as CalendarIcon, Plus } from "lucide-react";
import { toast } from "sonner";
import { ESTADOS, AREAS, ROLES, esGestor, esInterno } from "@/lib/catalogos";
import { esVencida } from "@/lib/fecha";
import {
  moverTarea,
  cambiarPrioridad,
  reasignarTarea,
  reasignarEmpresa,
} from "@/app/(app)/tareas/actions";
import { type TaskConResponsable, type Profile, type EstadoId, type EspacioId, type PrioridadId, type RolId, type AgenciaEmpresa } from "@/lib/types";
import { trabajaLaTarea, mandaEnLaTarea } from "@/lib/tareas/reglas";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { Column } from "@/components/tareas/columna";
import { TaskCard } from "@/components/tareas/tarjeta-tarea";
import { TaskDialog, type TaskInicial } from "@/components/tareas/dialogo-tarea";

/* Plantilla "pedir gráfico para el live": lo que el encargado de TikTok le
   encarga a diseño antes de cada live. La descripción es el checklist de lo que
   el diseñador necesita saber para no ir y venir preguntando; se llena antes de
   guardar y todo sigue siendo editable. */
const PLANTILLA_GRAFICO_LIVE: TaskInicial = {
  titulo: "Gráfico para el live de TikTok",
  descripcion: [
    "Qué se anuncia (producto u oferta flash): ",
    "Texto que lleva (precio, descuento, gancho): ",
    "Dónde se usa (overlay del live, fondo, aviso en redes): ",
    "Cuándo es el live: ",
    "Referencias o assets: ",
  ].join("\n"),
  area: "diseno",
  etiquetas: ["grafico", "live"],
};
import { TaskFilters } from "@/components/tareas/filtros-tarea";
import { FiltroEtiquetas } from "@/components/tareas/filtro-etiquetas";
import { CargaPersonas } from "@/components/tareas/carga-personas";
import { ExportButton } from "@/components/tareas/boton-exportar";
import { VistaTabla } from "@/components/tareas/vista-tabla";
import { VistaCalendario } from "@/components/tareas/vista-calendario";
import { VistaMovil } from "@/components/tareas/vista-movil";
import { ImportarTareas } from "@/components/tareas/importar";
import { Papelera } from "@/components/tareas/papelera";
import { MotivoAtoradoDialog } from "@/components/tareas/motivo-atorado-dialog";

/* Carril del tablero cuando se agrupa (por área, por persona o por cliente). */
type Grupo = { id: string; nombre: string; color: string; tareas: TaskConResponsable[] };

/* Alcance global: "mis" = lo asignado a mí; "delegadas" = lo que yo delegué a
   otros; "todas" = todo. Aplica en las TRES vistas. */
type Alcance = "mis" | "delegadas" | "todas";
type VistaTop = "tabla" | "tablero" | "calendario";
/* En la agencia el trabajo se piensa por cliente, así que el tablero gana un
   tercer eje que en Fresafit no tendría sentido (no hay clientes que agrupar). */
type Eje = "area" | "persona" | "empresa";

const SIN_EMPRESA = "sin-empresa";

const VISTAS_TOP = [
  ["tabla", "Tabla", List],
  ["tablero", "Tablero", LayoutGrid],
  ["calendario", "Calendario", CalendarIcon],
] as const;

export function Board({
  tareas: inicial,
  borradas = [],
  equipo,
  currentUserId,
  rol,
  checklistPorTarea = {},
  espacio = "fresafit",
  empresas = [],
}: {
  tareas: TaskConResponsable[];
  borradas?: TaskConResponsable[];
  equipo: Profile[];
  currentUserId: string;
  rol: RolId;
  /* {task_id: {total, hechos}} para el chip de subtareas en las tarjetas. */
  checklistPorTarea?: Record<string, { total: number; hechos: number }>;
  /* De qué negocio es este tablero. El mismo componente sirve a los dos: lo
     único que cambia es que la agencia trabaja por cliente. */
  espacio?: EspacioId;
  /* Clientes de la agencia (vacío en Fresafit). */
  empresas?: Pick<AgenciaEmpresa, "id" | "nombre" | "color">[];
}) {
  const gestor = esGestor(rol);
  const esAgencia = espacio === "agencia";
  /* Abrir tareas es de todo el equipo de casa; `externo` solo ve lo que se le
     comparte y no tiene nada que crear. */
  const puedeCrear = esInterno(rol);
  /* ¿Manda sobre ESTA tarea? Gestor en todo el tablero, o quien la creó sobre
     la suya. Se pasa como función a las vistas para no repartirles el rol. */
  const manda = (t: TaskConResponsable) => mandaEnLaTarea(t, rol, currentUserId);

  /* "Delegadas por mí" es para quien delega — que ahora es cualquiera del
     equipo, no solo quien coordina: si un miembro abre una tarea y se la pasa a
     otro, ese es justo el filtro con el que le da seguimiento. */
  const opcionesAlcance: [Alcance, string][] = puedeCrear
    ? [
        ["mis", "Mis tareas"],
        ["delegadas", "Delegadas por mí"],
        ["todas", "Todas"],
      ]
    : [
        ["mis", "Mis tareas"],
        ["todas", "Todas"],
      ];

  /* El eje "Cliente" solo existe en la agencia; en Fresafit no hay clientes que
     agrupar y sería una pestaña muerta. */
  const ejesAgrupacion: [Eje, string][] = esAgencia
    ? [
        ["empresa", "Cliente"],
        ["area", "Área"],
        ["persona", "Persona"],
      ]
    : [
        ["area", "Área"],
        ["persona", "Persona"],
      ];

  /* Parche optimista genérico: mover de estado y/o reasignar responsable. */
  const [tareas, aplicarMovimiento] = useOptimistic(
    inicial,
    (estado, m: { id: string; patch: Partial<TaskConResponsable> }) =>
      estado.map((t) => (t.id === m.id ? { ...t, ...m.patch } : t)),
  );

  const [vistaTop, setVistaTop] = useState<VistaTop>("tabla");
  /* En la agencia el eje natural es el cliente, no el área: la pregunta de todos
     los días es «¿qué traemos de Nutravia?». */
  const [ejeAgrupacion, setEjeAgrupacion] = useState<Eje>(esAgencia ? "empresa" : "area");
  const [alcance, setAlcance] = useState<Alcance>("todas");
  const [filtroResponsable, setFiltroResponsable] = useState("todos");
  const [filtroArea, setFiltroArea] = useState("todas");
  const [filtroEmpresa, setFiltroEmpresa] = useState("todas");
  /* "Quién te puso la tarea" (created_by). Aplica en cualquier alcance. */
  const [filtroAsignador, setFiltroAsignador] = useState("todos");
  /* Etiquetas marcadas (vacío = no filtra). Vive aquí, y no dentro de cada
     vista, para que valga igual en tabla, tablero, calendario y teléfono. */
  const [filtroEtiquetas, setFiltroEtiquetas] = useState<string[]>([]);
  const [soloVencidas, setSoloVencidas] = useState(false);
  const [ordenActividad, setOrdenActividad] = useState(false);
  const [, startTransition] = useTransition();

  const [nuevaAbierta, setNuevaAbierta] = useState(false);
  /* Prellenado de la tarea nueva cuando se abre desde una plantilla. */
  const [plantilla, setPlantilla] = useState<TaskInicial | null>(null);
  /* Abrir una tarea NAVEGA a su página. Antes era un pop-up montado aquí; se
     cambió porque Armando quería "abrir la tarea y que no sea un pop-up", y de
     paso la tarea gana una URL propia que se puede compartir y a la que pueden
     apuntar los avisos de la campana. */
  const router = useRouter();
  const abrirTarea = (t: TaskConResponsable) => router.push(`/tareas/${t.id}`);
  const [activeId, setActiveId] = useState<string | null>(null);
  /* Tarea en espera de motivo para atorarse (abre MotivoAtoradoDialog). */
  const [atorarPendiente, setAtorarPendiente] = useState<{ id: string; motivoInicial: string } | null>(null);

  /* Tablero agrupado por área: los temas arrancan COLAPSADOS (guardamos las
     áreas ABIERTAS; conjunto vacío = todo colapsado). */
  const [areasAbiertas, setAreasAbiertas] = useState<Set<string>>(new Set());
  function alternarArea(areaId: string) {
    setAreasAbiertas((prev) => {
      const next = new Set(prev);
      if (next.has(areaId)) next.delete(areaId);
      else next.add(areaId);
      return next;
    });
  }

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  function ejecutarMover(id: string, nuevoEstado: EstadoId, motivo: string | null) {
    startTransition(async () => {
      aplicarMovimiento({
        id,
        patch: { estado: nuevoEstado, motivo_atorado: nuevoEstado === "atorado" ? motivo : null },
      });
      try {
        const r = await moverTarea(id, nuevoEstado, motivo);
        if ("error" in r) toast.error("No se pudo mover: " + r.error);
      } catch {
        toast.error("No se pudo mover la tarea. Revisa tu conexión.");
      }
    });
  }

  function mover(id: string, nuevoEstado: EstadoId) {
    const actual = tareas.find((t) => t.id === id);
    if (!actual || actual.estado === nuevoEstado) return;
    /* Al atorar se pide el motivo (qué se necesita de vuelta) con un diálogo de la
       app; le llega un aviso a quien delegó la tarea. */
    if (nuevoEstado === "atorado") {
      setAtorarPendiente({ id, motivoInicial: actual.motivo_atorado ?? "" });
      return;
    }
    ejecutarMover(id, nuevoEstado, null);
  }

  /* Reasignar arrastrando entre carriles de persona (solo gestor). */
  function reasignar(id: string, responsableId: string | null) {
    const actual = tareas.find((t) => t.id === id);
    if (!actual || actual.responsable_id === responsableId) return;
    if (!manda(actual)) {
      toast.error("Solo dirección, coordinación o quien creó la tarea puede reasignarla.");
      return;
    }
    const perfil = responsableId
      ? (equipo.find((p) => p.id === responsableId) ?? null)
      : null;
    startTransition(async () => {
      aplicarMovimiento({
        id,
        patch: {
          responsable_id: responsableId,
          responsable: perfil ? { id: perfil.id, nombre: perfil.nombre, color: perfil.color } : null,
        },
      });
      try {
        const r = await reasignarTarea(id, responsableId);
        if ("error" in r) toast.error(r.error);
      } catch {
        toast.error("No se pudo reasignar. Revisa tu conexión.");
      }
    });
  }

  /* Mover una tarea de cliente arrastrándola entre carriles (solo gestor). */
  function cambiarEmpresa(id: string, empresaId: string | null) {
    const actual = tareas.find((t) => t.id === id);
    if (!actual || (actual.empresa_id ?? null) === empresaId) return;
    if (!manda(actual)) {
      toast.error("Solo dirección, coordinación o quien creó la tarea puede cambiarla de cliente.");
      return;
    }
    const empresa = empresaId ? (empresas.find((e) => e.id === empresaId) ?? null) : null;
    startTransition(async () => {
      aplicarMovimiento({ id, patch: { empresa_id: empresaId, empresa } });
      try {
        const r = await reasignarEmpresa(id, empresaId);
        if ("error" in r) toast.error(r.error);
      } catch {
        toast.error("No se pudo cambiar de cliente. Revisa tu conexión.");
      }
    });
  }

  /* Cambio rápido de prioridad desde una celda (solo gestor; sin optimismo, se
     refresca al revalidar). */
  function cambiarPrio(id: string, prioridad: PrioridadId) {
    startTransition(async () => {
      try {
        const r = await cambiarPrioridad(id, prioridad);
        if ("error" in r) toast.error(r.error);
      } catch {
        toast.error("No se pudo cambiar la prioridad.");
      }
    });
  }

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveId(null);
    const { active, over } = e;
    if (!over) return;
    const id = String(active.id);
    const raw = String(over.id);
    const [prefijo, sufijo] = raw.includes("::") ? raw.split("::") : [null, raw];
    const estado = sufijo as EstadoId;
    if (!ESTADOS.some((es) => es.id === estado)) return;
    mover(id, estado);
    // En carriles por persona el prefijo es el id del responsable destino
    // ("sin" = sin asignar): además de mover, reasigna.
    if (ejeAgrupacion === "persona" && prefijo !== null) {
      reasignar(id, prefijo === "sin" ? null : prefijo);
    }
    // Y en carriles por cliente, el prefijo es la empresa destino: arrastrar una
    // tarjeta de un cliente a otro la cambia de cuenta.
    if (ejeAgrupacion === "empresa" && prefijo !== null) {
      cambiarEmpresa(id, prefijo === SIN_EMPRESA ? null : prefijo);
    }
  }

  const activa = activeId ? tareas.find((t) => t.id === activeId) : null;

  /* Quiénes han delegado alguna de las tareas visibles: ofrecer el equipo entero
     llenaría el Select de gente que nunca ha asignado nada. */
  const asignadores = equipo.filter((p) => tareas.some((t) => t.created_by === p.id));

  /* Conjunto base según el alcance: "mis" ignora los filtros de persona/área
     (es estrictamente lo asignado a mí); "todas" aplica ambos filtros. */
  const porAlcance =
    alcance === "mis"
      ? tareas.filter((t) => trabajaLaTarea(t, currentUserId))
      : alcance === "delegadas"
        ? tareas.filter((t) => t.created_by === currentUserId)
        : tareas.filter(
            (t) =>
              (filtroResponsable === "todos" || trabajaLaTarea(t, filtroResponsable)) &&
              (filtroArea === "todas" || t.area === filtroArea),
          );

  /* Quién te puso la tarea. A diferencia de los de persona/área, éste aplica en
     TODOS los alcances: el caso que lo motivó es «en mis tareas, enséñame solo
     las que me puso René». "Delegadas por mí" es el caso inverso y ya existía. */
  const porAsignador =
    filtroAsignador === "todos"
      ? porAlcance
      : porAlcance.filter((t) => t.created_by === filtroAsignador);

  /* El cliente filtra en CUALQUIER alcance, igual que el asignador: «de mis
     tareas, enséñame solo las de Bart Jerseys» es la consulta más común de quien
     atiende a dos cuentas a la vez. */
  const porEmpresa =
    filtroEmpresa === "todas"
      ? porAsignador
      : porAsignador.filter((t) =>
          filtroEmpresa === SIN_EMPRESA ? !t.empresa_id : t.empresa_id === filtroEmpresa,
        );

  /* Etiquetas: la tarea entra si tiene ALGUNA de las marcadas (ver
     FiltroEtiquetas). También sirve en cualquier alcance — «de mis tareas,
     enséñame solo las de Bodega» es exactamente para lo que se pidió. */
  const base =
    filtroEtiquetas.length === 0
      ? porEmpresa
      : porEmpresa.filter((t) => (t.etiquetas ?? []).some((e) => filtroEtiquetas.includes(e)));

  /* Contador de vencidas sobre lo mostrado (antes del filtro "solo vencidas"). */
  const vencidas = base.filter((t) => esVencida(t.fecha_limite, t.estado)).length;

  /* Filtro rápido "solo vencidas" (se alterna con clic en el contador).
     `filtradas` alimenta las TRES vistas: tabla, calendario y tablero. */
  const porVencidas = soloVencidas
    ? base.filter((t) => esVencida(t.fecha_limite, t.estado))
    : base;

  /* Orden por movimiento reciente: "¿qué se movió hoy?" — lo que pidió Armando
     para poder revisar por últimos comentarios. El orden natural (por creación)
     sigue siendo el de por defecto porque es el que respeta el arrastre. */
  const filtradas = ordenActividad
    ? [...porVencidas].sort((a, b) =>
        (b.ultima_actividad_at ?? b.created_at).localeCompare(a.ultima_actividad_at ?? a.created_at),
      )
    : porVencidas;
  /* Carriles del tablero agrupado. Por ÁREA: las áreas con tareas (respetando el
     filtro). Por PERSONA: cada responsable con tareas + un carril "Sin asignar".

     Los carriles de persona van por responsable PRINCIPAL, no por todo el equipo
     de la tarea: repetir la misma tarjeta en varios carriles le daría dos veces
     el mismo id de arrastre a dnd-kit y rompería el drag. Quién más la trabaja se
     ve en los avatares de la tarjeta, y el filtro de persona sí toma en cuenta a
     los acompañantes. */
  const grupos: Grupo[] =
    ejeAgrupacion === "empresa"
      ? (() => {
          const conCliente: Grupo[] = empresas
            .map((e) => ({
              id: e.id,
              nombre: e.nombre,
              color: e.color,
              tareas: filtradas.filter((t) => t.empresa_id === e.id),
            }))
            .filter((g) => g.tareas.length > 0);
          /* Lo que no es de ningún cliente es trabajo de la casa: juntas,
             prospección, cobranza. Va al final y solo si existe. */
          const internas = filtradas.filter((t) => !t.empresa_id);
          return internas.length
            ? [
                ...conCliente,
                { id: SIN_EMPRESA, nombre: "De la agencia", color: "#94a3b8", tareas: internas },
              ]
            : conCliente;
        })()
      : ejeAgrupacion === "area"
      ? AREAS.filter(
          (a) => (filtroArea === "todas" || a.id === filtroArea) && filtradas.some((t) => t.area === a.id),
        ).map((a) => ({
          id: a.id,
          nombre: a.nombre,
          color: a.color,
          tareas: filtradas.filter((t) => t.area === a.id),
        }))
      : (() => {
          const conResp: Grupo[] = equipo
            .map((p) => ({
              id: p.id,
              nombre: p.nombre,
              color: p.color,
              tareas: filtradas.filter((t) => t.responsable_id === p.id),
            }))
            .filter((g) => g.tareas.length > 0);
          const sin = filtradas.filter((t) => !t.responsable_id);
          return sin.length
            ? [...conResp, { id: "sin", nombre: "Sin asignar", color: "#94a3b8", tareas: sin }]
            : conResp;
        })();

  const rolNombre = ROLES.find((r) => r.id === rol)?.nombre ?? "Miembro";

  return (
    <div>
      {/* ===== MÓVIL: lista agrupada por área (diseño Claude Design) ===== */}
      <div className="md:hidden">
        <VistaMovil
          tareas={tareas}
          currentUserId={currentUserId}
          puedeCrear={puedeCrear}
          rol={rol}
          alcance={alcance}
          setAlcance={setAlcance}
          soloVencidas={soloVencidas}
          setSoloVencidas={setSoloVencidas}
          filtroEtiquetas={filtroEtiquetas}
          setFiltroEtiquetas={setFiltroEtiquetas}
          onAbrir={abrirTarea}
          onNueva={() => {
            setPlantilla(null);
            setNuevaAbierta(true);
          }}
          checklistPorTarea={checklistPorTarea}
          titulo={esAgencia ? "Tareas de la Agencia" : undefined}
          empresas={esAgencia ? empresas : undefined}
        />
      </div>

      {/* ===== ESCRITORIO: barra de herramientas + vistas tabla/tablero/calendario ===== */}
      <div className="hidden md:block">
      {/* Encabezado: título a la izquierda, acciones principales a la derecha */}
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:flex-wrap md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-tight">
            {esAgencia ? "Tareas de la Agencia" : "Tareas del equipo"}
          </h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            {esAgencia
              ? "Lo que traemos de cada cliente — separado de lo de Fresafit."
              : "Quién hace qué y en qué va cada cosa — sin perseguir a nadie."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ExportButton tareas={filtradas} gestor={gestor} />
          {gestor && (
            <ImportarTareas
              equipo={equipo}
              espacio={espacio}
              empresaId={
                esAgencia && filtroEmpresa !== "todas" && filtroEmpresa !== SIN_EMPRESA
                  ? filtroEmpresa
                  : null
              }
            />
          )}
          {/* La papelera la ve todo el equipo: RLS ya la acota a las tareas de
              cada quien, y ahora que un miembro puede borrar las suyas también
              necesita poder sacarlas de ahí. */}
          {puedeCrear && <Papelera borradas={borradas} />}
          {/* Atajo pedido por TikTok: la tarea de "gráfico para el live" nace ya
              armada (área diseño, etiquetas, checklist en la descripción). */}
          {puedeCrear && !esAgencia && (
            <Button
              variant="outline"
              onClick={() => {
                setPlantilla(PLANTILLA_GRAFICO_LIVE);
                setNuevaAbierta(true);
              }}
              className="h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold"
              title="Crea la tarea ya armada para pedirle a diseño un gráfico del live"
            >
              <Clapperboard className="size-4" strokeWidth={2.1} />
              Gráfico para live
            </Button>
          )}
          {puedeCrear && (
            <Button
              onClick={() => {
                setPlantilla(null);
                setNuevaAbierta(true);
              }}
              className="h-auto gap-1.5 rounded-[11px] px-[17px] py-2.5 text-[13.5px] font-semibold shadow-[0_6px_16px_-8px_rgba(232,67,147,0.7)]"
            >
              <Plus className="size-4" strokeWidth={2.1} />
              Nueva tarea
            </Button>
          )}
        </div>
      </div>

      {/* Barra de herramientas: filtros/vistas a la izquierda, filtros de persona/área a la derecha */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Contador de vencidas — clic para ver SOLO las vencidas (alterna). */}
        {(vencidas > 0 || soloVencidas) && (
          <button
            type="button"
            onClick={() => setSoloVencidas((v) => !v)}
            aria-pressed={soloVencidas}
            title="Ver solo las tareas vencidas (clic para alternar)"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-bold transition-colors",
              soloVencidas
                ? "bg-red-600 text-white"
                : "bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-950 dark:text-red-300 dark:hover:bg-red-900",
            )}
          >
            <AlertTriangle className="size-4" aria-hidden="true" />
            {vencidas} {vencidas === 1 ? "vencida" : "vencidas"}
          </button>
        )}

        {/* Alcance global: Mis tareas / Delegadas por mí / Todas — aplica en las TRES vistas. */}
        <ControlSegmentado opciones={opcionesAlcance} valor={alcance} onCambio={setAlcance} />

        {/* Selector de vista principal: Tabla / Tablero / Calendario.
            No usa ControlSegmentado: cada opción lleva icono + rótulo que se
            oculta en móvil, no una etiqueta simple. */}
        <div className="inline-flex rounded-lg bg-muted p-0.5">
          {VISTAS_TOP.map(([id, label, Icono]) => (
            <button
              key={id}
              onClick={() => setVistaTop(id)}
              aria-label={label}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                vistaTop === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
              )}
            >
              <Icono className="size-3.5" strokeWidth={1.8} />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Eje de agrupación del TABLERO: por área o por persona (solo tablero + Todas). */}
        {vistaTop === "tablero" && alcance === "todas" && (
          <div className="inline-flex items-center gap-1.5 rounded-lg bg-muted p-0.5 pl-2.5">
            <span className="text-xs font-medium text-muted-foreground">Agrupar:</span>
            {ejesAgrupacion.map(([id, label]) => (
              <button
                key={id}
                onClick={() => setEjeAgrupacion(id)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  ejeAgrupacion === id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        <div className="flex-1" />

        {/* Filtro de CLIENTE (solo agencia): sirve en cualquier alcance. */}
        {esAgencia && empresas.length > 0 && (
          <Select value={filtroEmpresa} onValueChange={(v) => setFiltroEmpresa(v ?? "todas")}>
            <SelectTrigger className="w-full bg-card sm:w-[180px]">
              <SelectValue>
                {(value: string) =>
                  value === "todas"
                    ? "Todos los clientes"
                    : value === SIN_EMPRESA
                      ? "De la agencia"
                      : (empresas.find((e) => e.id === value)?.nombre ?? "Cliente")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todas">Todos los clientes</SelectItem>
              {empresas.map((e) => (
                <SelectItem key={e.id} value={e.id}>
                  {e.nombre}
                </SelectItem>
              ))}
              <SelectItem value={SIN_EMPRESA}>De la agencia (sin cliente)</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* Filtros de PERSONA y ÁREA — solo con alcance "Todas" ("mis" ya es lo mío). */}
        {alcance === "todas" && (
          <>
            <Select value={filtroResponsable} onValueChange={(v) => setFiltroResponsable(v ?? "todos")}>
              <SelectTrigger className="w-full bg-card sm:w-[190px]">
                <SelectValue>
                  {(value: string) =>
                    value === "todos"
                      ? "Todas las personas"
                      : (equipo.find((p) => p.id === value)?.nombre ?? "Persona")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas las personas</SelectItem>
                {equipo.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <TaskFilters filtroArea={filtroArea} setFiltroArea={setFiltroArea} />
          </>
        )}

        {/* Quién te asignó la tarea. A diferencia de los dos de arriba, sirve en
            cualquier alcance: el caso real es filtrar MIS tareas por quien me
            las puso. Solo se ofrecen las personas que efectivamente delegaron. */}
        {asignadores.length > 1 && (
          <Select value={filtroAsignador} onValueChange={(v) => setFiltroAsignador(v ?? "todos")}>
            <SelectTrigger className="w-full bg-card sm:w-[200px]">
              <SelectValue>
                {(value: string) =>
                  value === "todos"
                    ? "Quien sea que asignó"
                    : `De ${equipo.find((p) => p.id === value)?.nombre ?? "?"}`}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Quien sea que asignó</SelectItem>
              {asignadores.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  De {p.nombre}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* Filtro por ETIQUETA — sirve en cualquier alcance y en las tres vistas.
            Cuenta sobre `porEmpresa` (todo lo demás ya aplicado, esto todavía
            no) para que los números de cada etiqueta digan lo que se ve. */}
        <FiltroEtiquetas
          tareas={porEmpresa}
          seleccionadas={filtroEtiquetas}
          onCambiar={setFiltroEtiquetas}
        />

        {/* Orden por movimiento reciente. */}
        <button
          type="button"
          onClick={() => setOrdenActividad((v) => !v)}
          aria-pressed={ordenActividad}
          title="Ordena por lo que se movió más recientemente (comentarios incluidos)"
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-lg border px-3 text-[13px] font-semibold transition-colors",
            ordenActividad
              ? "border-primary bg-primary/10 text-primary"
              : "bg-card text-muted-foreground hover:text-foreground",
          )}
        >
          <Clock className="size-4" strokeWidth={1.9} aria-hidden="true" />
          Novedades
        </button>
      </div>

      {/* Aviso de rol — es el rol REAL del usuario; la seguridad se aplica en la BD (RLS). */}
      <div className="mb-4 flex items-center gap-2.5 rounded-xl border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        <Info className="size-[17px] shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <span>
          Tu acceso: <b className="font-semibold text-foreground">{rolNombre}</b> — tu rol real; los
          permisos se aplican en la base de datos (RLS), no solo en pantalla.{" "}
          {ROLES.find((r) => r.id === rol)?.desc}
        </span>
      </div>

      {/* Carga por persona (chips clicables = atajo de filtro "solo [persona]").
          Elegir a alguien cambia el alcance a "Todas" (el filtro vive ahí). */}
      <CargaPersonas
        tareas={tareas}
        equipo={equipo}
        seleccion={alcance === "todas" ? filtroResponsable : "todos"}
        onSeleccionar={(id) => {
          setAlcance("todas");
          setFiltroResponsable(id);
        }}
      />

      {/* ---- Vista TABLA ---- */}
      {vistaTop === "tabla" && (
        <VistaTabla
          tareas={filtradas}
          currentUserId={currentUserId}
          gestor={gestor}
          puedeEditar={manda}
          onAbrir={abrirTarea}
          onMoverEstado={mover}
          onCambiarPrioridad={cambiarPrio}
          checklistPorTarea={checklistPorTarea}
        />
      )}

      {/* ---- Vista CALENDARIO ---- */}
      {vistaTop === "calendario" && <VistaCalendario tareas={filtradas} onAbrir={abrirTarea} />}

      {/* ---- Vista TABLERO (kanban) ---- */}
      {vistaTop === "tablero" && (
      /* id fijo: evita el aviso de hidratación de dnd-kit (aria-describedby
          DndDescribedBy-0 vs -1) al hacer estable el id entre servidor y navegador. */
      <DndContext id={`tablero-${espacio}`} sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        {alcance === "mis" ? (
          <>
            {filtradas.length === 0 && (
              <p className="mb-3 text-sm italic text-muted-foreground">
                {filtroEtiquetas.length > 0
                  ? "Ninguna de tus tareas lleva esas etiquetas."
                  : "No tienes tareas asignadas por ahora."}
              </p>
            )}
            {/* Móvil: carril horizontal con snap (columnas lado a lado). Escritorio: grid. */}
            <div className="-mx-4 flex snap-x snap-mandatory items-start gap-4 overflow-x-auto px-4 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-5">
              {ESTADOS.map((estado) => (
                <div key={estado.id} className="w-[85%] shrink-0 snap-start md:w-auto">
                  <Column
                    estadoId={estado.id}
                    nombre={estado.nombre}
                    tareas={filtradas.filter((t) => t.estado === estado.id)}
                    onMover={mover}
                    onEditar={abrirTarea}
                    checklistPorTarea={checklistPorTarea}
                  />
                </div>
              ))}
            </div>
          </>
        ) : grupos.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            No hay tareas para mostrar con estos filtros.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {/* Encabezado de columnas (una vez, arriba) — solo si hay algún carril abierto */}
            {grupos.some((g) => areasAbiertas.has(g.id)) && (
              <div className="hidden gap-4 xl:grid xl:grid-cols-5">
                {ESTADOS.map((e) => (
                  <div key={e.id} className="px-1 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {e.nombre}
                  </div>
                ))}
              </div>
            )}

            {grupos.map((g) => {
              const abierta = areasAbiertas.has(g.id);
              return (
                <div key={g.id}>
                  <button
                    type="button"
                    onClick={() => alternarArea(g.id)}
                    aria-expanded={abierta}
                    className="mb-2 flex w-full items-center gap-2"
                  >
                    <span className="inline-block h-4 w-1.5 rounded" style={{ backgroundColor: g.color }} />
                    <span className="text-sm font-bold">{g.nombre}</span>
                    <span className="text-xs text-muted-foreground">
                      {g.tareas.length} {g.tareas.length === 1 ? "tarea" : "tareas"}
                    </span>
                    <ChevronDown
                      className={cn(
                        "size-4 text-muted-foreground transition-transform",
                        !abierta && "-rotate-90",
                      )}
                      strokeWidth={2}
                      aria-hidden="true"
                    />
                  </button>
                  {/* Expandir/colapsar animado: grid-template-rows 0fr→1fr evita el
                      salto brusco del montaje/desmontaje directo. */}
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows] duration-300 ease-out",
                      abierta ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
                    )}
                  >
                    <div className="overflow-hidden">
                      <div
                        className={cn(
                          "-mx-4 flex snap-x snap-mandatory items-start gap-4 overflow-x-auto px-4 pt-2 transition-opacity duration-300 md:mx-0 md:grid md:grid-cols-2 md:overflow-visible md:px-0 xl:grid-cols-5",
                          abierta ? "opacity-100" : "opacity-0",
                        )}
                      >
                        {ESTADOS.map((estado) => (
                          <div key={estado.id} className="w-[85%] shrink-0 snap-start md:w-auto">
                            <Column
                              estadoId={estado.id}
                              droppableId={`${g.id}::${estado.id}`}
                              nombre={estado.nombre}
                              ocultarNombreXl
                              tareas={g.tareas.filter((t) => t.estado === estado.id)}
                              onMover={mover}
                              onEditar={abrirTarea}
                              checklistPorTarea={checklistPorTarea}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <DragOverlay>
          {activa ? <TaskCard tarea={activa} overlay checklist={checklistPorTarea[activa.id]} /> : null}
        </DragOverlay>
      </DndContext>
      )}
      </div>

      {nuevaAbierta && (
        <TaskDialog
          equipo={equipo}
          currentUserId={currentUserId}
          espacio={espacio}
          empresas={empresas}
          /* Con un cliente ya filtrado, la tarea nueva nace en ese cliente: es lo
             que uno espera al estar mirando solo Nutravia. */
          empresaInicial={
            esAgencia && filtroEmpresa !== "todas" && filtroEmpresa !== SIN_EMPRESA
              ? filtroEmpresa
              : null
          }
          inicial={plantilla ?? undefined}
          onClose={() => {
            setNuevaAbierta(false);
            setPlantilla(null);
          }}
        />
      )}

      <MotivoAtoradoDialog
        open={!!atorarPendiente}
        motivoInicial={atorarPendiente?.motivoInicial ?? ""}
        onConfirmar={(motivo) => {
          if (atorarPendiente) ejecutarMover(atorarPendiente.id, "atorado", motivo || null);
          setAtorarPendiente(null);
        }}
        onCancelar={() => setAtorarPendiente(null)}
      />
    </div>
  );
}
