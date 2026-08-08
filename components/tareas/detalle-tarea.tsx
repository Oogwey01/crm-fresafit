"use client";

import { useEffect, useRef, useState } from "react";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import { avisoEstadoTarea } from "@/components/tareas/avisos";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ArrowLeft, CalendarDays, ChevronDown, MoreHorizontal, Trash2 } from "lucide-react";
import {
  ESTADOS,
  PRIORIDADES,
  AREAS,
  CATEGORIAS_TAREA,
  VISIBILIDADES,
  esGestor,
  obtenerArea,
  obtenerEstado,
  obtenerPrioridad,
  obtenerVisibilidad,
  veAgencia,
} from "@/lib/catalogos";
import { SelectorEtiquetas } from "@/components/tareas/selector-etiquetas";
import { ChipsEtiquetas } from "@/components/tareas/filtro-etiquetas";
import { AvataresEquipo } from "@/components/tareas/avatares-equipo";
import { isoALocalInput, localInputAIso, formatearFecha, formatearFechaHora, esVencida } from "@/lib/fecha";
import {
  editarTarea,
  moverTarea,
  borrarTarea,
  guardarEtiquetas,
  cargarDetalle,
  comentar,
  borrarComentario,
  agregarChecklist,
  toggleChecklist,
  borrarChecklist,
  agregarEnlace,
  borrarEnlace,
  subirAdjunto,
  borrarAdjunto,
  urlAdjunto,
  type TaskInput,
} from "@/app/(app)/tareas/actions";
import type {
  TaskConResponsable,
  Profile,
  RolId,
  AreaId,
  CategoriaTareaId,
  EstadoId,
  PrioridadId,
  VisibilidadId,
  TaskAttachment,
  TaskDetalle,
} from "@/lib/types";
import { trabajaLaTarea, mandaEnLaTarea, esImagenAdjunto } from "@/lib/tareas/reglas";
import { cn, iniciales } from "@/lib/utils";
import { SelectorPersonas } from "@/components/tareas/selector-personas";
import { MotivoAtoradoDialog } from "@/components/tareas/motivo-atorado-dialog";
import { DatePicker } from "@/components/compartido/date-picker";

const SIN_ASIGNAR = "none";
/* "Sin cliente" en el Select de la agencia: es trabajo de la casa, no un hueco. */
const SIN_EMPRESA = "sin-empresa";

/* En el teléfono los campos de meta se leen como una lista de propiedades (tipo
   ajustes del sistema): la etiqueta a la izquierda y el valor a la derecha, sin
   caja alrededor. De md en adelante el control recupera su borde y su ancho
   completo, que es como se ve hoy en escritorio.

   El control se queda con TODO el espacio libre de la fila (flex-1) aunque el
   texto vaya pegado a la derecha: el desplegable de un Select toma el ancho de
   su disparador, y con un disparador angosto los nombres largos del equipo se
   salían de la pantalla. De paso, se puede picar toda la mitad derecha. */
const CTRL_MOVIL =
  "h-10 min-w-0 flex-1 justify-end border-0 bg-transparent px-0 text-right font-medium " +
  /* Select, Input y DatePicker traen un `dark:bg-input/30` propio que en el
     teléfono pintaba una caja gris del alto de la fila y de toda su mitad
     derecha: el valor —«Baja», «Hecho», «3 de agosto»— quedaba nadando dentro
     de un recuadro que aquí no debería existir, porque la fila ya es la caja.
     En escritorio el control sí lleva su caja y el fondo vuelve. */
  "dark:bg-transparent dark:hover:bg-transparent md:dark:bg-input/30 " +
  /* El valor del Select es a su vez un flex que estira a la izquierda, y el
     DatePicker abre con un icono de calendario que sin caja queda suelto a
     media fila: ambos sobran cuando el dato va pegado a la derecha. */
  "[&>[data-slot=select-value]]:justify-end [&>svg:first-child]:hidden " +
  "md:h-8 md:w-full md:flex-none md:justify-between md:border md:px-2.5 md:text-left md:font-normal " +
  "md:[&>[data-slot=select-value]]:justify-start md:[&>svg:first-child]:block";

/* El mismo detalle se usa de dos formas: como pop-up desde el tablero (móvil y
   accesos rápidos) y como PÁGINA propia en /tareas/[id]. Armando pidió lo
   segundo —"me gustaría que pueda abrir la tarea y que no sea un pop-up"—, y
   además hace falta para que la campana lleve directo a la tarea. El contenido
   es idéntico; lo único que cambia es el marco.

   En modo página el marco además se parte por tamaño: en escritorio es la
   tarjeta de siempre; en el teléfono el contenido va a sangre entre dos barras
   fijas (volver/título/⋯ arriba, Guardar abajo) para que se sienta una pantalla
   de app y no un formulario de computadora encogido. */
