"use client";

import { useState } from "react";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
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
import { Label } from "@/components/ui/label";
import { ESTADOS, PRIORIDADES, AREAS, ETIQUETAS } from "@/lib/catalogos";
import { localInputAIso, hoyISO } from "@/lib/fecha";
import { crearTarea, type TaskInput } from "@/app/(app)/tareas/actions";
import { DatePicker } from "@/components/compartido/date-picker";
import type { Profile, AreaId, EstadoId, PrioridadId } from "@/lib/types";
import { cn } from "@/lib/utils";

const SIN_ASIGNAR = "none";

/* Diálogo para CREAR una tarea (solo dirección/coordinación). La edición y el
   detalle rico viven en task-detail.tsx. */
export function TaskDialog({
  equipo,
  currentUserId,
  onClose,
}: {
  equipo: Profile[];
  currentUserId: string;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [responsable, setResponsable] = useState(currentUserId || SIN_ASIGNAR);
  /* El área sigue al responsable: arranca con la del responsable inicial. */
  const [area, setArea] = useState<AreaId>(
    equipo.find((p) => p.id === currentUserId)?.area ?? "operaciones",
  );
  const [prioridad, setPrioridad] = useState<PrioridadId>("media");
  const [estado, setEstado] = useState<EstadoId>("por_hacer");
  /* Fecha límite por defecto: hoy (se le pidió en la junta; editable). */
  const [fecha, setFecha] = useState(hoyISO());
  const [recordatorio, setRecordatorio] = useState("");
  const [motivoAtorado, setMotivoAtorado] = useState("");
  const [etiquetas, setEtiquetas] = useState<string[]>([]);

  /* Al elegir responsable, el área se autollena con la de su perfil (editable). */
  function elegirResponsable(v: string) {
    const id = v ?? SIN_ASIGNAR;
    setResponsable(id);
    if (id !== SIN_ASIGNAR) {
      const p = equipo.find((x) => x.id === id);
      if (p?.area) setArea(p.area);
    }
  }

  function toggleEtiqueta(id: string) {
    setEtiquetas((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function guardar() {
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
    ejecutar(() => crearTarea(input), {
      ok: "Tarea creada.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Nueva tarea</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="titulo">Título</Label>
            <Input
              id="titulo"
              autoFocus
              placeholder="¿Qué hay que hacer?"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="descripcion">Descripción (opcional)</Label>
            <Textarea
              id="descripcion"
              rows={3}
              placeholder="Detalles, contexto…"
              value={descripcion}
              onChange={(e) => setDescripcion(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Responsable</Label>
              <Select value={responsable} onValueChange={(v) => elegirResponsable(v ?? SIN_ASIGNAR)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === SIN_ASIGNAR ? "Sin asignar" : (equipo.find((p) => p.id === v)?.nombre ?? "Responsable")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
                  {equipo.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Área (según responsable)</Label>
              <Select value={area} onValueChange={(v) => v && setArea(v as AreaId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => AREAS.find((a) => a.id === v)?.nombre ?? "Área"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {AREAS.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Prioridad</Label>
              <Select value={prioridad} onValueChange={(v) => v && setPrioridad(v as PrioridadId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => PRIORIDADES.find((p) => p.id === v)?.nombre ?? "Prioridad"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PRIORIDADES.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label>Estado</Label>
              <Select value={estado} onValueChange={(v) => v && setEstado(v as EstadoId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => ESTADOS.find((e) => e.id === v)?.nombre ?? "Estado"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ESTADOS.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fecha">Fecha límite</Label>
              <DatePicker id="fecha" value={fecha} onChange={setFecha} limpiable />
            </div>
          </div>

          {estado === "atorado" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="motivo-atorado">¿Por qué está atorada?</Label>
              <Textarea
                id="motivo-atorado"
                rows={2}
                placeholder="Qué necesitas de vuelta para poder avanzar…"
                value={motivoAtorado}
                onChange={(e) => setMotivoAtorado(e.target.value)}
              />
              <span className="text-xs text-muted-foreground">
                Le llegará un aviso a quien la delegó.
              </span>
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="recordatorio">Recordarme el… (opcional)</Label>
            <Input
              id="recordatorio"
              type="datetime-local"
              value={recordatorio}
              onChange={(e) => setRecordatorio(e.target.value)}
            />
            <span className="text-xs text-muted-foreground">
              Les llegará un aviso al responsable y a ti (quien delega) en ese momento.
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Etiquetas</Label>
            <div className="flex flex-wrap gap-1.5">
              {ETIQUETAS.map((et) => {
                const on = etiquetas.includes(et.id);
                return (
                  <button
                    key={et.id}
                    type="button"
                    onClick={() => toggleEtiqueta(et.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors",
                      on ? "text-white" : "text-muted-foreground hover:bg-accent",
                    )}
                    style={on ? { backgroundColor: et.color, borderColor: et.color } : undefined}
                  >
                    {et.nombre}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button onClick={guardar} disabled={pending}>
            {pending ? "Guardando…" : "Crear tarea"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
