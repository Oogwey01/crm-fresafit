"use client";

import { useMemo, useState } from "react";
import { TabsSeccion } from "@/components/compartido/tabs-seccion";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { TareasCliente } from "@/components/agencia-clientes/tareas-cliente";
import { ListaDocumentos } from "@/components/documentos/lista-documentos";
import { PanelAvance } from "@/components/avance/panel-avance";
import { ActividadCliente } from "@/components/agencia-clientes/actividad-cliente";
import { ESTADOS_CERRADOS, obtenerRolPortal } from "@/lib/catalogos";
import { esVencida } from "@/lib/fecha";
import type { AvanceCompleto } from "@/lib/avance/consulta";
import type {
  AgenciaEmpresa,
  EmpresaDocumentoConVersion,
  Profile,
  RolId,
  TaskConResponsable,
} from "@/lib/types";

/* El espacio de trabajo con un cliente. Las pestañas de Documentos, Avance y
   Actividad llegan en las fases 2, 3 y 4: se anuncian desde ya —en vez de
   aparecer de golpe— porque el equipo tiene que saber que ahí va a vivir eso y
   no empezar a guardarlo en otro sitio mientras tanto. */
type Pestana = "tareas" | "documentos" | "avance" | "actividad";

export function EspacioCliente({
  empresa,
  tareas,
  documentos,
  avance,
  pendientes,
  rango,
  equipo,
  contactos,
  idsDelCliente,
  comentariosPorTarea,
  currentUserId,
  rol,
  veTodo,
}: {
  empresa: Pick<
    AgenciaEmpresa,
    "id" | "nombre" | "slug" | "color" | "giro" | "contacto_nombre" | "contacto_correo"
  > & { activa: boolean };
  tareas: TaskConResponsable[];
  documentos: EmpresaDocumentoConVersion[];
  avance: AvanceCompleto;
  pendientes: { deFresafit: TaskConResponsable[]; delCliente: TaskConResponsable[] };
  rango: { desde: string; hasta: string };
  equipo: Profile[];
  /* La gente del cliente que entra al portal. */
  contactos: Profile[];
  idsDelCliente: string[];
  comentariosPorTarea: Record<string, number>;
  currentUserId: string;
  rol: RolId;
  /* Dirección: la pestaña de Actividad (el expediente) es suya y de nadie más. */
  veTodo: boolean;
}) {
  const [pestana, setPestana] = useState<Pestana>("tareas");
  const [lado, setLado] = useState<"todas" | "nos_piden" | "pedimos">("todas");
  const [busqueda, setBusqueda] = useState("");

  const delCliente = useMemo(() => new Set(idsDelCliente), [idsDelCliente]);

  const { nosPiden, pedimos, vencidas, compartidas } = useMemo(() => {
    let nosPiden = 0;
    let pedimos = 0;
    let vencidas = 0;
    let compartidas = 0;
    for (const t of tareas) {
      if (t.visibilidad === "compartido") compartidas += 1;
      if (ESTADOS_CERRADOS.includes(t.estado as (typeof ESTADOS_CERRADOS)[number])) continue;
      if (delCliente.has(t.created_by ?? "")) nosPiden += 1;
      else pedimos += 1;
      if (esVencida(t.fecha_limite, t.estado)) vencidas += 1;
    }
    return { nosPiden, pedimos, vencidas, compartidas };
  }, [tareas, delCliente]);

  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return tareas.filter((t) => {
      if (lado === "nos_piden" && !delCliente.has(t.created_by ?? "")) return false;
      if (lado === "pedimos" && delCliente.has(t.created_by ?? "")) return false;
      if (!q) return true;
      return (
        t.titulo.toLowerCase().includes(q) || (t.descripcion ?? "").toLowerCase().includes(q)
      );
    });
  }, [tareas, lado, busqueda, delCliente]);

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span
            className="size-11 shrink-0 rounded-2xl"
            style={{ backgroundColor: empresa.color }}
            aria-hidden="true"
          />
          <div className="leading-tight">
            <h1 className="text-[20px] font-bold">
              {empresa.nombre}
              {!empresa.activa && (
                <span className="ml-2 align-middle text-[12px] font-medium text-muted-foreground">
                  inactiva
                </span>
              )}
            </h1>
            <p className="text-[13px] text-muted-foreground">
              {empresa.giro ?? "—"}
              {empresa.contacto_nombre ? ` · ${empresa.contacto_nombre}` : ""}
            </p>
          </div>
        </div>

        <dl className="flex gap-5 text-[13px]">
          <div>
            <dt className="text-muted-foreground">Nos piden</dt>
            <dd className="text-[18px] font-bold">{nosPiden}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Pedimos</dt>
            <dd className="text-[18px] font-bold">{pedimos}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Compartidas</dt>
            <dd className="text-[18px] font-bold">{compartidas}</dd>
          </div>
          {vencidas > 0 && (
            <div>
              <dt className="text-destructive">Vencidas</dt>
              <dd className="text-[18px] font-bold text-destructive">{vencidas}</dd>
            </div>
          )}
        </dl>
      </header>

      {/* Quién entra al portal por parte del cliente. Va arriba y siempre a la
          vista: la pregunta «¿a quién le llega esto?» es la primera que se hace
          alguien antes de compartir algo. */}
      {contactos.length > 0 && (
        <p className="text-[13px] text-muted-foreground">
          Entran al portal:{" "}
          {contactos.map((c, i) => (
            <span key={c.id}>
              {i > 0 && ", "}
              <span className="font-medium text-foreground">{c.nombre}</span>
              {c.rol_portal && ` (${obtenerRolPortal(c.rol_portal)?.nombre.toLowerCase()})`}
            </span>
          ))}
        </p>
      )}

      <TabsSeccion
        opciones={
          [
            ["tareas", "Tareas"],
            ["documentos", "Documentos"],
            ["avance", "Avance"],
            ...(veTodo ? ([["actividad", "Actividad"]] as const) : []),
          ] as const
        }
        valor={pestana}
        onCambio={(v) => setPestana(v as Pestana)}
      />

      {pestana === "tareas" && (
        <>
          <div className="flex flex-wrap items-center gap-2.5">
            <ControlSegmentado
              opciones={
                [
                  ["todas", "Todas"],
                  ["nos_piden", "Nos piden"],
                  ["pedimos", "Pedimos"],
                ] as const
              }
              valor={lado}
              onCambio={setLado}
            />
            <CampoBusqueda
              valor={busqueda}
              onCambio={setBusqueda}
              placeholder="Buscar en las tareas de este cliente…"
              className="min-w-[200px] flex-1"
            />
          </div>
          <TareasCliente
            tareas={visibles}
            equipo={equipo}
            empresa={empresa}
            delCliente={delCliente}
            comentariosPorTarea={comentariosPorTarea}
            currentUserId={currentUserId}
            rol={rol}
          />
        </>
      )}

      {pestana === "documentos" && (
        <ListaDocumentos
          documentos={documentos}
          empresaId={empresa.id}
          empresaNombre={empresa.nombre}
          puedeGestionar
        />
      )}

      {pestana === "avance" && (
        <PanelAvance
          empresaId={empresa.id}
          empresaNombre={empresa.nombre}
          empresaSlug={empresa.slug}
          datos={avance}
          pendientes={pendientes}
          puedeEditar
          rango={rango}
        />
      )}

      {pestana === "actividad" && <ActividadCliente empresaId={empresa.id} />}
    </div>
  );
}
