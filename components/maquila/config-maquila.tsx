"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  agregarCostoMaquila,
  agregarFestivoMaquila,
  guardarConfigMaquila,
  quitarFestivoMaquila,
} from "@/app/(app)/maquila/actions";
import {
  ACABADOS_MAQUILA,
  MODELOS_MAQUILA,
  obtenerAcabadoMaquila,
  obtenerModeloMaquila,
} from "@/lib/catalogos";
import { formatearFechaLarga, hoyISO } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type {
  AcabadoMaquilaId,
  ConfigMaquila,
  CostoMaquila,
  FestivoMaquila,
  ModeloMaquilaId,
} from "@/lib/types";

/* El volante del módulo: la hora límite de corte y el sábado (configurables
   por diseño, se van a ajustar con la operación real), los días que no cuentan
   (festivos de ley + cierres del taller) y las tarifas de Eduardo. Los pedidos
   ya clasificados NO se recalculan al cambiar nada de esto: la promesa dada no
   se mueve sola. */
export function ConfigMaquilaPanel({
  config,
  festivos,
  costos,
  esDireccion,
  veTarifas,
}: {
  config: ConfigMaquila;
  festivos: FestivoMaquila[];
  costos: CostoMaquila[];
  esDireccion: boolean;
  /* Las tarifas son confidenciales (dirección y administración). Sin esto, el
     bloque no se pinta: `costos` llega vacío por RLS y una rejilla de «sin
     tarifa» haría creer que no hay precios cargados. */
  veTarifas: boolean;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [horaLimite, setHoraLimite] = useState(config.hora_limite.slice(0, 5));
  const [sabado, setSabado] = useState(config.sabado_habil);

  const [fDesde, setFDesde] = useState("");
  const [fHasta, setFHasta] = useState("");
  const [fTipo, setFTipo] = useState<"festivo" | "cierre">("cierre");
  const [fMotivo, setFMotivo] = useState("");

  const [cModelo, setCModelo] = useState<ModeloMaquilaId>("powerlift");
  const [cAcabado, setCAcabado] = useState<AcabadoMaquilaId>("prensado");
  const [cCosto, setCCosto] = useState("");
  const [cDesde, setCDesde] = useState(hoyISO());

  const hoy = hoyISO();
  const proximos = festivos.filter((f) => f.fecha >= hoy);

  /* La tarifa vigente por combinación, para leer la tabla de un vistazo. */
  const vigentes = new Map<string, CostoMaquila>();
  for (const c of costos) {
    if (c.vigente_desde > hoy) continue;
    const k = `${c.modelo}:${c.acabado}`;
    const previa = vigentes.get(k);
    if (!previa || c.vigente_desde > previa.vigente_desde) vigentes.set(k, c);
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {/* --- Corte y días hábiles --- */}
      <div className="grid content-start gap-3 rounded-2xl border bg-card p-4">
        <div className="text-[13px] font-semibold">Hora límite y días hábiles</div>
        <p className="-mt-1 text-[12.5px] text-muted-foreground">
          Un pago después de la hora límite cuenta desde el siguiente día hábil. Aplica solo a
          pedidos nuevos.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cfg-hora">Hora límite</Label>
            <Input
              id="cfg-hora"
              type="time"
              value={horaLimite}
              onChange={(e) => setHoraLimite(e.target.value)}
              className="w-[130px]"
            />
          </div>
          <label className="flex items-center gap-2 pb-2 text-[13.5px] font-medium">
            <input
              type="checkbox"
              checked={sabado}
              onChange={(e) => setSabado(e.target.checked)}
              className="size-4 accent-primary"
            />
            El sábado cuenta como hábil
          </label>
          <Button
            disabled={pending}
            onClick={() =>
              ejecutar(() => guardarConfigMaquila({ hora_limite: horaLimite, sabado_habil: sabado }), {
                ok: "Configuración guardada.",
              })
            }
          >
            Guardar
          </Button>
        </div>
      </div>

      {/* --- Festivos y cierres --- */}
      <div className="grid content-start gap-3 rounded-2xl border bg-card p-4">
        <div className="text-[13px] font-semibold">Días que NO cuentan</div>
        <p className="-mt-1 text-[12.5px] text-muted-foreground">
          Festivos de ley (ya sembrados) y cierres del taller de Eduardo. Un rango inserta un día
          por fila.
        </p>
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label htmlFor="cfg-desde">Desde</Label>
            <Input id="cfg-desde" type="date" value={fDesde} onChange={(e) => setFDesde(e.target.value)} className="w-[150px]" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="cfg-hasta">Hasta (opcional)</Label>
            <Input id="cfg-hasta" type="date" value={fHasta} onChange={(e) => setFHasta(e.target.value)} className="w-[150px]" />
          </div>
          <div className="grid gap-1.5">
            <Label>Tipo</Label>
            <Select value={fTipo} onValueChange={(v) => v && setFTipo(v as "festivo" | "cierre")}>
              <SelectTrigger className="w-[130px]">
                <SelectValue>{(v: string) => (v === "cierre" ? "Cierre del taller" : "Festivo")}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cierre">Cierre del taller</SelectItem>
                <SelectItem value="festivo">Festivo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid min-w-[140px] flex-1 gap-1.5">
            <Label htmlFor="cfg-motivo">Motivo</Label>
            <Input id="cfg-motivo" value={fMotivo} onChange={(e) => setFMotivo(e.target.value)} placeholder="Vacaciones…" />
          </div>
          <Button
            variant="outline"
            disabled={pending || !fDesde}
            onClick={() =>
              ejecutar(
                () =>
                  agregarFestivoMaquila({ desde: fDesde, hasta: fHasta || null, tipo: fTipo, motivo: fMotivo }),
                {
                  ok: (r) => `${r.datos.dias} día(s) marcados como no hábiles.`,
                  alExito: () => {
                    setFDesde("");
                    setFHasta("");
                    setFMotivo("");
                  },
                },
              )
            }
          >
            Agregar
          </Button>
        </div>
        <ul className="grid max-h-52 gap-1 overflow-y-auto text-[13px]">
          {proximos.length === 0 && (
            <li className="text-muted-foreground">Nada próximo en el calendario.</li>
          )}
          {proximos.map((f) => (
            <li key={f.fecha} className="flex items-center gap-2">
              <span className="w-[110px] shrink-0 tabular-nums">{formatearFechaLarga(f.fecha)}</span>
              <Pastilla
                nombre={f.tipo === "cierre" ? "Cierre" : "Festivo"}
                color={f.tipo === "cierre" ? "#e17055" : "#6c5ce7"}
              />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{f.motivo ?? ""}</span>
              <button
                type="button"
                className="text-[12px] text-muted-foreground hover:text-red-600"
                onClick={() =>
                  ejecutar(() => quitarFestivoMaquila(f.fecha), { ok: "Día quitado del calendario." })
                }
              >
                Quitar
              </button>
            </li>
          ))}
        </ul>
      </div>

      {/* --- Tarifas de Eduardo (solo dirección y administración) --- */}
      {veTarifas && (
      <div className="grid content-start gap-3 rounded-2xl border bg-card p-4 lg:col-span-2">
        <div className="text-[13px] font-semibold">Tarifas de maquila (sin IVA)</div>
        <p className="-mt-1 text-[12.5px] text-muted-foreground">
          Lo que se le paga a Eduardo por pieza. Solo se agregan vigencias nuevas — lo ya producido
          se liquida al costo que regía cuando se pagó.{" "}
          {!esDireccion && "Cambiarlas es de dirección."}
        </p>
        <div className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
          {MODELOS_MAQUILA.flatMap((m) =>
            ACABADOS_MAQUILA.map((a) => {
              const c = vigentes.get(`${m.id}:${a.id}`);
              return (
                <div key={`${m.id}:${a.id}`} className="rounded-xl border px-3 py-2">
                  <div className="text-[12px] text-muted-foreground">
                    {m.nombre} · {a.nombre}
                  </div>
                  <div className="text-[17px] font-bold tabular-nums">
                    {c ? formatearMXN(c.costo) : "sin tarifa"}
                  </div>
                </div>
              );
            }),
          )}
        </div>
        {esDireccion && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="grid gap-1.5">
              <Label>Modelo</Label>
              <Select value={cModelo} onValueChange={(v) => v && setCModelo(v as ModeloMaquilaId)}>
                <SelectTrigger className="w-[130px]">
                  <SelectValue>{(v: string) => obtenerModeloMaquila(v)?.nombre ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {MODELOS_MAQUILA.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Acabado</Label>
              <Select value={cAcabado} onValueChange={(v) => v && setCAcabado(v as AcabadoMaquilaId)}>
                <SelectTrigger className="w-[160px]">
                  <SelectValue>{(v: string) => obtenerAcabadoMaquila(v)?.nombre ?? v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ACABADOS_MAQUILA.map((a) => (
                    <SelectItem key={a.id} value={a.id}>
                      {a.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cfg-costo">Costo (sin IVA)</Label>
              <Input
                id="cfg-costo"
                type="number"
                min={0}
                step="0.01"
                value={cCosto}
                onChange={(e) => setCCosto(e.target.value)}
                className="w-[120px]"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cfg-vigente">Vigente desde</Label>
              <Input
                id="cfg-vigente"
                type="date"
                value={cDesde}
                onChange={(e) => setCDesde(e.target.value)}
                className="w-[150px]"
              />
            </div>
            <Button
              variant="outline"
              disabled={pending || !cCosto}
              onClick={() =>
                ejecutar(
                  () =>
                    agregarCostoMaquila({
                      modelo: cModelo,
                      acabado: cAcabado,
                      costo: Number(cCosto),
                      vigente_desde: cDesde,
                    }),
                  { ok: "Tarifa agregada.", alExito: () => setCCosto("") },
                )
              }
            >
              Agregar tarifa
            </Button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
