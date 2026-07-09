"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { ESTADOS, PRIORIDADES, AREAS, ETIQUETAS, esGestor } from "@/lib/catalogos";
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

const SIN_ASIGNAR = "none";

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
  onClose,
}: {
  tarea: TaskConResponsable;
  equipo: Profile[];
  rol: RolId;
  currentUserId: string;
  onClose: () => void;
}) {
  const gestor = esGestor(rol);
  const esResponsable = tarea.responsable_id === currentUserId;
  const puedeContribuir = gestor || esResponsable;
  const puedeMover = gestor || esResponsable;

  const nombrePorId = (id: string | null) =>
    id ? (equipo.find((p) => p.id === id)?.nombre ?? "?") : "?";

  const [detalle, setDetalle] = useState<TaskDetalle | null>(null);
  const [cargando, setCargando] = useState(true);
  const [, startTransition] = useTransition();

  // Campos de meta (edición para gestor).
  const [titulo, setTitulo] = useState(tarea.titulo);
  const [descripcion, setDescripcion] = useState(tarea.descripcion ?? "");
  const [responsable, setResponsable] = useState(tarea.responsable_id ?? SIN_ASIGNAR);
  const [area, setArea] = useState<AreaId>(tarea.area);
  const [prioridad, setPrioridad] = useState<PrioridadId>(tarea.prioridad);
  const [estado, setEstado] = useState<EstadoId>(tarea.estado);
  const [fecha, setFecha] = useState(tarea.fecha_limite ?? "");
  const [etiquetas, setEtiquetas] = useState<string[]>(tarea.etiquetas ?? []);

  const [nuevoComentario, setNuevoComentario] = useState("");
  const [nuevaSubtarea, setNuevaSubtarea] = useState("");
  const [enlaceTitulo, setEnlaceTitulo] = useState("");
  const [enlaceUrl, setEnlaceUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  async function recargar() {
    setDetalle(await cargarDetalle(tarea.id));
  }
  useEffect(() => {
    let vivo = true;
    cargarDetalle(tarea.id).then((d) => {
      if (vivo) {
        setDetalle(d);
        setCargando(false);
      }
    });
    return () => {
      vivo = false;
    };
  }, [tarea.id]);

  function accion(fn: () => Promise<{ ok: true } | { error: string }>, okMsg?: string) {
    startTransition(async () => {
      try {
        const r = await fn();
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        if (okMsg) toast.success(okMsg);
        await recargar();
      } catch {
        toast.error("Algo falló. Revisa tu conexión.");
      }
    });
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
      etiquetas,
    };
    startTransition(async () => {
      const r = await editarTarea(tarea.id, input);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success("Cambios guardados.");
      onClose();
    });
  }

  /* --- Estado (miembro responsable): mover al vuelo --- */
  function cambiarEstadoMiembro(nuevo: EstadoId) {
    setEstado(nuevo);
    accion(() => moverTarea(tarea.id, nuevo));
  }

  function toggleEtiquetaGestor(id: string) {
    const next = etiquetas.includes(id) ? etiquetas.filter((x) => x !== id) : [...etiquetas, id];
    setEtiquetas(next);
    accion(() => guardarEtiquetas(tarea.id, next));
  }

  function borrar() {
    if (!confirm("¿Borrar esta tarea? No se puede deshacer.")) return;
    startTransition(async () => {
      const r = await borrarTarea(tarea.id);
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      toast.success("Tarea borrada.");
      onClose();
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
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{gestor ? "Editar tarea" : "Detalle de la tarea"}</DialogTitle>
        </DialogHeader>

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
                <Select value={responsable} onValueChange={(v) => setResponsable(v ?? SIN_ASIGNAR)}>
                  <SelectTrigger className="w-full"><SelectValue>{(v: string) => v === SIN_ASIGNAR ? "Sin asignar" : (equipo.find((p) => p.id === v)?.nombre ?? "Responsable")}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
                    {equipo.map((p) => (<SelectItem key={p.id} value={p.id}>{p.nombre}</SelectItem>))}
                  </SelectContent>
                </Select>
              </Meta>
              <Meta label="Área">
                <Select value={area} onValueChange={(v) => v && setArea(v as AreaId)}>
                  <SelectTrigger className="w-full"><SelectValue>{(v: string) => AREAS.find((a) => a.id === v)?.nombre ?? "Área"}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {AREAS.map((a) => (<SelectItem key={a.id} value={a.id}>{a.nombre}</SelectItem>))}
                  </SelectContent>
                </Select>
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
                <Input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
              </Meta>
            </div>

            <Seccion titulo="Etiquetas">
              <div className="flex flex-wrap gap-1.5">
                {ETIQUETAS.map((et) => {
                  const on = etiquetas.includes(et.id);
                  return (
                    <button
                      key={et.id}
                      type="button"
                      onClick={() => toggleEtiquetaGestor(et.id)}
                      className={cn(
                        "rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                        on ? "text-white" : "text-muted-foreground hover:bg-accent",
                      )}
                      style={on ? { backgroundColor: et.color, borderColor: et.color } : undefined}
                    >
                      {et.nombre}
                    </button>
                  );
                })}
              </div>
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
            {!puedeMover && (
              <p className="text-xs italic text-muted-foreground">
                Solo puedes comentar. El cambio de estado lo hace la persona responsable o un coordinador.
              </p>
            )}
          </div>
        )}

        {cargando ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando detalle…</p>
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
              <div className="flex flex-col gap-2">
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
                <Textarea rows={2} value={nuevoComentario}
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
            Creada por {nombrePorId(tarea.created_by)}
          </span>
          <div className="ml-auto flex gap-2">
            {gestor && (
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={borrar}>
                Borrar
              </Button>
            )}
            <Button variant="outline" onClick={onClose}>Cerrar</Button>
            {gestor && <Button onClick={guardarMeta}>Guardar</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
