"use client";

import { useState } from "react";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { toast } from "sonner";
import { DialogoPasos, Paso } from "@/components/compartido/dialogo-pasos";
import { CampoOpcion } from "@/components/compartido/campo-opcion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ESTADOS,
  PRIORIDADES,
  AREAS,
  CATEGORIAS_TAREA,
  VISIBILIDADES,
  obtenerArea,
  veAgencia,
} from "@/lib/catalogos";
import { SelectorEtiquetas } from "@/components/tareas/selector-etiquetas";
import { SelectorPersonas } from "@/components/tareas/selector-personas";
import { localInputAIso, hoyISO } from "@/lib/fecha";
import { crearTarea, type TaskInput } from "@/app/(app)/tareas/actions";
import { DatePicker } from "@/components/compartido/date-picker";
import type {
  Profile,
  AreaId,
  CategoriaTareaId,
  EspacioId,
  EstadoId,
  PrioridadId,
  VisibilidadId,
} from "@/lib/types";

const SIN_ASIGNAR = "none";
/* "Sin cliente" en el Select: es trabajo de la propia agencia (juntas,
   prospección, cobranza), no una tarea sin dueño. */
const SIN_EMPRESA = "sin-empresa";

/* Valores con los que arranca el diálogo cuando lo abre una plantilla ("pedir
   gráfico para el live"): todo sigue siendo editable antes de guardar. */
export type TaskInicial = {
  titulo?: string;
  descripcion?: string;
  area?: AreaId;
  etiquetas?: string[];
};

/* Diálogo para CREAR una tarea — lo abre cualquiera del equipo de casa, no solo
   quien coordina. Arranca con uno mismo como responsable, que es el caso de
   todos los días ("mi pendiente"), y desde ahí se puede pasar a quien sea.
   La edición y el detalle rico viven en task-detail.tsx. */
