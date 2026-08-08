"use client";

import { useState } from "react";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { toast } from "sonner";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaEtiquetas,
  PastillaFecha,
  PastillaFechaHora,
  PastillaOpcion,
  PastillaPersona,
  PastillaPersonas,
} from "@/components/compartido/pastillas-campo";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { localInputAIso, hoyISO } from "@/lib/fecha";
import { crearTarea, type TaskInput } from "@/app/(app)/tareas/actions";
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
/* "Sin cliente" en el selector: es trabajo de la propia agencia (juntas,
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

   En la computadora va "estilo Linear": título y descripción grandes arriba, y
   todo lo que ya trae un buen default (responsable=yo, fecha=hoy, prioridad
   media…) como pastillas compactas que solo se tocan para cambiar. En el
   teléfono sigue siendo el wizard por pasos de siempre.

   La edición y el detalle rico viven en detalle-tarea.tsx. */
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

  const opcionesEmpresa = [
    ...empresas.map((e) => ({ id: e.id, nombre: e.nombre, color: e.color })),
    { id: SIN_EMPRESA, nombre: "De la agencia (sin cliente)" },
  ];

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
    <DialogoFormulario
      titulo={esAgencia ? "Nueva tarea de la Agencia" : "Nueva tarea"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar="Crear tarea"
      pending={pending}
      anchoEscritorio="md:max-w-xl"
    >
      <Hero
        pasoTitulo="¿Qué hay que hacer?"
        valido={Boolean(titulo.trim())}
        motivoInvalido="Ponle un título a la tarea."
      >
        {/* El cliente va primero en la agencia: es la primera decisión ("¿de
            quién es esto?") y de ahí cuelga todo lo demás. En escritorio es la
            pastillita sobre el título, como el proyecto en Linear. */}
        {esAgencia && (
          <div className="md:mb-1">
            <PastillaOpcion
              etiqueta="Cliente"
              opciones={opcionesEmpresa}
              valor={empresa}
              onCambio={setEmpresa}
            />
          </div>
        )}

        <CampoHero
          id="titulo"
          etiqueta="Título"
          placeholder="¿Qué hay que hacer?"
          valor={titulo}
          onCambio={setTitulo}
        />
        <DescripcionHero
          id="descripcion"
          etiqueta="Descripción"
          placeholder="Detalles, contexto… (opcional)"
          valor={descripcion}
          onCambio={setDescripcion}
        />
      </Hero>

      {/* Solo en la agencia: de qué va el pedido y quién puede verlo. En el
          tablero de Fresafit no hay a quién compartirle nada, así que la zona
          entera desaparece en vez de enseñar dos campos que no aplican. */}
      {esAgencia && (
        <Propiedades
          pasoTitulo="¿De qué va y quién la ve?"
          pasoAyuda="Nace interna: el cliente no la verá hasta que alguien lo decida."
        >
          <PastillaOpcion
            etiqueta="Categoría"
            opciones={CATEGORIAS_TAREA}
            valor={categoria}
            onCambio={setCategoria}
            ayuda="Decide también qué hace falta para poder cerrarla."
          />
          <PastillaOpcion
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
        </Propiedades>
      )}

      <Propiedades
        pasoTitulo="¿Quién la hace?"
        pasoAyuda="El área se llena sola con la de la responsable."
      >
        <PastillaPersona
          etiqueta="Responsable"
          equipo={asignables}
          valor={responsable}
          onCambio={elegirResponsable}
          opcionNula={{ id: SIN_ASIGNAR, nombre: "Sin asignar" }}
        />

        {/* El área la dicta el perfil del responsable: pedirla otra vez al
            crear la tarea es trabajo de más. En escritorio la pastilla ya ES
            compacta (tocarla equivale al "cambiar"); en el teléfono se conserva
            el dato con su botoncito. */}
        <PastillaOpcion
          etiqueta="Área"
          opciones={AREAS}
          valor={area}
          onCambio={(v) => {
            setArea(v);
            setAreaManual(true);
          }}
          sinTinte
          contenidoMovil={
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
          }
        />

        <PastillaPersonas
          etiqueta="¿Alguien más?"
          etiquetaVacia="Alguien más"
          equipo={asignables}
          seleccionados={coasignados}
          principalId={responsable === SIN_ASIGNAR ? null : responsable}
          onToggle={toggleCoasignado}
          ayuda="Verán la tarea, podrán moverla y les llegarán los avisos igual que a la responsable."
        />
      </Propiedades>

      <Propiedades pasoTitulo="¿Para cuándo y cómo va?">
        <PastillaOpcion etiqueta="Estado" opciones={ESTADOS} valor={estado} onCambio={setEstado} />
        <PastillaOpcion
          etiqueta="Prioridad"
          opciones={PRIORIDADES}
          valor={prioridad}
          onCambio={setPrioridad}
        />
        <PastillaFecha
          etiqueta="Fecha límite"
          etiquetaVacia="Fecha límite"
          valor={fecha}
          onCambio={setFecha}
          limpiable
        />

        {estado === "atorado" && (
          <Campo
            etiqueta="¿Por qué está atorada?"
            htmlFor="motivo-atorado"
            ayuda="Le llegará un aviso a quien la delegó."
            className="w-full"
          >
            <Textarea
              id="motivo-atorado"
              rows={2}
              placeholder="Qué necesitas de vuelta para poder avanzar…"
              value={motivoAtorado}
              onChange={(e) => setMotivoAtorado(e.target.value)}
            />
          </Campo>
        )}
      </Propiedades>

      <Propiedades
        pasoTitulo="Recordatorio y etiquetas"
        pasoAyuda="Opcional: puedes crearla así y ajustarlo después."
      >
        <PastillaFechaHora
          etiqueta="Recordarme el…"
          etiquetaVacia="Aviso"
          valor={recordatorio}
          onCambio={setRecordatorio}
          ayuda="Les llegará un aviso al responsable y a ti (quien delega) en ese momento."
          idMovil="recordatorio"
        />
        <PastillaEtiquetas area={area} seleccionadas={etiquetas} onToggle={toggleEtiqueta} />
      </Propiedades>
    </DialogoFormulario>
  );
}
