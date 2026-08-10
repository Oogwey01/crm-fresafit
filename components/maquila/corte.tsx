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
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { AnticiposMaquila } from "@/components/maquila/anticipos";
import {
  agregarAjusteCorte,
  calcularCorteMaquila,
  cancelarCorteMaquila,
  cerrarCorteMaquila,
  marcarCortePagado,
} from "@/app/(app)/maquila/actions";
import { obtenerAcabadoMaquila, obtenerEstadoCorteMaquila } from "@/lib/catalogos";
import { nombreQuincena, quincenaCerrada, quincenasRecientes } from "@/lib/maquila/quincenas";
import { formatearFecha, formatearFechaHora } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { AnticipoMaquila, CorteMaquilaConDetalle, RenglonCorteMaquila } from "@/lib/types";

/* «Cuánto le debo a Eduardo esta quincena»: se calcula lo que salió, se le
   suma el IVA aparte, se le restan los anticipos que tenga a favor, se cierra
   y se paga. Solo lo ve administración — la pestaña ni se pinta sin permiso.

   La cadena es borrador → cerrado → pagado, y cada paso hace una cosa:
   calcular junta los renglones (y se puede repetir), cerrar congela y aplica
   anticipos, pagar solo sella el hecho. */
export function CorteMaquilaPanel({
  cortes,
  anticipos,
  hoy,
  esDireccion,
}: {
  cortes: CorteMaquilaConDetalle[];
  anticipos: AnticipoMaquila[];
  hoy: string;
  esDireccion: boolean;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const quincenas = quincenasRecientes(hoy, 6);
  const [quincena, setQuincena] = useState(`${quincenas[0].desde}|${quincenas[0].hasta}`);
  const [ajuste, setAjuste] = useState({ concepto: "", importe: "" });
  const [pago, setPago] = useState({ metodo: "", folio: "", uuid: "" });

  const [desde, hasta] = quincena.split("|");
  const activo = cortes.find(
    (c) => c.periodo_desde === desde && c.periodo_hasta === hasta && c.estado !== "cancelado",
  );
  const enCurso = !quincenaCerrada({ desde, hasta }, hoy);
  const aFavor = anticipos.reduce((s, a) => s + (a.saldo ?? 0), 0);

  const columnas: Columna<RenglonCorteMaquila>[] = [
    {
      clave: "concepto",
      label: "Pieza",
      esTitulo: true,
      celda: (r) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{r.concepto ?? "—"}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {r.pedido_id
              ? [obtenerAcabadoMaquila(r.acabado ?? "")?.nombre, r.modelo].filter(Boolean).join(" · ")
              : "ajuste manual"}
          </div>
        </div>
      ),
    },
    {
      clave: "salio",
      label: "Salió",
      celda: (r) => (
        <span className="text-muted-foreground">
          {r.enviado_en ? formatearFecha(r.enviado_en.slice(0, 10)) : "—"}
        </span>
      ),
    },
    {
      clave: "unitario",
      label: "Unitario",
      celda: (r) => (
        <span className="tabular-nums text-muted-foreground">
          {r.pedido_id ? `${formatearMXN(r.costo_unitario)} × ${r.cantidad}` : "—"}
        </span>
      ),
    },
    {
      clave: "importe",
      label: "Importe",
      celda: (r) => (
        <span className={`font-semibold tabular-nums ${r.importe < 0 ? "text-red-600" : ""}`}>
          {formatearMXN(r.importe)}
        </span>
      ),
    },
  ];

  return (
    <div className="grid gap-5">
      {/* --- El corte de la quincena elegida --- */}
      <div className="grid gap-3 rounded-2xl border bg-card p-4">
        <div className="flex flex-wrap items-end gap-2">
          <div className="grid gap-1.5">
            <Label>Quincena</Label>
            <Select value={quincena} onValueChange={(v) => v && setQuincena(v)}>
              <SelectTrigger className="w-[210px]">
                <SelectValue>
                  {(v: string) => {
                    const [d, h] = v.split("|");
                    return nombreQuincena({ desde: d, hasta: h });
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {quincenas.map((q) => (
                  <SelectItem key={q.desde} value={`${q.desde}|${q.hasta}`}>
                    {nombreQuincena(q)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant={activo ? "outline" : "default"}
            disabled={pending}
            onClick={() =>
              ejecutar(() => calcularCorteMaquila(desde, hasta), {
                ok: "Corte calculado con lo que salió en la quincena.",
              })
            }
          >
            {activo ? "Recalcular" : "Calcular corte"}
          </Button>
          {activo?.estado === "borrador" && (
            <Button
              disabled={pending}
              onClick={() =>
                ejecutar(() => cerrarCorteMaquila(activo.id), {
                  confirmar: enCurso
                    ? "Esta quincena todavía no termina: lo que salga los días que faltan quedará fuera del corte. ¿Cerrarlo de todos modos?"
                    : undefined,
                  ok: "Corte cerrado. Ya se puede pagar.",
                })
              }
            >
              Cerrar corte
            </Button>
          )}
          {activo && esDireccion && activo.estado !== "pagado" && (
            <Button
              variant="ghost"
              disabled={pending}
              onClick={() =>
                ejecutar(() => cancelarCorteMaquila(activo.id), {
                  confirmar:
                    "Se anulan los renglones y los anticipos vuelven a estar disponibles. ¿Cancelar el corte?",
                  ok: "Corte cancelado.",
                })
              }
            >
              Cancelar corte
            </Button>
          )}
          <div className="flex-1" />
          {activo && (
            <Pastilla
              nombre={obtenerEstadoCorteMaquila(activo.estado)?.nombre ?? activo.estado}
              color={obtenerEstadoCorteMaquila(activo.estado)?.color ?? "#94a3b8"}
            />
          )}
        </div>

        {enCurso && (
          <p className="text-[12.5px] text-muted-foreground">
            La quincena sigue en curso: puedes calcularla para ver cómo va, pero lo que salga los
            días que faltan solo entrará si la vuelves a calcular antes de cerrar.
          </p>
        )}

        {activo ? (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                ["Piezas", String(activo.piezas)],
                ["Subtotal", formatearMXN(activo.subtotal)],
                [`IVA ${(activo.iva_tasa * 100).toFixed(0)}%`, formatearMXN(activo.iva)],
                ["Anticipos", `− ${formatearMXN(activo.anticipos_aplicados)}`],
                ["A pagar", formatearMXN(activo.total)],
              ].map(([k, v], i) => (
                <div key={k} className="rounded-xl border px-3 py-2">
                  <div className="text-[11.5px] text-muted-foreground">{k}</div>
                  <div
                    className={`text-[17px] font-bold tabular-nums ${i === 4 ? "text-primary" : ""}`}
                  >
                    {v}
                  </div>
                </div>
              ))}
            </div>

            <TablaSimple
              cols="grid-cols-[minmax(200px,1.4fr)_120px_150px_120px]"
              columnas={columnas}
              datos={activo.renglones}
              filaKey={(r) => r.id}
              minW="min-w-[720px]"
              vacio="No salió ninguna pieza en esta quincena."
            />

            {activo.estado === "borrador" && (
              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="ajuste-concepto">Ajuste manual</Label>
                  <Input
                    id="ajuste-concepto"
                    value={ajuste.concepto}
                    onChange={(e) => setAjuste({ ...ajuste, concepto: e.target.value })}
                    placeholder="Cinturón rehecho por defecto"
                    className="w-[260px]"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ajuste-importe">Importe (negativo = a favor nuestro)</Label>
                  <Input
                    id="ajuste-importe"
                    type="number"
                    step="0.01"
                    value={ajuste.importe}
                    onChange={(e) => setAjuste({ ...ajuste, importe: e.target.value })}
                    className="w-[150px]"
                  />
                </div>
                <Button
                  variant="outline"
                  disabled={pending || !ajuste.concepto || !ajuste.importe}
                  onClick={() =>
                    ejecutar(
                      () => agregarAjusteCorte(activo.id, ajuste.concepto, Number(ajuste.importe)),
                      { ok: "Ajuste agregado.", alExito: () => setAjuste({ concepto: "", importe: "" }) },
                    )
                  }
                >
                  Agregar ajuste
                </Button>
              </div>
            )}

            {activo.estado === "cerrado" && (
              <div className="flex flex-wrap items-end gap-2 border-t pt-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="pago-metodo">Cómo se pagó</Label>
                  <Input
                    id="pago-metodo"
                    value={pago.metodo}
                    onChange={(e) => setPago({ ...pago, metodo: e.target.value })}
                    placeholder="Transferencia BBVA"
                    className="w-[190px]"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pago-folio">Folio de factura</Label>
                  <Input
                    id="pago-folio"
                    value={pago.folio}
                    onChange={(e) => setPago({ ...pago, folio: e.target.value })}
                    className="w-[150px]"
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="pago-uuid">UUID fiscal</Label>
                  <Input
                    id="pago-uuid"
                    value={pago.uuid}
                    onChange={(e) => setPago({ ...pago, uuid: e.target.value })}
                    className="w-[240px]"
                  />
                </div>
                <Button
                  disabled={pending}
                  onClick={() =>
                    ejecutar(
                      () =>
                        marcarCortePagado(activo.id, {
                          pagado_en: new Date().toISOString(),
                          metodo_pago: pago.metodo,
                          factura_folio: pago.folio,
                          factura_uuid: pago.uuid,
                        }),
                      { ok: "Corte marcado como pagado.", alExito: () => setPago({ metodo: "", folio: "", uuid: "" }) },
                    )
                  }
                >
                  Marcar pagado
                </Button>
              </div>
            )}

            {activo.estado === "pagado" && (
              <p className="border-t pt-3 text-[13px] text-muted-foreground">
                Pagado el {activo.pagado_en ? formatearFechaHora(activo.pagado_en) : "—"}
                {activo.metodo_pago ? ` por ${activo.metodo_pago}` : ""}
                {activo.factura_folio ? `, factura ${activo.factura_folio}` : ""}.
              </p>
            )}
          </>
        ) : (
          <p className="text-[13.5px] text-muted-foreground">
            Esta quincena no se ha cortado. Calcúlala para ver qué salió y cuánto se le debe.
          </p>
        )}
      </div>

      <AnticiposMaquila anticipos={anticipos} aFavor={aFavor} />
    </div>
  );
}