function Envoltorio({
  comoPagina,
  titulo,
  onClose,
  barraSuperior,
  barraInferior,
  children,
}: {
  comoPagina: boolean;
  titulo: string;
  onClose: () => void;
  barraSuperior?: React.ReactNode;
  barraInferior?: React.ReactNode;
  children: React.ReactNode;
}) {
  if (comoPagina) {
    /* Ancho de trabajo, no de lectura. La página era una columna de 768 px
       centrada en pantallas de 1600: la tarea entera cabía en un canal estrecho
       con medio monitor en blanco a los lados, y para ver un comentario había
       que bajar por debajo de subtareas, enlaces y adjuntos. Ahora el contenido
       se reparte y cada bloque trae su propia tarjeta, así que la caja única
       desaparece. */
    return (
      <div className="mx-auto w-full max-w-6xl">
        {barraSuperior}
        {children}
        {barraInferior}
      </div>
    );
  }
  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{titulo}</DialogTitle>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

/* Cada bloque del detalle es una tarjeta. En el pop-up —que sigue siendo una
   columna estrecha— se quedan sin marco para no anidar cajas dentro de la caja
   del diálogo. */
function Tarjeta({
  children,
  className,
  conMarco = true,
}: {
  children: React.ReactNode;
  className?: string;
  conMarco?: boolean;
}) {
  return (
    <section
      className={cn(
        conMarco && "rounded-2xl border bg-card p-4 shadow-sm md:p-5",
        className,
      )}
    >
      {children}
    </section>
  );
}

/* Rótulo de un dato de la ficha: etiqueta arriba en versalitas, valor debajo. */
function Dato({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="text-[13.5px]">{children}</div>
    </div>
  );
}


export function TaskDetail({
  tarea,
  equipo,
  rol,
  currentUserId,
  comoPagina = false,
  enfocarComentario = false,
  onClose,
  empresas = [],
}: {
  tarea: TaskConResponsable;
  equipo: Profile[];
  rol: RolId;
  currentUserId: string;
  /* Clientes de la agencia, para poder cambiar de cuenta una tarea suya. Vacío
     en Fresafit, donde el campo no se pinta. */
  empresas?: { id: string; nombre: string; color: string }[];
  /* true = se pinta como página (/tareas/[id]); false = pop-up del tablero. */
  comoPagina?: boolean;
  /* Se llega desde un aviso de comentario: hay que dejar el cursor en el hilo.
     Armando: "necesito darle enfoque a la sección del comentario". */
  enfocarComentario?: boolean;
  onClose: () => void;
}) {
  const gestor = esGestor(rol);
  /* Quien manda en ESTA tarea: un gestor, o quien la creó. Desde que cualquiera
     del equipo puede abrir tareas, el dueño de la suya tiene que poder
     corregirla y borrarla; `gestor` a secas se queda para lo que es del tablero
     entero (borrar comentarios o adjuntos ajenos). */
  const manda = mandaEnLaTarea(tarea, rol, currentUserId);
  /* Quien acompaña la tarea tiene los mismos permisos que la responsable: si se
     le pidió el trabajo, tiene que poder moverla y comentarla. */
  const esResponsable = trabajaLaTarea(tarea, currentUserId);
  const puedeContribuir = manda || esResponsable;
  const puedeMover = manda || esResponsable;

  const nombrePorId = (id: string | null) =>
    id ? (equipo.find((p) => p.id === id)?.nombre ?? "?") : "?";
  /* El color del avatar sale del perfil; sin él, el gris de siempre. Lo usa el
     hilo de comentarios para que se distinga quién habla sin leer el nombre. */
  const colorPorId = (id: string | null) =>
    (id ? equipo.find((p) => p.id === id)?.color : null) ?? "#94a3b8";

  /* El detalle (comentarios, checklist, adjuntos, actividad) se carga aparte
     al abrir la tarea y se refresca tras cada mutación. */
  const {
    datos: detalle,
    cargando,
    error: errorDetalle,
    recargar,
  } = useDetalleRemoto<TaskDetalle>(() => cargarDetalle(tarea.id), tarea.id);
  const { ejecutar } = useAccionServidor();

  // Campos de meta (los edita quien manda en la tarea).
  const [titulo, setTitulo] = useState(tarea.titulo);
  const [descripcion, setDescripcion] = useState(tarea.descripcion ?? "");
  const [responsable, setResponsable] = useState(tarea.responsable_id ?? SIN_ASIGNAR);
  const [area, setArea] = useState<AreaId>(tarea.area);
  /* El área sale del perfil del responsable; solo se edita a mano si alguien lo
     pide expresamente con «cambiar». */
  const [areaManual, setAreaManual] = useState(false);
  const [prioridad, setPrioridad] = useState<PrioridadId>(tarea.prioridad);
  const [estado, setEstado] = useState<EstadoId>(tarea.estado);
  const [fecha, setFecha] = useState(tarea.fecha_limite ?? "");
  const [recordatorio, setRecordatorio] = useState(isoALocalInput(tarea.recordatorio_at));
  const [motivoAtorado, setMotivoAtorado] = useState(tarea.motivo_atorado ?? "");
  const [atorarAbierto, setAtorarAbierto] = useState(false);
  const [etiquetas, setEtiquetas] = useState<string[]>(tarea.etiquetas ?? []);
  const [coasignados, setCoasignados] = useState<string[]>(
    (tarea.coasignados ?? []).map((p) => p.id),
  );
  const esAgencia = tarea.espacio === "agencia";
  /* En la agencia solo se asigna a quien entra a ella (`ve_agencia`), igual que
     en el alta. Quien YA está en la tarea se conserva en la lista aunque haya
     perdido el permiso: si no, el select no podría ni mostrar al responsable
     actual, y reasignar se volvería obligatorio para poder guardar. */
  const asignables = esAgencia
    ? equipo.filter(
        (p) =>
          veAgencia(p) ||
          p.id === tarea.responsable_id ||
          (tarea.coasignados ?? []).some((c) => c.id === p.id) ||
          p.id === currentUserId,
      )
    : equipo;
  const [empresa, setEmpresa] = useState(tarea.empresa_id ?? SIN_EMPRESA);
  const [visibilidad, setVisibilidad] = useState<VisibilidadId>(tarea.visibilidad ?? "interno");
  const [categoria, setCategoria] = useState<CategoriaTareaId | "">(tarea.categoria ?? "");

  /* Al cambiar el responsable, el área se autollena con la de su perfil. Si esa
     persona acompañaba la tarea, deja de hacerlo: ahora es la principal. */
  function elegirResponsable(v: string) {
    const id = v ?? SIN_ASIGNAR;
    setResponsable(id);
    if (id !== SIN_ASIGNAR) {
      const p = equipo.find((x) => x.id === id);
      if (p?.area) setArea(p.area);
      setCoasignados((prev) => prev.filter((x) => x !== id));
    }
  }

  function toggleCoasignado(id: string) {
    setCoasignados((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const [nuevoComentario, setNuevoComentario] = useState("");
  const comentarioRef = useRef<HTMLTextAreaElement>(null);
  const hiloRef = useRef<HTMLDivElement>(null);

  /* Al llegar desde un aviso de comentario, lo primero que se quiere ver es el
     hilo, no el formulario de arriba. Se espera a que el detalle cargue: antes
     de eso los comentarios aún no están en el DOM. */
  useEffect(() => {
    if (!enfocarComentario || cargando) return;
    hiloRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    comentarioRef.current?.focus({ preventScroll: true });
  }, [enfocarComentario, cargando]);
  const [nuevaSubtarea, setNuevaSubtarea] = useState("");
  const [enlaceTitulo, setEnlaceTitulo] = useState("");
  const [enlaceUrl, setEnlaceUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  function accion(fn: () => Promise<{ ok: true } | { error: string }>, okMsg?: string) {
    ejecutar(fn, { ok: okMsg, alExito: recargar });
  }

  /* --- Meta (gestor o quien creó la tarea) --- */
  function guardarMeta() {
    if (!titulo.trim()) {
      toast.error("La tarea necesita un título.");
      return;
    }
    const input: TaskInput = {
      titulo,
      descripcion,
      responsable_id: responsable === SIN_ASIGNAR ? null : responsable,
      espacio: tarea.espacio,
      /* Solo se manda en la agencia: si fuera undefined en Fresafit el action ni
         lo mira, y así una tarea propia nunca puede acabar con cliente. */
      empresa_id: esAgencia ? (empresa === SIN_EMPRESA ? null : empresa) : undefined,
      visibilidad: esAgencia ? visibilidad : undefined,
      categoria: esAgencia ? (categoria || null) : undefined,
      coasignados,
      area,
      prioridad,
      estado,
      fecha_limite: fecha || null,
      recordatorio_at: localInputAIso(recordatorio),
      motivo_atorado: estado === "atorado" ? motivoAtorado : null,
      etiquetas,
    };
    ejecutar(() => editarTarea(tarea.id, input), {
      ok: "Cambios guardados.",
      alExito: onClose,
    });
  }

  /* --- Estado (miembro responsable): mover al vuelo --- */
  function ejecutarEstadoMiembro(nuevo: EstadoId, motivo: string | null) {
    setEstado(nuevo);
    accion(() => moverTarea(tarea.id, nuevo, motivo), avisoEstadoTarea(nuevo));
  }
  function cambiarEstadoMiembro(nuevo: EstadoId) {
    if (nuevo === "atorado") {
      setAtorarAbierto(true);
      return;
    }
    ejecutarEstadoMiembro(nuevo, null);
  }

  function toggleEtiquetaGestor(id: string) {
    const next = etiquetas.includes(id) ? etiquetas.filter((x) => x !== id) : [...etiquetas, id];
    setEtiquetas(next);
    /* Sin toast: se dispara por cada chip que se enciende o apaga, y el propio
       chip ya cambia de color. */
    accion(() => guardarEtiquetas(tarea.id, next));
  }

  function borrar() {
    ejecutar(() => borrarTarea(tarea.id), {
      confirmar: "¿Borrar esta tarea? No se puede deshacer.",
      ok: "Tarea borrada.",
      alExito: onClose,
    });
  }

  function agregarSubtarea() {
    const texto = nuevaSubtarea.trim();
    if (!texto) return;
    accion(() => agregarChecklist(tarea.id, texto), "Subtarea agregada.");
    setNuevaSubtarea("");
  }

  /* Abrir la foto/archivo en grande: la miniatura de la tarjeta va
     redimensionada, así que el original se firma aquí, solo cuando se pide. */
  async function verAdjunto(path: string) {
    const r = await urlAdjunto(path);
    if ("error" in r) return toast.error(r.error);
    window.open(r.url, "_blank");
  }

  function onSubir(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    accion(() => subirAdjunto(tarea.id, fd), "Archivo adjuntado.");
    if (fileRef.current) fileRef.current.value = "";
  }

  /* Lo que enseña la cabecera: mientras se edita, lo del formulario —aún sin
     guardar—; si solo se mira, lo que hay en la tarea. */
  const fechaCabecera = manda ? (fecha || null) : tarea.fecha_limite;
  const etiquetasCabecera = manda ? etiquetas : (tarea.etiquetas ?? []);

  const checklist = detalle?.checklist ?? [];
  const hechos = checklist.filter((c) => c.hecho).length;

  /* Los adjuntos se parten en dos: los que se pueden VER (foto con su miniatura
     ya firmada) y el resto —PDFs, hojas de cálculo, y también una imagen cuya
     miniatura no se pudo firmar—, que siguen como renglón con su nombre. */
  const fotos: { a: TaskAttachment; url: string }[] = [];
  const archivos: TaskAttachment[] = [];
  for (const a of detalle?.adjuntos ?? []) {
    const url = esImagenAdjunto(a) ? detalle?.miniaturas?.[a.storage_path] : undefined;
    if (url) fotos.push({ a, url });
    else archivos.push(a);
  }
  const tituloPantalla = manda ? "Editar tarea" : "Detalle de la tarea";

  /* Barra superior del teléfono. Va por DEBAJO del header de navegación, que ya
     es sticky con z-40 y 3.5rem de alto: de ahí el top-14 y el z-30. El -mx-4
     cancela el padding del <main> para que llegue a los bordes. */
  const barraSuperior = (
    <div className="sticky top-14 z-30 -mx-4 mb-3 flex h-14 items-center gap-1 border-b bg-lienzo/95 px-1.5 backdrop-blur md:hidden">
      <button
        type="button"
        onClick={onClose}
        aria-label="Volver a tareas"
        className="flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted"
      >
        <ArrowLeft className="size-5" strokeWidth={2} aria-hidden="true" />
      </button>
      <span className="truncate text-[15px] font-bold tracking-tight">{tituloPantalla}</span>
      {manda && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label="Más acciones"
            className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-lg text-foreground/80 transition-colors hover:bg-muted"
          >
            <MoreHorizontal className="size-5" strokeWidth={2} aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem variant="destructive" onClick={borrar}>
              <Trash2 aria-hidden="true" />
              Borrar tarea
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );

  /* Guardar al alcance del pulgar: con subtareas, comentarios e historial de por
     medio, el pie de escritorio quedaba a varias pantallas de scroll. Solo tiene
     sentido para quien edita la meta; a un miembro el cambio de estado se le
     aplica al vuelo. */
  const barraInferior = manda ? (
    <div className="sticky bottom-0 z-30 -mx-4 mt-4 border-t bg-lienzo/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:hidden">
      <Button className="h-12 w-full text-[15px]" onClick={guardarMeta}>
        Guardar
      </Button>
    </div>
  ) : null;

  return (
    <>
    <Envoltorio
      comoPagina={comoPagina}
      onClose={onClose}
      titulo={tituloPantalla}
      barraSuperior={barraSuperior}
      barraInferior={barraInferior}
    >

        {/* ===== Cabecera (ancha) =====
            Lo que contesta «qué es esto y cómo va» de un vistazo: estado,
            título, quién lo trabaja, para cuándo y cuánto lleva. Antes esos
            datos iban en un renglón corrido de texto gris debajo del título. */}
        <Tarjeta conMarco={comoPagina} className={cn("mb-4", !comoPagina && "mb-3 border-b pb-3")}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
              {/* El estado manda en la cabecera: es el dato que más se mira y
                  el único que casi todo el mundo puede cambiar. */}
              {puedeMover ? (
                <Select
                  value={estado}
                  onValueChange={(v) => {
                    if (!v) return;
                    if (manda) setEstado(v as EstadoId);
                    else cambiarEstadoMiembro(v as EstadoId);
                  }}
                >
                  <SelectTrigger
                    className="h-8 w-auto gap-1.5 rounded-full border-0 px-3 text-[12.5px] font-semibold text-white shadow-sm focus-visible:ring-2"
                    style={{ backgroundColor: obtenerEstado(estado)?.color }}
                  >
                    <SelectValue>
                      {(v: string) => obtenerEstado(v)?.nombre ?? "Estado"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map((e) => (
                      <SelectItem key={e.id} value={e.id}>{e.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <span
                  className="inline-flex h-8 items-center rounded-full px-3 text-[12.5px] font-semibold text-white"
                  style={{ backgroundColor: obtenerEstado(estado)?.color }}
                >
                  {obtenerEstado(estado)?.nombre}
                </span>
              )}

              {manda ? (
                <Input
                  className="h-10 min-w-0 flex-1 border-0 bg-transparent px-0 text-[21px] font-bold tracking-tight shadow-none focus-visible:bg-muted/50 focus-visible:px-2 md:text-[23px]"
                  value={titulo}
                  onChange={(e) => setTitulo(e.target.value)}
                  placeholder="Título de la tarea"
                />
              ) : (
                <h1 className="min-w-0 flex-1 text-[21px] font-bold leading-tight tracking-tight md:text-[23px]">
                  {tarea.titulo}
                </h1>
              )}
            </div>

            {/* Quién, para cuándo y con qué etiquetas — todo en un renglón. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[12.5px] text-muted-foreground">
              <AvataresEquipo tarea={tarea} tamano="md" />
              <span>
                la puso <b className="font-semibold text-foreground">{nombrePorId(tarea.created_by)}</b>
              </span>
              {tarea.empresa && (
                <span
                  className="inline-flex items-center rounded-full px-2 py-0.5 text-[11.5px] font-semibold"
                  style={{ backgroundColor: `${tarea.empresa.color}1f`, color: tarea.empresa.color }}
                >
                  {tarea.empresa.nombre}
                </span>
              )}
              {/* Mientras se edita, la cabecera enseña lo que se está cambiando
                  —no lo guardado—: si no, mover la fecha o quitar una etiqueta
                  no se notaba arriba hasta pulsar Guardar. */}
              {fechaCabecera && (
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 font-medium",
                    esVencida(fechaCabecera, estado) && "font-semibold text-red-600",
                  )}
                >
                  <CalendarDays className="size-3.5" strokeWidth={1.9} aria-hidden="true" />
                  {esVencida(fechaCabecera, estado) ? "venció" : "vence"} {formatearFecha(fechaCabecera)}
                </span>
              )}
              {etiquetasCabecera.length > 0 && (
                <ChipsEtiquetas ids={etiquetasCabecera} maximo={4} />
              )}
            </div>

            {/* Progreso: la barra dice en un golpe de vista lo que la lista de
                subtareas obliga a contar. Solo aparece si hay subtareas. */}
            {checklist.length > 0 && (
              <div className="flex items-center gap-3">
                <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${Math.round((hechos / checklist.length) * 100)}%` }}
                  />
                </div>
                <span className="shrink-0 text-[11.5px] font-semibold text-muted-foreground">
                  {hechos}/{checklist.length} subtareas
                </span>
              </div>
            )}

            {estado === "atorado" && (manda ? motivoAtorado : tarea.motivo_atorado) && (
              <div className="flex items-start gap-2 rounded-xl border border-orange-200 bg-orange-50 px-3 py-2 text-[13px] text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300">
                <AlertTriangle className="mt-px size-4 shrink-0" strokeWidth={1.9} aria-hidden="true" />
                <span>
                  <b className="font-semibold">Atorada:</b>{" "}
                  {manda ? motivoAtorado : tarea.motivo_atorado}
                </span>
              </div>
            )}

            {!puedeMover && (
              <p className="text-xs italic text-muted-foreground">
                Solo puedes comentar. El cambio de estado lo hace la persona responsable o un coordinador.
              </p>
            )}
            {/* Esta vista no tiene botón de Guardar —el de abajo es solo para
                quien edita la tarea— y sin decirlo parecía que lo que uno
                escribía se quedaba sin guardar. */}
            {puedeContribuir && !manda && (
              <p className="text-xs italic text-muted-foreground">
                No hay que guardar: el estado, las subtareas, los enlaces, las fotos y los comentarios
                se guardan en cuanto los agregas.
              </p>
            )}
          </div>
        </Tarjeta>

        {cargando ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando detalle…</p>
        ) : errorDetalle ? (
          /* Sin esto, un fallo de lectura se veía igual que una tarea sin
             comentarios ni subtareas. */
          <p className="py-6 text-center text-sm text-destructive">
            No se pudo cargar el detalle: {errorDetalle}
          </p>
        ) : (
          /* Dos columnas: a la izquierda lo que se TRABAJA (se lee y se
             escribe), a la derecha lo que la tarea ES (ficha, etiquetas,
             enlaces, historial), fija al hacer scroll para no perderla de
             vista. El pop-up y el teléfono se quedan en una sola columna: los
             breakpoints miran la ventana, no el ancho del diálogo. */
          <div className={cn("grid gap-4", comoPagina && "lg:grid-cols-[minmax(0,1fr)_340px]")}>
            {/* ---------------- Columna: el trabajo ---------------- */}
            <div className="flex min-w-0 flex-col gap-4">
              {/* Descripción */}
              {(manda || tarea.descripcion) && (
                <Tarjeta conMarco={comoPagina}>
                  <h2 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Descripción
                  </h2>
                  {manda ? (
                    <Textarea
                      rows={4}
                      value={descripcion}
                      onChange={(e) => setDescripcion(e.target.value)}
                      placeholder="Detalles, contexto…"
                    />
                  ) : (
                    <p className="whitespace-pre-wrap text-[14px] leading-relaxed">
                      {tarea.descripcion}
                    </p>
                  )}
                </Tarjeta>
              )}

              {/* Motivo cuando está atorada (solo lo edita quien manda). */}
              {manda && estado === "atorado" && (
                <Tarjeta conMarco={comoPagina}>
                  <h2 className="mb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                    ¿Por qué está atorada?
                  </h2>
                  <Textarea
                    rows={2}
                    value={motivoAtorado}
                    onChange={(e) => setMotivoAtorado(e.target.value)}
                    placeholder="Qué se necesita de vuelta para poder avanzar…"
                  />
                </Tarjeta>
              )}

              {/* ===== Subtareas ===== */}
              <Tarjeta conMarco={comoPagina}>
                <Seccion
                  titulo="Subtareas"
                  contador={checklist.length ? `${hechos}/${checklist.length}` : null}
                  sufijoEscritorio={checklist.length ? `(${hechos}/${checklist.length})` : null}
                  abiertaPorDefecto
                >
                  <div className="flex flex-col gap-1">
                    {checklist.length === 0 && (
                      <p className="text-sm text-muted-foreground">Sin subtareas todavía.</p>
                    )}
                    {checklist.map((it) => (
                      <label key={it.id} className="flex items-center gap-2.5 rounded-md px-1.5 py-2 hover:bg-muted/60 md:gap-2 md:py-1.5">
                        {/* Sin toast al marcar: se recorren cinco subtareas
                            seguidas y el propio checkbox ya es la confirmación. */}
                        <input
                          type="checkbox"
                          className="size-[18px] shrink-0 md:size-4"
                          checked={it.hecho}
                          disabled={!puedeContribuir}
                          onChange={(e) => accion(() => toggleChecklist(it.id, e.target.checked))}
                        />
                        <span className={cn("flex-1 text-sm", it.hecho && "text-muted-foreground line-through")}>
                          {it.texto}
                        </span>
                        {puedeContribuir && (
                          <button className="text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => accion(() => borrarChecklist(it.id), "Subtarea borrada.")}>✕</button>
                        )}
                      </label>
                    ))}
                  </div>
                  {/* El botón NO es decorativo: la subtarea solo se agregaba con
                      Enter y no había nada que lo dijera, así que se escribía y se
                      perdía. El Enter sigue funcionando para quien ya lo sabe. */}
                  {puedeContribuir && (
                    <div className="mt-2 flex gap-2">
                      <Input
                        className="h-11 min-w-0 flex-1 md:h-9"
                        value={nuevaSubtarea}
                        onChange={(e) => setNuevaSubtarea(e.target.value)}
                        placeholder="Agregar subtarea…"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            agregarSubtarea();
                          }
                        }}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-11 shrink-0 md:h-9"
                        disabled={!nuevaSubtarea.trim()}
                        onClick={agregarSubtarea}
                      >
                        Agregar
                      </Button>
                    </div>
                  )}
                </Seccion>
              </Tarjeta>

              {/* ===== Fotos y archivos ===== */}
              <Tarjeta conMarco={comoPagina}>
                <Seccion
                  titulo="Fotos y archivos"
                  contador={(detalle?.adjuntos ?? []).length || null}
                  abiertaPorDefecto
                >
                  {/* Las fotos se ven aquí mismo. Antes toda la sección era una
                      lista de nombres, y para saber qué había mandado alguien
                      —justo el caso de esto: mandar la foto de lo que se contó—
                      había que abrir cada archivo en otra pestaña.
                      Lo que no es imagen (o cuya miniatura no se pudo firmar)
                      sigue como renglón con su nombre. */}
                  {fotos.length > 0 && (
                    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
                      {fotos.map(({ a, url }) => (
                        <div key={a.id} className="group relative">
                          <button
                            type="button"
                            onClick={() => verAdjunto(a.storage_path)}
                            title={`Ver «${a.nombre}» en grande`}
                            className="block w-full overflow-hidden rounded-xl border bg-muted/40 transition-opacity hover:opacity-90"
                          >
                            {/* <img> plano, como en el catálogo: es una miniatura ya
                                redimensionada por Storage y su URL es firmada (y
                                caduca), así que no gana nada pasando por next/image. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={a.nombre}
                              loading="lazy"
                              className="aspect-square w-full object-contain"
                            />
                          </button>
                          {(gestor || a.autor === currentUserId) && (
                            <button
                              type="button"
                              aria-label={`Quitar ${a.nombre}`}
                              onClick={() => accion(() => borrarAdjunto(a.id, a.storage_path), "Archivo quitado.")}
                              className="absolute -right-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full border bg-card text-xs text-muted-foreground shadow-sm hover:text-destructive"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={cn("flex flex-col gap-1", fotos.length > 0 && archivos.length > 0 && "mt-2")}>
                    {archivos.map((a) => (
                      <div key={a.id} className="flex items-center gap-2 py-1 text-sm md:py-0">
                        <button className="text-primary hover:underline" onClick={() => verAdjunto(a.storage_path)}>
                          📎 {a.nombre}
                        </button>
                        {(gestor || a.autor === currentUserId) && (
                          <button className="text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => accion(() => borrarAdjunto(a.id, a.storage_path), "Archivo quitado.")}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {fotos.length === 0 && archivos.length === 0 && (
                    <p className="text-sm text-muted-foreground">Nada adjunto todavía.</p>
                  )}
                  {puedeContribuir && (
                    <div className="mt-2">
                      <input ref={fileRef} type="file" className="hidden" onChange={onSubir} />
                      <Button variant="outline" size="sm" className="h-10 w-full md:h-9 md:w-auto" onClick={() => fileRef.current?.click()}>
                        📎 Adjuntar archivo / foto
                      </Button>
                    </div>
                  )}
                </Seccion>
              </Tarjeta>

              {/* ===== Conversación ===== */}
              <Tarjeta conMarco={comoPagina}>
                <Seccion
                  titulo="Conversación"
                  contador={(detalle?.comentarios ?? []).length || null}
                  abiertaPorDefecto
                >
                  <div ref={hiloRef} className="flex flex-col gap-2.5">
                    {(detalle?.comentarios ?? []).length === 0 && (
                      <p className="text-sm text-muted-foreground">Sin comentarios todavía.</p>
                    )}
                    {(detalle?.comentarios ?? []).map((c) => {
                      const mio = c.autor === currentUserId;
                      return (
                        <div key={c.id} className="flex gap-2.5">
                          {/* Avatar del autor: en un hilo de cuatro personas, el
                              nombre en negritas no basta para seguir quién habla. */}
                          <span
                            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                            style={{ backgroundColor: colorPorId(c.autor) }}
                            aria-hidden="true"
                          >
                            {iniciales(nombrePorId(c.autor))}
                          </span>
                          <div className={cn("min-w-0 flex-1 rounded-2xl px-3 py-2", mio ? "bg-primary/10" : "bg-muted/60")}>
                            <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                              <b className="text-foreground">{nombrePorId(c.autor)}</b>
                              <span>{formatearFechaHora(c.created_at)}</span>
                              {(gestor || mio) && (
                                <button className="ml-auto hover:text-destructive"
                                  onClick={() => accion(() => borrarComentario(c.id), "Comentario borrado.")}>✕</button>
                              )}
                            </div>
                            <p className="whitespace-pre-wrap text-sm">{c.texto}</p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-end">
                    <Textarea ref={comentarioRef} rows={2} value={nuevoComentario}
                      onChange={(e) => setNuevoComentario(e.target.value)} placeholder="Escribe un comentario…" />
                    <Button variant="outline" size="sm" className="h-10 self-end px-5 md:h-9 md:self-auto"
                      onClick={() => {
                        if (!nuevoComentario.trim()) return;
                        accion(() => comentar(tarea.id, nuevoComentario), "Comentario agregado.");
                        setNuevoComentario("");
                      }}>Comentar</Button>
                  </div>
                </Seccion>
              </Tarjeta>
            </div>

            {/* ---------------- Columna: la ficha ---------------- */}
            <aside
              className={cn(
                "flex min-w-0 flex-col gap-4",
                /* Fija al hacer scroll: la conversación puede ser larga y los
                   datos de la tarea se consultan mientras se lee. top-20 la
                   deja por debajo del header pegajoso del móvil/escritorio. */
                comoPagina && "lg:sticky lg:top-20 lg:self-start",
              )}
            >
              <Tarjeta conMarco={comoPagina}>
                <h2 className="mb-3 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Ficha
                </h2>
                {manda ? (
                  /* Quien manda edita la ficha en el sitio; se guarda con el
                     botón del pie (o la barra fija del teléfono). */
                  <div className="grid grid-cols-1 divide-y rounded-2xl border bg-card md:divide-y-0 md:rounded-none md:border-0 md:bg-transparent">
                    {/* De quién es el trabajo. Solo en la agencia: en Fresafit el
                        cliente es la propia marca y el campo sobraría. */}
                    {esAgencia && (
                      <Meta label="Cliente">
                        <Select value={empresa} onValueChange={(v) => setEmpresa(v ?? SIN_EMPRESA)}>
                          <SelectTrigger className={CTRL_MOVIL}><SelectValue>{(v: string) => v === SIN_EMPRESA ? "De la agencia" : (empresas.find((e) => e.id === v)?.nombre ?? tarea.empresa?.nombre ?? "Cliente")}</SelectValue></SelectTrigger>
                          <SelectContent>
                            {empresas.map((e) => (<SelectItem key={e.id} value={e.id}>{e.nombre}</SelectItem>))}
                            <SelectItem value={SIN_EMPRESA}>De la agencia (sin cliente)</SelectItem>
                          </SelectContent>
                        </Select>
                      </Meta>
                    )}
                    {/* Con quién se comparte y de qué va el acuerdo. Solo en la
                        agencia, y solo aquí — desde el tablero de Fresafit
                        estos campos no existen. Compartir desde este select es
                        tan deliberado como desde el interruptor del workspace:
                        se guarda con el botón de la ficha. */}
                    {esAgencia && (
                      <Meta label="Quién la ve">
                        <Select value={visibilidad} onValueChange={(v) => v && setVisibilidad(v as VisibilidadId)}>
                          <SelectTrigger className={CTRL_MOVIL}><SelectValue>{(v: string) => obtenerVisibilidad(v)?.nombre ?? "Interno"}</SelectValue></SelectTrigger>
                          <SelectContent>
                            {VISIBILIDADES.map((vi) => (<SelectItem key={vi.id} value={vi.id}>{vi.nombre} — {vi.desc}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </Meta>
                    )}
                    {esAgencia && (
                      <Meta label="Categoría">
                        <Select value={categoria || "sin"} onValueChange={(v) => setCategoria(v === "sin" ? "" : (v as CategoriaTareaId))}>
                          <SelectTrigger className={CTRL_MOVIL}><SelectValue>{(v: string) => CATEGORIAS_TAREA.find((c) => c.id === v)?.nombre ?? "Sin categoría"}</SelectValue></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="sin">Sin categoría</SelectItem>
                            {CATEGORIAS_TAREA.map((c) => (<SelectItem key={c.id} value={c.id}>{c.nombre}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      </Meta>
                    )}
                    <Meta label="Responsable">
                      <Select value={responsable} onValueChange={(v) => elegirResponsable(v ?? SIN_ASIGNAR)}>
                        <SelectTrigger className={CTRL_MOVIL}><SelectValue>{(v: string) => v === SIN_ASIGNAR ? "Sin asignar" : (equipo.find((p) => p.id === v)?.nombre ?? "Responsable")}</SelectValue></SelectTrigger>
                        <SelectContent>
                          <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
                          {asignables.map((p) => (<SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </Meta>
                    {/* El área la dicta el perfil del responsable, así que en el 99 %
                        de los casos es un campo que se rellena solo y solo estorba
                        ("si le creo una tarea a René no es necesario poner el área,
                        su área ya es operaciones"). Se muestra como dato, con un
                        atajo para el caso raro en que haya que cambiarla. */}
                    <Meta label="Área">
                      {areaManual ? (
                        <Select value={area} onValueChange={(v) => v && setArea(v as AreaId)}>
                          <SelectTrigger className={CTRL_MOVIL}><SelectValue>{(v: string) => AREAS.find((a) => a.id === v)?.nombre ?? "Área"}</SelectValue></SelectTrigger>
                          <SelectContent>
                            {AREAS.map((a) => (<SelectItem key={a.id} value={a.id}>{a.nombre}</SelectItem>))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <div className="flex items-center gap-2 text-sm md:h-9 md:w-full">
                          <span className="font-medium">{obtenerArea(area)?.nombre ?? area}</span>
                          <button
                            type="button"
                            onClick={() => setAreaManual(true)}
                            className="ml-auto shrink-0 text-xs font-medium text-primary hover:underline"
                          >
                            cambiar
                          </button>
                        </div>
                      )}
                    </Meta>
                    <Meta label="Prioridad">
                      <Select value={prioridad} onValueChange={(v) => v && setPrioridad(v as PrioridadId)}>
                        <SelectTrigger className={CTRL_MOVIL}><SelectValue>{(v: string) => PRIORIDADES.find((p) => p.id === v)?.nombre ?? "Prioridad"}</SelectValue></SelectTrigger>
                        <SelectContent>
                          {PRIORIDADES.map((p) => (<SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>))}
                        </SelectContent>
                      </Select>
                    </Meta>
                    <Meta label="Fecha límite">
                      <DatePicker className={CTRL_MOVIL} value={fecha} onChange={setFecha} limpiable />
                    </Meta>
                    <Meta label="Recordatorio">
                      <Input
                        className={CTRL_MOVIL}
                        type="datetime-local"
                        value={recordatorio}
                        onChange={(e) => setRecordatorio(e.target.value)}
                      />
                    </Meta>
                  </div>
                ) : (
                  /* Quien solo la trabaja la lee. El estado ya se cambia desde
                     la cabecera, así que aquí no se repite. */
                  <div className="flex flex-col gap-3">
                    {tarea.empresa && (
                      <Dato label="Cliente">{tarea.empresa.nombre}</Dato>
                    )}
                    {/* Quien la trabaja tiene que saber si el cliente está
                        leyendo el hilo ANTES de escribir en él. */}
                    {esAgencia && (
                      <Dato label="Quién la ve">
                        {obtenerVisibilidad(tarea.visibilidad)?.nombre ?? "Interno"}
                        {tarea.visibilidad === "compartido" && tarea.empresa
                          ? ` — ${tarea.empresa.nombre} ve el hilo y los archivos`
                          : ""}
                      </Dato>
                    )}
                    <Dato label="Responsable">{nombrePorId(tarea.responsable_id)}</Dato>
                    {(tarea.coasignados ?? []).length > 0 && (
                      <Dato label="Con">{tarea.coasignados.map((p) => p.nombre).join(", ")}</Dato>
                    )}
                    <Dato label="Te la puso">{nombrePorId(tarea.created_by)}</Dato>
                    <Dato label="Área">{obtenerArea(tarea.area)?.nombre ?? tarea.area}</Dato>
                    <Dato label="Prioridad">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: obtenerPrioridad(tarea.prioridad)?.color }}
                        />
                        {obtenerPrioridad(tarea.prioridad)?.nombre}
                      </span>
                    </Dato>
                    <Dato label="Fecha límite">
                      {tarea.fecha_limite ? formatearFecha(tarea.fecha_limite) : "sin fecha"}
                    </Dato>
                  </div>
                )}
              </Tarjeta>

              {/* Equipo de apoyo (solo lo reparte quien manda). */}
              {manda && (
                <Tarjeta conMarco={comoPagina}>
                  <Seccion titulo="¿Quién más trabaja esta tarea?" abiertaPorDefecto>
                    <SelectorPersonas
                      equipo={asignables}
                      seleccionados={coasignados}
                      principalId={responsable === SIN_ASIGNAR ? null : responsable}
                      onToggle={toggleCoasignado}
                    />
                  </Seccion>
                </Tarjeta>
              )}

              {/* Etiquetas: se ponen aquí y se ven arriba, en la cabecera. */}
              {manda && (
                <Tarjeta conMarco={comoPagina}>
                  <Seccion titulo="Etiquetas" abiertaPorDefecto>
                    <SelectorEtiquetas
                      area={area}
                      seleccionadas={etiquetas}
                      onToggle={toggleEtiquetaGestor}
                    />
                  </Seccion>
                </Tarjeta>
              )}

              {/* ===== Enlaces ===== */}
              <Tarjeta conMarco={comoPagina}>
                <Seccion titulo="Enlaces" contador={(detalle?.enlaces ?? []).length || null} abiertaPorDefecto>
                  <div className="flex flex-col gap-1">
                    {(detalle?.enlaces ?? []).length === 0 && (
                      <p className="text-sm text-muted-foreground">Sin enlaces.</p>
                    )}
                    {(detalle?.enlaces ?? []).map((l) => (
                      <div key={l.id} className="flex items-center gap-2 py-1 text-sm md:py-0">
                        <a href={l.url} target="_blank" rel="noreferrer" className="min-w-0 truncate text-primary hover:underline">
                          🔗 {l.titulo || l.url}
                        </a>
                        {puedeContribuir && (
                          <button className="ml-auto shrink-0 text-xs text-muted-foreground hover:text-destructive"
                            onClick={() => accion(() => borrarEnlace(l.id), "Enlace borrado.")}>✕</button>
                        )}
                      </div>
                    ))}
                  </div>
                  {puedeContribuir && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Input className="h-11 w-full md:h-9" value={enlaceTitulo}
                        onChange={(e) => setEnlaceTitulo(e.target.value)} placeholder="Nombre (opcional)" />
                      <Input className="h-11 w-full md:h-9" value={enlaceUrl}
                        onChange={(e) => setEnlaceUrl(e.target.value)} placeholder="https://…" />
                      <Button variant="outline" size="sm" className="h-10 w-full md:h-9"
                        onClick={() => {
                          if (!enlaceUrl.trim()) return;
                          accion(() => agregarEnlace(tarea.id, enlaceTitulo, enlaceUrl), "Enlace agregado.");
                          setEnlaceTitulo(""); setEnlaceUrl("");
                        }}>Agregar</Button>
                    </div>
                  )}
                </Seccion>
              </Tarjeta>

              {/* ===== Historial ===== */}
              <Tarjeta conMarco={comoPagina}>
                <Seccion titulo="Historial" contador={(detalle?.actividad ?? []).length || null}>
                  {/* Línea de tiempo: el hilo vertical y el punto de cada paso
                      hacen legible de un vistazo que esto es una secuencia, que
                      es justo lo que una lista de renglones grises escondía. */}
                  <ol className="relative flex flex-col gap-3 border-l pl-4">
                    {(detalle?.actividad ?? []).map((a) => (
                      <li key={a.id} className="relative text-[12px] leading-snug text-muted-foreground">
                        <span
                          className="absolute -left-[21px] top-1 size-2 rounded-full bg-border ring-4 ring-card"
                          aria-hidden="true"
                        />
                        <b className="text-foreground">{nombrePorId(a.autor)}</b> {a.texto}
                        <div className="text-[11px] text-muted-foreground/70">{formatearFechaHora(a.created_at)}</div>
                      </li>
                    ))}
                  </ol>
                </Seccion>
              </Tarjeta>
            </aside>
          </div>
        )}

        {/* ===== Pie ===== */}
        {/* En el teléfono las acciones viven en las barras fijas (⋯ arriba,
            Guardar abajo), así que aquí solo queda la fila de escritorio.
            Quién la delegó ya no se repite: lo dice la cabecera. */}
        <div
          className={cn(
            "mt-4 flex items-center gap-2 border-t pt-4",
            /* Solo la página tiene barras fijas que lo sustituyan; el pop-up
               conserva su pie en cualquier tamaño. */
            comoPagina && "hidden md:flex",
          )}
        >
          <span className="text-xs text-muted-foreground">
            {tarea.fecha_inicio ? `Empezó el ${formatearFecha(tarea.fecha_inicio)}` : ""}
          </span>
          <div className="ml-auto flex gap-2">
            {manda && (
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={borrar}>
                Borrar
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              {comoPagina ? "Volver" : "Cerrar"}
            </Button>
            {manda && <Button onClick={guardarMeta}>Guardar</Button>}
          </div>
        </div>
    </Envoltorio>

    <MotivoAtoradoDialog
      open={atorarAbierto}
      motivoInicial={tarea.motivo_atorado ?? ""}
      onConfirmar={(motivo) => {
        ejecutarEstadoMiembro("atorado", motivo || null);
        setAtorarAbierto(false);
      }}
      onCancelar={() => setAtorarAbierto(false)}
    />
    </>
  );
}

/* Fila de propiedad en el teléfono (etiqueta ↔ valor) y campo apilado en
   escritorio. Ver CTRL_MOVIL, que es la otra mitad del truco. */
function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 px-3.5 md:min-h-0 md:flex-col md:items-stretch md:gap-1.5 md:px-0">
      <span className="shrink-0 text-[13.5px] font-medium text-muted-foreground md:text-xs md:font-semibold md:uppercase md:tracking-wide">
        {label}
      </span>
      {children}
    </div>
  );
}

/* En el teléfono las secciones se pliegan —con la tarea abierta, subtareas +
   enlaces + adjuntos + comentarios + historial eran varias pantallas de scroll—
   y el encabezado muestra cuánto hay dentro. De md en adelante el encabezado
   deja de responder al clic, el chevron desaparece y el contenido queda siempre
   abierto: en escritorio se ve igual que antes.

   El plegado usa el mismo grid 0fr→1fr que la vista móvil del tablero. */
function Seccion({
  titulo,
  contador,
  sufijoEscritorio,
  abiertaPorDefecto = false,
  children,
}: {
  titulo: string;
  contador?: string | number | null;
  /* Lo que en el teléfono va como pastilla, en escritorio se sigue leyendo
     dentro del propio encabezado (así estaba «Subtareas (2/5)»). */
  sufijoEscritorio?: string | null;
  abiertaPorDefecto?: boolean;
  children: React.ReactNode;
}) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto);
  return (
    <div className="mt-4 border-t pt-3">
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="flex w-full items-center gap-2 py-1 text-left md:pointer-events-none md:mb-2 md:py-0"
      >
        <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {titulo}
          {sufijoEscritorio && <span className="hidden md:inline"> {sufijoEscritorio}</span>}
        </h3>
        {contador != null && (
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground md:hidden">
            {contador}
          </span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto size-4 shrink-0 text-muted-foreground transition-transform md:hidden",
            !abierta && "-rotate-90",
          )}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-200 md:grid-rows-[1fr]",
          abierta ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="min-h-0 overflow-hidden">{children}</div>
      </div>
    </div>
  );
}
