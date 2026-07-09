"use client";

import { useState, useTransition } from "react";
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
import {
  ESTADOS,
  PRIORIDADES,
  AREAS,
  ETIQUETAS,
  ESTADO_ITEMS,
  PRIORIDAD_ITEMS,
  AREA_ITEMS,
} from "@/lib/catalogos";
import { crearTarea, type TaskInput } from "@/app/(app)/tareas/actions";
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
  const [pending, startTransition] = useTransition();
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [responsable, setResponsable] = useState(currentUserId || SIN_ASIGNAR);
  const [area, setArea] = useState<AreaId>("operaciones");
  const [prioridad, setPrioridad] = useState<PrioridadId>("media");
  const [estado, setEstado] = useState<EstadoId>("por_hacer");
  const [fecha, setFecha] = useState("");
  const [etiquetas, setEtiquetas] = useState<string[]>([]);

  const responsableItems = [
    { value: SIN_ASIGNAR, label: "Sin asignar" },
    ...equipo.map((p) => ({ value: p.id, label: p.nombre })),
  ];

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
      etiquetas,
    };
    startTransition(async () => {
      try {
        const r = await crearTarea(input);
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success("Tarea creada.");
        onClose();
      } catch {
        toast.error("No se pudo guardar. Revisa tu conexión.");
      }
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
              <Select items={responsableItems} value={responsable} onValueChange={(v) => setResponsable(v ?? SIN_ASIGNAR)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
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
              <Label>Área</Label>
              <Select items={AREA_ITEMS} value={area} onValueChange={(v) => v && setArea(v as AreaId)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
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
              <Select items={PRIORIDAD_ITEMS} value={prioridad} onValueChange={(v) => v && setPrioridad(v as PrioridadId)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
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
              <Select items={ESTADO_ITEMS} value={estado} onValueChange={(v) => v && setEstado(v as EstadoId)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
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
              <Input id="fecha" type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </div>
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
