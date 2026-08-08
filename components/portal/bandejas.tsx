"use client";

import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { BarraHerramientas } from "@/components/compartido/barra-herramientas";
import { TarjetaPedido } from "@/components/portal/tarjeta-pedido";
import { DialogoPedido } from "@/components/portal/dialogo-pedido";
import { DetallePedido } from "@/components/portal/detalle-pedido";
import { ESTADOS_CERRADOS } from "@/lib/catalogos";
import { esVencida } from "@/lib/fecha";
import type { AgenciaEmpresa, TaskConResponsable } from "@/lib/types";

/* ============================================================================
   Las dos bandejas del cliente
   ----------------------------------------------------------------------------
   «Lo que nos piden» son las tareas que abrió Fresafit; «lo que pedimos», las
   que abrió su empresa. La diferencia es una sola columna —quién la creó—, y por
   eso no hay dos tablas ni dos consultas: es la misma lista partida en dos.

   A propósito NO es el kanban del equipo. Quien entra aquí lo hace de vez en
   cuando, muchas veces desde el teléfono, para ver qué le falta y contestar. Una
   lista con lo urgente arriba responde eso; cinco columnas arrastrables, no.
   ============================================================================ */

type Bandeja = "nos_piden" | "pedimos";

export function BandejasPortal({
  tareas,
  empresa,
  currentUserId,
  companeros,
  puedeCrear,
  comentariosPorTarea,
}: {
  tareas: TaskConResponsable[];
  empresa: Pick<AgenciaEmpresa, "id" | "nombre" | "color" | "giro"> | null;
  currentUserId: string;
  /* Los ids de la gente de MI empresa (yo incluido). Es lo que decide en qué
     bandeja cae cada tarea, y se resuelve en el servidor: desde aquí no se puede
     saber si un `created_by` desconocido es un compañero o alguien de Fresafit. */
  companeros: string[];
  puedeCrear: boolean;
  comentariosPorTarea: Record<string, number>;
}) {
  const [bandeja, setBandeja] = useState<Bandeja>("nos_piden");
  const [busqueda, setBusqueda] = useState("");
  const [verCerradas, setVerCerradas] = useState(false);
  const [abriendo, setAbriendo] = useState(false);
  const [detalle, setDetalle] = useState<TaskConResponsable | null>(null);

  /* La única diferencia entre las dos bandejas es quién abrió la tarea. Si la
     abrió alguien de mi empresa, la pedimos nosotros; si no, nos la piden. */
  const { nosPiden, pedimos } = useMemo(() => {
    const mios = new Set([...companeros, currentUserId]);
    const nosPiden: TaskConResponsable[] = [];
    const pedimos: TaskConResponsable[] = [];
    for (const t of tareas) {
      (mios.has(t.created_by ?? "") ? pedimos : nosPiden).push(t);
    }
    return { nosPiden, pedimos };
  }, [tareas, companeros, currentUserId]);

  const lista = bandeja === "nos_piden" ? nosPiden : pedimos;

  const filtradas = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    const abiertas = lista.filter((t) =>
      verCerradas ? true : !ESTADOS_CERRADOS.includes(t.estado as (typeof ESTADOS_CERRADOS)[number]),
    );
    const buscadas = q
      ? abiertas.filter(
          (t) =>
            t.titulo.toLowerCase().includes(q) ||
            (t.descripcion ?? "").toLowerCase().includes(q),
        )
      : abiertas;

    /* Orden: primero lo vencido, luego lo urgente, luego por fecha límite más
       próxima. Es el orden en el que la gente quiere leer una bandeja. */
    return [...buscadas].sort((a, b) => {
      const va = esVencida(a.fecha_limite, a.estado) ? 0 : 1;
      const vb = esVencida(b.fecha_limite, b.estado) ? 0 : 1;
      if (va !== vb) return va - vb;
      const ua = a.prioridad === "urgente" ? 0 : 1;
      const ub = b.prioridad === "urgente" ? 0 : 1;
      if (ua !== ub) return ua - ub;
      if (a.fecha_limite && b.fecha_limite) return a.fecha_limite.localeCompare(b.fecha_limite);
      if (a.fecha_limite) return -1;
      if (b.fecha_limite) return 1;
      return b.created_at.localeCompare(a.created_at);
    });
  }, [lista, busqueda, verCerradas]);

  const pendientes = (l: TaskConResponsable[]) =>
    l.filter((t) => !ESTADOS_CERRADOS.includes(t.estado as (typeof ESTADOS_CERRADOS)[number])).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Cabecera: de quién es este espacio. Con el color de la empresa, que ya
          vive en `agencia_empresas` y es lo que la distingue en todo el CRM. */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="size-9 shrink-0 rounded-xl"
            style={{ backgroundColor: empresa?.color ?? "#e84393" }}
            aria-hidden="true"
          />
          <div className="leading-tight">
            <h1 className="text-[19px] font-bold">{empresa?.nombre ?? "Tu espacio"}</h1>
            <p className="text-[13px] text-muted-foreground">
              Lo que nos pedimos con Fresafit, en un solo lugar.
            </p>
          </div>
        </div>
        {puedeCrear && (
          <Button onClick={() => setAbriendo(true)} className="gap-2">
            <Plus className="size-4" strokeWidth={2.2} />
            Pedir algo
          </Button>
        )}
      </header>

      <BarraHerramientas>
        <div className="flex flex-wrap items-center gap-2.5">
          <ControlSegmentado
            opciones={[
              ["nos_piden", `Nos piden (${pendientes(nosPiden)})`],
              ["pedimos", `Pedimos (${pendientes(pedimos)})`],
            ] as const}
            valor={bandeja}
            onCambio={(v) => setBandeja(v as Bandeja)}
          />
          <CampoBusqueda
            valor={busqueda}
            onCambio={setBusqueda}
            placeholder="Buscar…"
            className="min-w-[180px] flex-1"
          />
          <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <input
              type="checkbox"
              checked={verCerradas}
              onChange={(e) => setVerCerradas(e.target.checked)}
              className="size-4 accent-primary"
            />
            Ver cerradas
          </label>
        </div>
      </BarraHerramientas>

      {filtradas.length === 0 ? (
        <p className="rounded-xl border border-dashed py-10 text-center text-[14px] text-muted-foreground">
          {busqueda
            ? "Nada que coincida con esa búsqueda."
            : bandeja === "nos_piden"
              ? "No hay nada pendiente de tu lado. "
              : "Todavía no han pedido nada. "}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {filtradas.map((t) => (
            <li key={t.id}>
              <TarjetaPedido
                tarea={t}
                comentarios={comentariosPorTarea[t.id] ?? 0}
                onAbrir={() => setDetalle(t)}
              />
            </li>
          ))}
        </ul>
      )}

      {abriendo && <DialogoPedido onCerrar={() => setAbriendo(false)} />}
      {detalle && (
        <DetallePedido
          tarea={detalle}
          currentUserId={currentUserId}
          onCerrar={() => setDetalle(null)}
        />
      )}
    </div>
  );
}
