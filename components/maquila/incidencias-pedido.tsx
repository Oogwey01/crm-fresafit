"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Pastilla } from "@/components/compartido/pastilla";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  abrirIncidenciaMaquila,
  listarIncidenciasMaquila,
  resolverIncidenciaMaquila,
} from "@/app/(app)/maquila/actions";
import {
  TIPOS_INCIDENCIA_MAQUILA,
  obtenerDestinoIncidenciaMaquila,
  obtenerTipoIncidenciaMaquila,
} from "@/lib/catalogos";
import { formatearFechaHora } from "@/lib/fecha";
import type { IncidenciaMaquila, PedidoMaquila, TipoIncidenciaMaquilaId } from "@/lib/types";

/* Los pendientes del pedido. Los dos lados escriben: el equipo reclama
   calidad, Eduardo avisa que le falta material o que su imprenta lo dejó
   colgado. Resolver es del equipo (la RLS también lo exige).

   Se cargan al abrir el diálogo, como el historial: son pocas por pedido y no
   vale la pena traerlas en el listado. */
export function IncidenciasPedido({
  pedido,
  esEquipo,
}: {
  pedido: PedidoMaquila;
  esEquipo: boolean;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [incidencias, setIncidencias] = useState<IncidenciaMaquila[] | null>(null);
  const [abriendo, setAbriendo] = useState(false);
  const [tipo, setTipo] = useState<TipoIncidenciaMaquilaId>(esEquipo ? "calidad" : "faltante");
  const [texto, setTexto] = useState("");

  async function recargar() {
    const r = await listarIncidenciasMaquila(pedido.id);
    if (!("error" in r)) setIncidencias(r.datos.incidencias);
  }

  useEffect(() => {
    let vivo = true;
    void listarIncidenciasMaquila(pedido.id).then((r) => {
      if (vivo && !("error" in r)) setIncidencias(r.datos.incidencias);
    });
    return () => {
      vivo = false;
    };
  }, [pedido.id]);

  const abiertas = incidencias?.filter((i) => i.abierta) ?? [];

  return (
    <div className="grid gap-2 rounded-xl border p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
          Incidencias
          {abiertas.length > 0 && (
            <span className="ml-2 text-red-600">{abiertas.length} abierta(s)</span>
          )}
        </div>
        {!abriendo && (
          <Button size="sm" variant="ghost" onClick={() => setAbriendo(true)}>
            Reportar algo
          </Button>
        )}
      </div>

      {abriendo && (
        <div className="grid gap-2 border-b pb-3">
          <div className="flex flex-wrap gap-2">
            <Select value={tipo} onValueChange={(v) => v && setTipo(v as TipoIncidenciaMaquilaId)}>
              <SelectTrigger className="h-8 w-[190px]">
                <SelectValue>
                  {(v: string) => obtenerTipoIncidenciaMaquila(v)?.nombre ?? "Tipo"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TIPOS_INCIDENCIA_MAQUILA.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder={
                esEquipo ? "El bordado quedó chueco" : "No me llegaron las palancas negras"
              }
              className="h-8 flex-1 min-w-[200px]"
            />
            <Button
              size="sm"
              disabled={pending || !texto.trim()}
              onClick={() =>
                ejecutar(
                  () =>
                    abrirIncidenciaMaquila(pedido.id, {
                      tipo,
                      /* Quien reporta se lo dirige al otro lado: es lo que
                         hace que el pendiente tenga dueño. */
                      dirigida_a: esEquipo ? "maquilero" : "equipo",
                      texto,
                    }),
                  {
                    ok: "Incidencia registrada.",
                    alExito: async () => {
                      setTexto("");
                      setAbriendo(false);
                      await recargar();
                    },
                  },
                )
              }
            >
              Reportar
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setAbriendo(false)}>
              Cancelar
            </Button>
          </div>
        </div>
      )}

      {incidencias === null ? (
        <p className="text-[12.5px] text-muted-foreground">Cargando…</p>
      ) : incidencias.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">Sin incidencias. 🎉</p>
      ) : (
        <ul className="grid gap-2">
          {incidencias.map((i) => {
            const t = obtenerTipoIncidenciaMaquila(i.tipo);
            return (
              <li key={i.id} className="grid gap-1 text-[13px]">
                <div className="flex flex-wrap items-center gap-1.5">
                  {t && <Pastilla nombre={t.nombre} color={i.abierta ? t.color : "#94a3b8"} />}
                  <span className={i.abierta ? "" : "text-muted-foreground line-through"}>
                    {i.texto}
                  </span>
                </div>
                <div className="text-[11.5px] text-muted-foreground">
                  {i.autor_nombre ?? "Sistema"} · {formatearFechaHora(i.created_at)} · para{" "}
                  {obtenerDestinoIncidenciaMaquila(i.dirigida_a)?.nombre ?? i.dirigida_a}
                  {i.respuesta ? ` · ${i.respuesta}` : ""}
                </div>
                {i.abierta && esEquipo && (
                  <div>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending}
                      onClick={() =>
                        ejecutar(() => resolverIncidenciaMaquila(i.id, ""), {
                          ok: "Incidencia resuelta.",
                          alExito: recargar,
                        })
                      }
                    >
                      Marcar resuelta
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
