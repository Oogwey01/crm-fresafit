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
import { ESTADOS, PRIORIDADES, AREAS, obtenerArea } from "@/lib/catalogos";
import { SelectorEtiquetas } from "@/components/tareas/selector-etiquetas";
import { SelectorPersonas } from "@/components/tareas/selector-personas";
import { localInputAIso, hoyISO } from "@/lib/fecha";
import { crearTarea, type TaskInput } from "@/app/(app)/tareas/actions";
import { DatePicker } from "@/components/compartido/date-picker";
import type { Profile, AreaId, EspacioId, EstadoId, PrioridadId } from "@/lib/types";

const SIN_ASIGNAR = "none";
/* "Sin cliente" en el Select: es trabajo de la propia agencia (juntas,
   prospección, cobranza), no una tarea sin dueño. */
const SIN_EMPRESA = "sin-empresa";

/* Diálogo para CREAR una tarea (solo dirección/coordinación). La edición y el
   detalle rico viven en task-detail.tsx. */
export function TaskDialog({
  equipo,
  currentUserId,
  onClose,
  espacio = "fresafit",
  empresas = [],
  empresaInicial = null,
}: {
  equipo: Profile[];
  currentUserId: string;
  onClose: () => void;
  /* El tablero desde el que se abrió: la tarea nace en ese negocio. */
  espacio?: EspacioId;
  empresas?: { id: string; nombre: string; color: string }[];
  /* Cliente preseleccionado (viene del filtro activo del tablero). */
  empresaInicial?: string | null;
}) {
  const esAgencia = espacio === "agencia";
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [responsable, setResponsable] = useState(currentUserId || SIN_ASIGNAR);
  /* El área sigue al responsable: arranca con la del responsable inicial. */
  const [area, setArea] = useState<AreaId>(
    equipo.find((p) => p.id === currentUserId)?.area ?? "operaciones",
  );
  const [areaManual, setAreaManual] = useState(false);
  const [prioridad, setPrioridad] = useState<PrioridadId>("media");
  const [estado, setEstado] = useState<EstadoId>("por_hacer");
  /* Fecha límite por defecto: hoy (se le pidió en la junta; editable). */
  const [fecha, setFecha] = useState(hoyISO());
  const [recordatorio, setRecordatorio] = useState("");
  const [motivoAtorado, setMotivoAtorado] = useState("");
  const [etiquetas, setEtiquetas] = useState<string[]>([]);
  const [coasignados, setCoasignados] = useState<string[]>([]);
  const [empresa, setEmpresa] = useState(empresaInicial ?? SIN_EMPRESA);

  /* Al elegir responsable, el área se autollena con la de su perfil (editable).
     Si esa persona estaba como acompañante, se sale de la lista: ya está en la
     tarea como principal. */
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
      espacio,
      empresa_id: esAgencia && empresa !== SIN_EMPRESA ? empresa : null,
      coasignados,
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
          <DialogTitle>{esAgencia ? "Nueva tarea de la Agencia" : "Nueva tarea"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {/* El cliente va primero en la agencia: es la primera decisión ("¿de
              quién es esto?") y de ahí cuelga todo lo demás. */}
          {esAgencia && (
            <div className="flex flex-col gap-1.5">
              <Label>Cliente</Label>
              <Select value={empresa} onValueChange={(v) => setEmpresa(v ?? SIN_EMPRESA)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === SIN_EMPRESA
                        ? "De la agencia (sin cliente)"
                        : (empresas.find((e) => e.id === v)?.nombre ?? "Cliente")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                  <SelectItem value={SIN_EMPRESA}>De la agencia (sin cliente)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

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

            {/* El área la dicta el perfil del responsable: pedirla otra vez al
                crear la tarea es trabajo de más ("si le creo una tarea a René no
                es necesario poner el área, su área ya es operaciones"). Se
                enseña como dato y solo se edita si alguien lo pide. */}
            <div className="flex flex-col gap-1.5">
              <Label>Área</Label>
              {areaManual ? (
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
              ) : (
                <div className="flex h-9 items-center gap-2 text-sm">
                  <span className="font-medium">{obtenerArea(area)?.nombre ?? area}</span>
                  <button
                    type="button"
                    onClick={() => setAreaManual(true)}
                    className="ml-auto text-xs font-medium text-primary hover:underline"
                  >
                    cambiar
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>¿Alguien más? (opcional)</Label>
            <SelectorPersonas
              equipo={equipo}
              seleccionados={coasignados}
              principalId={responsable === SIN_ASIGNAR ? null : responsable}
              onToggle={toggleCoasignado}
            />
            <span className="text-xs text-muted-foreground">
              Verán la tarea, podrán moverla y les llegarán los avisos igual que a la responsable.
            </span>
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
            <SelectorEtiquetas area={area} seleccionadas={etiquetas} onToggle={toggleEtiqueta} />
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
