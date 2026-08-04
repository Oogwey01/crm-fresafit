"use client";

import { useEffect, useRef, useState } from "react";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ESTADOS, PRIORIDADES, AREAS, esGestor, obtenerArea } from "@/lib/catalogos";
import { SelectorEtiquetas } from "@/components/tareas/selector-etiquetas";
import { isoALocalInput, localInputAIso, formatearFecha } from "@/lib/fecha";
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
  EstadoId,
  PrioridadId,
  TaskDetalle,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { MotivoAtoradoDialog } from "@/components/tareas/motivo-atorado-dialog";
import { DatePicker } from "@/components/compartido/date-picker";

const SIN_ASIGNAR = "none";

/* El mismo detalle se usa de dos formas: como pop-up desde el tablero (móvil y
   accesos rápidos) y como PÁGINA propia en /tareas/[id]. Armando pidió lo
   segundo —"me gustaría que pueda abrir la tarea y que no sea un pop-up"—, y
   además hace falta para que la campana lleve directo a la tarea. El contenido
   es idéntico; lo único que cambia es el marco. */
function Envoltorio({
  comoPagina,
  titulo,
  onClose,
  children,
}: {
  comoPagina: boolean;
  titulo: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (comoPagina) {
    return (
      <div className="mx-auto w-full max-w-3xl rounded-2xl border bg-card p-5 shadow-sm sm:p-6">
        <h1 className="mb-4 text-[22px] font-bold tracking-tight">{titulo}</h1>
        {children}
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

function fmtFechaHora(iso: string) {
  return new Date(iso).toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function TaskDetail({
  tarea,
  equipo,
  rol,
  currentUserId,
  comoPagina = false,
  enfocarComentario = false,
  onClose,
}: {
  tarea: TaskConResponsable;
  equipo: Profile[];
  rol: RolId;
  currentUserId: string;
  /* true = se pinta como página (/tareas/[id]); false = pop-up del tablero. */
  comoPagina?: boolean;
  /* Se llega desde un aviso de comentario: hay que dejar el cursor en el hilo.
     Armando: "necesito darle enfoque a la sección del comentario". */
  enfocarComentario?: boolean;
  onClose: () => void;
}) {
  const gestor = esGestor(rol);
  const esResponsable = tarea.responsable_id === currentUserId;
  const puedeContribuir = gestor || esResponsable;
  const puedeMover = gestor || esResponsable;

  const nombrePorId = (id: string | null) =>
    id ? (equipo.find((p) => p.id === id)?.nombre ?? "?") : "?";

  /* El detalle (comentarios, checklist, adjuntos, actividad) se carga aparte
     al abrir la tarea y se refresca tras cada mutación. */
  const {
    datos: detalle,
    cargando,
    error: errorDetalle,
    recargar,
  } = useDetalleRemoto<TaskDetalle>(() => cargarDetalle(tarea.id), tarea.id);
  const { ejecutar } = useAccionServidor();

  // Campos de meta (edición para gestor).
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

  /* Al cambiar el responsable, el área se autollena con la de su perfil. */
  function elegirResponsable(v: string) {
    const id = v ?? SIN_ASIGNAR;
    setResponsable(id);
    if (id !== SIN_ASIGNAR) {
      const p = equipo.find((x) => x.id === id);
      if (p?.area) setArea(p.area);
    }
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

  /* --- Meta (gestor) --- */
  function guardarMeta() {
    if (!titulo.trim()) {
      toast.error("La tarea necesita un título.");
      return;
    }
    const input: TaskInput = {
      titulo,
      descripcion,
      responsable_id: responsable === SIN_ASIGNAR ? null : responsable,
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
    accion(() => moverTarea(tarea.id, nuevo, motivo));
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
    accion(() => guardarEtiquetas(tarea.id, next));
  }

  function borrar() {
    ejecutar(() => borrarTarea(tarea.id), {
      confirmar: "¿Borrar esta tarea? No se puede deshacer.",
      ok: "Tarea borrada.",
      alExito: onClose,
    });
  }

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

  const checklist = detalle?.checklist ?? [];
  const hechos = checklist.filter((c) => c.hecho).length;

  return (
    <>
    <Envoltorio comoPagina={comoPagina} onClose={onClose} titulo={gestor ? "Editar tarea" : "Detalle de la tarea"}>

        {/* ===== Meta ===== */}
        {gestor ? (
          <div className="flex flex-col gap-3">
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Título" />
            <Textarea
              rows={3}
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
              placeholder="Descripción…"
            />
            <div className="grid grid-cols-2 gap-3">
              <Meta label="Responsable">
                <Select value={responsable} onValueChange={(v) => elegirResponsable(v ?? SIN_ASIGNAR)}>
                  <SelectTrigger className="w-full"><SelectValue>{(v: string) => v === SIN_ASIGNAR ? "Sin asignar" : (equipo.find((p) => p.id === v)?.nombre ?? "Responsable")}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
                    {equipo.map((p) => (<SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>))}
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
                    <SelectTrigger className="w-full"><SelectValue>{(v: string) => AREAS.find((a) => a.id === v)?.nombre ?? "Área"}</SelectValue></SelectTrigger>
                    <SelectContent>
                      {AREAS.map((a) => (<SelectItem key={a.id} value={a.id}>{a.nombre}</SelectItem>))}
                    </SelectContent>
                  </Select>
                ) : (
                  <div className="flex h-9 items-center gap-2 text-sm">
                    <span className="font-medium">{obtenerArea(area)?.nombre ?? area}</span>
                    <span className="text-xs text-muted-foreground">
                      {responsable === SIN_ASIGNAR
                        ? "sin responsable"
                        : `según ${equipo.find((p) => p.id === responsable)?.nombre ?? "el responsable"}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAreaManual(true)}
                      className="ml-auto text-xs font-medium text-primary hover:underline"
                    >
                      cambiar
                    </button>
                  </div>
                )}
              </Meta>
              <Meta label="Prioridad">
                <Select value={prioridad} onValueChange={(v) => v && setPrioridad(v as PrioridadId)}>
                  <SelectTrigger className="w-full"><SelectValue>{(v: string) => PRIORIDADES.find((p) => p.id === v)?.nombre ?? "Prioridad"}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {PRIORIDADES.map((p) => (<SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>))}
                  </SelectContent>
                </Select>
              </Meta>
              <Meta label="Estado">
                <Select value={estado} onValueChange={(v) => v && setEstado(v as EstadoId)}>
                  <SelectTrigger className="w-full"><SelectValue>{(v: string) => ESTADOS.find((e) => e.id === v)?.nombre ?? "Estado"}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map((e) => (<SelectItem key={e.id} value={e.id}>{e.nombre}</SelectItem>))}
                  </SelectContent>
                </Select>
              </Meta>
              <Meta label="Fecha límite">
                <DatePicker value={fecha} onChange={setFecha} limpiable />
              </Meta>
              <Meta label="Recordatorio">
                <Input
                  type="datetime-local"
                  value={recordatorio}
                  onChange={(e) => setRecordatorio(e.target.value)}
                />
              </Meta>
            </div>

            {estado === "atorado" && (
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Motivo (atorado)
                </span>
                <Textarea
                  rows={2}
                  value={motivoAtorado}
                  onChange={(e) => setMotivoAtorado(e.target.value)}
                  placeholder="Qué se necesita de vuelta para poder avanzar…"
                />
              </div>
            )}

            <Seccion titulo="Etiquetas">
              <SelectorEtiquetas
                area={area}
                seleccionadas={etiquetas}
                onToggle={toggleEtiquetaGestor}
              />
            </Seccion>
          </div>
        ) : (
          /* No gestor: lectura + (si responsable) cambiar estado */
          <div className="flex flex-col gap-2">
            <h2 className="text-lg font-bold">{tarea.titulo}</h2>
            {tarea.descripcion && (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{tarea.descripcion}</p>
            )}
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="text-muted-foreground">
                Responsable: <b className="text-foreground">{nombrePorId(tarea.responsable_id)}</b>
              </span>
              <span className="text-muted-foreground">
                Te la puso: <b className="text-foreground">{nombrePorId(tarea.created_by)}</b>
              </span>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Estado:</span>
                <Select
                  value={estado}
                  onValueChange={(v) => v && puedeMover && cambiarEstadoMiembro(v as EstadoId)}
                  disabled={!puedeMover}
                >
                  <SelectTrigger className="h-8 w-40"><SelectValue>{(v: string) => ESTADOS.find((e) => e.id === v)?.nombre ?? "Estado"}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {ESTADOS.map((e) => (<SelectItem key={e.id} value={e.id}>{e.nombre}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {estado === "atorado" && tarea.motivo_atorado && (
              <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300">
                <b className="font-semibold">Atorada:</b> {tarea.motivo_atorado}
              </div>
            )}
            {!puedeMover && (
              <p className="text-xs italic text-muted-foreground">
                Solo puedes comentar. El cambio de estado lo hace la persona responsable o un coordinador.
              </p>
            )}
          </div>
        )}

        {cargando ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando detalle…</p>
        ) : errorDetalle ? (
          /* Sin esto, un fallo de lectura se veía igual que una tarea sin
             comentarios ni subtareas. */
          <p className="py-6 text-center text-sm text-destructive">
            No se pudo cargar el detalle: {errorDetalle}
          </p>
        ) : (
          <>
            {/* ===== Checklist ===== */}
            <Seccion titulo={`Subtareas${checklist.length ? ` (${hechos}/${checklist.length})` : ""}`}>
              <div className="flex flex-col gap-1">
                {checklist.map((it) => (
                  <label key={it.id} className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60">
                    <input
                      type="checkbox"
                      checked={it.hecho}
                      disabled={!puedeContribuir}
                      onChange={(e) => accion(() => toggleChecklist(it.id, e.target.checked))}
                    />
                    <span className={cn("flex-1 text-sm", it.hecho && "text-muted-foreground line-through")}>
                      {it.texto}
                    </span>
                    {puedeContribuir && (
                      <button className="text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => accion(() => borrarChecklist(it.id))}>✕</button>
                    )}
                  </label>
                ))}
              </div>
              {puedeContribuir && (
                <div className="mt-2 flex gap-2">
                  <Input
                    value={nuevaSubtarea}
                    onChange={(e) => setNuevaSubtarea(e.target.value)}
                    placeholder="Agregar subtarea…"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && nuevaSubtarea.trim()) {
                        accion(() => agregarChecklist(tarea.id, nuevaSubtarea));
                        setNuevaSubtarea("");
                      }
                    }}
                  />
                </div>
              )}
            </Seccion>

            {/* ===== Enlaces ===== */}
            <Seccion titulo="Enlaces">
              <div className="flex flex-col gap-1">
                {(detalle?.enlaces ?? []).map((l) => (
                  <div key={l.id} className="flex items-center gap-2 text-sm">
                    <a href={l.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                      🔗 {l.titulo || l.url}
                    </a>
                    {puedeContribuir && (
                      <button className="text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => accion(() => borrarEnlace(l.id))}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              {puedeContribuir && (
                <div className="mt-2 flex flex-wrap gap-2">
                  <Input className="min-w-[38%] flex-1" value={enlaceTitulo}
                    onChange={(e) => setEnlaceTitulo(e.target.value)} placeholder="Nombre (opcional)" />
                  <Input className="min-w-[38%] flex-1" value={enlaceUrl}
                    onChange={(e) => setEnlaceUrl(e.target.value)} placeholder="https://…" />
                  <Button variant="outline" size="sm"
                    onClick={() => {
                      if (!enlaceUrl.trim()) return;
                      accion(() => agregarEnlace(tarea.id, enlaceTitulo, enlaceUrl));
                      setEnlaceTitulo(""); setEnlaceUrl("");
                    }}>Agregar</Button>
                </div>
              )}
            </Seccion>

            {/* ===== Adjuntos ===== */}
            <Seccion titulo="Adjuntos / fotos">
              <div className="flex flex-col gap-1">
                {(detalle?.adjuntos ?? []).map((a) => (
                  <div key={a.id} className="flex items-center gap-2 text-sm">
                    <button className="text-primary hover:underline" onClick={() => verAdjunto(a.storage_path)}>
                      📎 {a.nombre}
                    </button>
                    {(gestor || a.autor === currentUserId) && (
                      <button className="text-xs text-muted-foreground hover:text-destructive"
                        onClick={() => accion(() => borrarAdjunto(a.id, a.storage_path))}>✕</button>
                    )}
                  </div>
                ))}
              </div>
              {puedeContribuir && (
                <div className="mt-2">
                  <input ref={fileRef} type="file" className="hidden" onChange={onSubir} />
                  <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                    📎 Adjuntar archivo / foto
                  </Button>
                </div>
              )}
            </Seccion>

            {/* ===== Comentarios ===== */}
            <Seccion titulo="Comentarios">
              <div ref={hiloRef} className="flex flex-col gap-2">
                {(detalle?.comentarios ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground">Sin comentarios todavía.</p>
                )}
                {(detalle?.comentarios ?? []).map((c) => (
                  <div key={c.id} className="rounded-lg bg-muted/60 px-3 py-2">
                    <div className="mb-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                      <b className="text-foreground">{nombrePorId(c.autor)}</b>
                      <span>{fmtFechaHora(c.created_at)}</span>
                      {(gestor || c.autor === currentUserId) && (
                        <button className="ml-auto hover:text-destructive"
                          onClick={() => accion(() => borrarComentario(c.id))}>✕</button>
                      )}
                    </div>
                    <p className="whitespace-pre-wrap text-sm">{c.texto}</p>
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <Textarea ref={comentarioRef} rows={2} value={nuevoComentario}
                  onChange={(e) => setNuevoComentario(e.target.value)} placeholder="Escribe un comentario…" />
                <Button variant="outline" size="sm"
                  onClick={() => {
                    if (!nuevoComentario.trim()) return;
                    accion(() => comentar(tarea.id, nuevoComentario), "Comentario agregado.");
                    setNuevoComentario("");
                  }}>Comentar</Button>
              </div>
            </Seccion>

            {/* ===== Historial ===== */}
            <Seccion titulo="Historial de actividad">
              <div className="flex flex-col gap-1">
                {(detalle?.actividad ?? []).map((a) => (
                  <div key={a.id} className="text-xs text-muted-foreground">
                    <b className="text-foreground">{nombrePorId(a.autor)}</b> {a.texto}
                    <span> · {fmtFechaHora(a.created_at)}</span>
                  </div>
                ))}
              </div>
            </Seccion>
          </>
        )}

        {/* ===== Pie ===== */}
        <div className="mt-4 flex items-center gap-2 border-t pt-4">
          <span className="text-xs text-muted-foreground">
            Delegada por {nombrePorId(tarea.created_by)}
            {tarea.fecha_inicio && ` · Inicio ${formatearFecha(tarea.fecha_inicio)}`}
          </span>
          <div className="ml-auto flex gap-2">
            {gestor && (
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={borrar}>
                Borrar
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>
              {comoPagina ? "Volver" : "Cerrar"}
            </Button>
            {gestor && <Button onClick={guardarMeta}>Guardar</Button>}
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

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Seccion({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-4 border-t pt-3">
      <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      {children}
    </div>
  );
}