export function TaskDialog({
  equipo,
  currentUserId,
  onClose,
  espacio = "fresafit",
  empresas = [],
  empresaInicial = null,
  inicial,
}: {
  equipo: Profile[];
  currentUserId: string;
  onClose: () => void;
  /* El tablero desde el que se abrió: la tarea nace en ese negocio. */
  espacio?: EspacioId;
  empresas?: { id: string; nombre: string; color: string }[];
  /* Cliente preseleccionado (viene del filtro activo del tablero). */
  empresaInicial?: string | null;
  /* Prellenado de una plantilla; sin él, el diálogo arranca vacío como siempre. */
  inicial?: TaskInicial;
}) {
  const esAgencia = espacio === "agencia";
  /* En la agencia solo se asigna a quien la trabaja: el permiso por persona
     `ve_agencia` (el mismo que abre el espacio). Ofrecer a todo el equipo
     invitaba a colgarle una tarea de Nutravia a alguien que ni puede entrar a
     verla. Uno mismo se conserva aunque no lo tenga —abrió el diálogo desde ahí,
     así que lo tiene— para que el default «yo» nunca quede fuera de la lista. */
  const asignables = esAgencia
    ? equipo.filter((p) => veAgencia(p) || p.id === currentUserId)
    : equipo;
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState(inicial?.titulo ?? "");
  const [descripcion, setDescripcion] = useState(inicial?.descripcion ?? "");
  const [responsable, setResponsable] = useState(currentUserId || SIN_ASIGNAR);
  /* El área sigue al responsable: arranca con la del responsable inicial. Si la
     plantilla trae área, esa manda y elegir responsable ya no la pisa. */
  const [area, setArea] = useState<AreaId>(
    inicial?.area ?? equipo.find((p) => p.id === currentUserId)?.area ?? "operaciones",
  );
  const [areaManual, setAreaManual] = useState(Boolean(inicial?.area));
  const [prioridad, setPrioridad] = useState<PrioridadId>("media");
  const [estado, setEstado] = useState<EstadoId>("por_hacer");
  /* Fecha límite por defecto: hoy (se le pidió en la junta; editable). */
  const [fecha, setFecha] = useState(hoyISO());
  const [recordatorio, setRecordatorio] = useState("");
  const [motivoAtorado, setMotivoAtorado] = useState("");
  const [etiquetas, setEtiquetas] = useState<string[]>(inicial?.etiquetas ?? []);
  const [coasignados, setCoasignados] = useState<string[]>([]);
  const [empresa, setEmpresa] = useState(empresaInicial ?? SIN_EMPRESA);
  /* Nace INTERNA siempre. Es la regla del módulo de empresas y no una
     preferencia del formulario: compartir es un acto deliberado, y es más fácil
     compartir después que arrepentirse de haber expuesto algo. */
  const [visibilidad, setVisibilidad] = useState<VisibilidadId>("interno");
  const [categoria, setCategoria] = useState<CategoriaTareaId>("otro");

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
      visibilidad: esAgencia ? visibilidad : undefined,
      categoria: esAgencia ? categoria : null,
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
    <DialogoPasos
      titulo={esAgencia ? "Nueva tarea de la Agencia" : "Nueva tarea"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar="Crear tarea"
      pending={pending}
      anchoEscritorio="md:max-w-lg"
    >
      <Paso
        titulo="¿Qué hay que hacer?"
        valido={Boolean(titulo.trim())}
        motivoInvalido="Ponle un título a la tarea."
      >
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
          {/* Sin autoFocus a propósito: el initialFocus de Base UI ya evita
              enfocar cuando el diálogo se abrió por toque, y así el teclado no
              salta encima de la pantalla completa del teléfono. */}
          <Input
            id="titulo"
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
      </Paso>

      {/* Solo en la agencia: de qué va el pedido y quién puede verlo. En el
          tablero de Fresafit no hay a quién compartirle nada, así que el paso
          entero desaparece en vez de enseñar dos campos que no aplican. */}
      {esAgencia && (
        <Paso
          titulo="¿De qué va y quién la ve?"
          ayuda="Nace interna: el cliente no la verá hasta que alguien lo decida."
        >
          <CampoOpcion
            etiqueta="Categoría"
            opciones={CATEGORIAS_TAREA}
            valor={categoria}
            onCambio={setCategoria}
            ayuda="Decide también qué hace falta para poder cerrarla."
          />
          <CampoOpcion
            etiqueta="Quién la ve"
            opciones={VISIBILIDADES}
            valor={visibilidad}
            onCambio={setVisibilidad}
            ayuda={
              visibilidad === "compartido"
                ? "El cliente verá el título, la descripción, los comentarios y los archivos."
                : visibilidad === "privado"
                  ? "Solo dirección. Ni el resto del equipo."
                  : "Solo el equipo de Fresafit."
            }
          />
        </Paso>
      )}

      <Paso
        titulo="¿Quién la hace?"
        ayuda="El área se llena sola con la de la responsable."
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label>Responsable</Label>
            <Select value={responsable} onValueChange={(v) => elegirResponsable(v ?? SIN_ASIGNAR)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) =>
                    v === SIN_ASIGNAR ? "Sin asignar" : (asignables.find((p) => p.id === v)?.nombre ?? "Responsable")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_ASIGNAR}>Sin asignar</SelectItem>
                {asignables.map((p) => (
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
            equipo={asignables}
            seleccionados={coasignados}
            principalId={responsable === SIN_ASIGNAR ? null : responsable}
            onToggle={toggleCoasignado}
          />
          <span className="text-xs text-muted-foreground">
            Verán la tarea, podrán moverla y les llegarán los avisos igual que a la responsable.
          </span>
        </div>
      </Paso>

      <Paso titulo="¿Para cuándo y cómo va?">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <CampoOpcion
            etiqueta="Prioridad"
            opciones={PRIORIDADES}
            valor={prioridad}
            onCambio={setPrioridad}
          />
          <CampoOpcion etiqueta="Estado" opciones={ESTADOS} valor={estado} onCambio={setEstado} />

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="fecha">Fecha límite</Label>
            <DatePicker id="fecha" value={fecha} onChange={setFecha} limpiable abiertoEnMovil />
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
      </Paso>

      <Paso
        titulo="Recordatorio y etiquetas"
        ayuda="Opcional: puedes crearla así y ajustarlo después."
      >
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
      </Paso>
    </DialogoPasos>
  );
}
