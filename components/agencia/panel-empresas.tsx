"use client";

import { useMemo, useState } from "react";
import { Building2, Handshake, Plus, Users, Wallet } from "lucide-react";
import { formatearMXN } from "@/lib/moneda";
import {
  obtenerBaseCalculo,
  obtenerPlataformaAgencia,
  calcularCorte,
} from "@/lib/agencia";
import { Pastilla } from "@/components/compartido/pastilla";
import { StatCard } from "@/components/compartido/stat-card";
import { Button } from "@/components/ui/button";
import { EmpresaDialog } from "@/components/agencia/empresa-dialog";
import { ContratoDialog } from "@/components/agencia/contrato-dialog";
import { EquipoDialog } from "@/components/agencia/equipo-dialog";
import { cn, iniciales } from "@/lib/utils";
import type {
  AgenciaAsignacionConPersona,
  AgenciaContrato,
  AgenciaEmpresa,
  AgenciaIngreso,
  Profile,
} from "@/lib/types";

type IngresoResumen = Pick<
  AgenciaIngreso,
  "empresa_id" | "total" | "fondo_delegado" | "estado" | "periodo_hasta" | "created_at"
>;

/* Lo que la agencia gana de verdad: el fondo delegado es dinero del cliente que
   solo pasa de largo camino a la gente que paga, así que se descuenta. */
function honorariosDe(i: IngresoResumen): number {
  return Math.max(0, i.total - i.fondo_delegado);
}

export function PanelEmpresas({
  empresas,
  contratos,
  asignaciones,
  equipo,
  ingresos,
}: {
  empresas: AgenciaEmpresa[];
  contratos: AgenciaContrato[];
  asignaciones: AgenciaAsignacionConPersona[];
  equipo: Profile[];
  ingresos: IngresoResumen[];
}) {
  const [empresaDialog, setEmpresaDialog] = useState<AgenciaEmpresa | "nueva" | null>(null);
  const [contratoDialog, setContratoDialog] = useState<
    { empresa: AgenciaEmpresa; contrato: AgenciaContrato | null } | null
  >(null);
  const [equipoDialog, setEquipoDialog] = useState<AgenciaEmpresa | null>(null);

  const porEmpresa = useMemo(() => {
    const contratoPorEmpresa = new Map<string, AgenciaContrato[]>();
    for (const c of contratos) {
      const l = contratoPorEmpresa.get(c.empresa_id) ?? [];
      l.push(c);
      contratoPorEmpresa.set(c.empresa_id, l);
    }
    const equipoPorEmpresa = new Map<string, AgenciaAsignacionConPersona[]>();
    for (const a of asignaciones) {
      const l = equipoPorEmpresa.get(a.empresa_id) ?? [];
      l.push(a);
      equipoPorEmpresa.set(a.empresa_id, l);
    }
    const cobradoPorEmpresa = new Map<string, number>();
    for (const i of ingresos) {
      if (!i.empresa_id || i.estado !== "pagado") continue;
      cobradoPorEmpresa.set(
        i.empresa_id,
        (cobradoPorEmpresa.get(i.empresa_id) ?? 0) + honorariosDe(i),
      );
    }
    return empresas.map((e) => ({
      empresa: e,
      contratos: contratoPorEmpresa.get(e.id) ?? [],
      equipo: equipoPorEmpresa.get(e.id) ?? [],
      cobrado: cobradoPorEmpresa.get(e.id) ?? 0,
    }));
  }, [empresas, contratos, asignaciones, ingresos]);

  /* Lo comprometido al mes: la parte fija de los contratos activos. Es el piso
     de la agencia, lo que entra aunque el cliente no venda nada. */
  const fijoMensual = contratos
    .filter((c) => c.activo)
    .reduce((a, c) => a + Number(c.monto_fijo || 0), 0);
  const activas = empresas.filter((e) => e.activa).length;
  const cobradoTotal = ingresos
    .filter((i) => i.estado === "pagado")
    .reduce((a, i) => a + honorariosDe(i), 0);
  const porCobrar = ingresos
    .filter((i) => i.estado === "cobrado")
    .reduce((a, i) => a + honorariosDe(i), 0);

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">Empresas</h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            Los negocios que atendemos, con qué se les cobra y quién los lleva.
          </p>
        </div>
        <Button onClick={() => setEmpresaDialog("nueva")} className="w-full md:w-auto">
          <Plus className="size-4" strokeWidth={2.2} />
          Nueva empresa
        </Button>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard etiqueta="Empresas activas" valor={String(activas)} icono={Building2} />
        <StatCard
          etiqueta="Fijo al mes"
          valor={formatearMXN(fijoMensual)}
          nota="lo que entra sin vender"
          icono={Handshake}
        />
        <StatCard
          etiqueta="Por cobrar"
          valor={formatearMXN(porCobrar)}
          nota="facturado sin pagar"
          icono={Wallet}
          valorClassName={porCobrar > 0 ? "text-amber-600" : undefined}
        />
        <StatCard etiqueta="Cobrado" valor={formatearMXN(cobradoTotal)} nota="honorarios pagados" icono={Wallet} />
      </div>

      {porEmpresa.length === 0 ? (
        <p className="rounded-2xl border bg-card px-6 py-10 text-center text-sm italic text-muted-foreground shadow-sm">
          Todavía no hay empresas. Agrega la primera para empezar a llevarle sus cobros.
        </p>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {porEmpresa.map(({ empresa, contratos: cs, equipo: eq, cobrado }) => (
            <article
              key={empresa.id}
              className={cn(
                "flex flex-col gap-3.5 rounded-2xl border bg-card p-5 shadow-sm",
                !empresa.activa && "opacity-60",
              )}
            >
              <header className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-xl text-[13px] font-bold text-white"
                    style={{ backgroundColor: empresa.color }}
                  >
                    {iniciales(empresa.nombre)}
                  </span>
                  <div className="min-w-0">
                    <h2 className="truncate text-[16.5px] font-bold">{empresa.nombre}</h2>
                    <p className="truncate text-[12.5px] text-muted-foreground">
                      {empresa.giro || "Sin giro definido"}
                      {!empresa.activa && " · inactiva"}
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={() => setEmpresaDialog(empresa)}>
                  Editar
                </Button>
              </header>

              {/* Contratos: la regla de cobro con palabras, no solo números. */}
              <div className="flex flex-col gap-2">
                {cs.length === 0 ? (
                  <p className="text-[13px] italic text-muted-foreground">
                    Sin contrato: no se le puede calcular un corte todavía.
                  </p>
                ) : (
                  cs.map((c) => {
                    const base = obtenerBaseCalculo(c.base_calculo);
                    const plataforma = obtenerPlataformaAgencia(c.plataforma);
                    /* Ejemplo con 100 000 de venta: hace tangible la fórmula sin
                       tener que calcularla de cabeza. */
                    const ejemplo = calcularCorte(
                      { monto_fijo: c.monto_fijo, porcentaje: c.porcentaje, fondo_delegado: 0 },
                      100000,
                    );
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setContratoDialog({ empresa, contrato: c })}
                        className="rounded-xl border bg-muted/30 px-3.5 py-2.5 text-left transition-colors hover:bg-accent/40"
                      >
                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                          <span className="text-[15px] font-semibold tabular-nums">
                            {formatearMXN(c.monto_fijo)}
                          </span>
                          <span className="text-[13px] text-muted-foreground">al mes</span>
                          {c.porcentaje > 0 && (
                            <>
                              <span className="text-[13px] text-muted-foreground">+</span>
                              <span className="text-[15px] font-semibold tabular-nums">
                                {c.porcentaje}%
                              </span>
                              <span className="text-[13px] text-muted-foreground">
                                de {base?.enFrase ?? "las ventas"}
                              </span>
                            </>
                          )}
                          {!c.activo && <Pastilla nombre="Inactivo" color="#d63031" />}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[12px] text-muted-foreground">
                          {plataforma && <span>{plataforma.nombre}</span>}
                          <span>·</span>
                          <span>corte el día {c.dia_corte}</span>
                          {c.porcentaje > 0 && (
                            <>
                              <span>·</span>
                              <span>
                                con 100 000 de venta cobra {formatearMXN(ejemplo.honorarios)}
                              </span>
                            </>
                          )}
                        </div>
                        {c.fondo_delegado > 0 && (
                          <div className="mt-1.5 text-[12px] text-muted-foreground">
                            + {formatearMXN(c.fondo_delegado)} delegados para pagar personal
                            <span className="italic"> (no son ingreso)</span>
                          </div>
                        )}
                      </button>
                    );
                  })
                )}
                <button
                  type="button"
                  onClick={() => setContratoDialog({ empresa, contrato: null })}
                  className="w-fit text-[12.5px] font-semibold text-primary hover:underline"
                >
                  + Agregar contrato
                </button>
              </div>

              {/* Equipo asignado */}
              <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  <Users className="size-3.5" strokeWidth={1.9} />
                  Equipo
                </span>
                {eq.length === 0 ? (
                  <span className="text-[13px] italic text-muted-foreground">Sin asignar</span>
                ) : (
                  eq.map((a) => (
                    <span
                      key={a.id}
                      title={`${a.persona?.nombre ?? "?"}${a.papel ? ` — ${a.papel}` : ""}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-muted py-0.5 pl-0.5 pr-2.5 text-[12px] font-medium"
                    >
                      <span
                        className="flex size-5 items-center justify-center rounded-full text-[9px] font-bold text-white"
                        style={{ backgroundColor: a.persona?.color ?? "#636e72" }}
                      >
                        {iniciales(a.persona?.nombre ?? "?")}
                      </span>
                      {a.persona?.nombre?.split(" ")[0] ?? "?"}
                    </span>
                  ))
                )}
                <button
                  type="button"
                  onClick={() => setEquipoDialog(empresa)}
                  className="ml-auto text-[12.5px] font-semibold text-primary hover:underline"
                >
                  Cambiar
                </button>
              </div>

              {cobrado > 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  Lleva {formatearMXN(cobrado)} pagados en honorarios.
                </p>
              )}
            </article>
          ))}
        </div>
      )}

      {empresaDialog && (
        <EmpresaDialog
          empresa={empresaDialog === "nueva" ? null : empresaDialog}
          onClose={() => setEmpresaDialog(null)}
        />
      )}
      {contratoDialog && (
        <ContratoDialog
          empresa={contratoDialog.empresa}
          contrato={contratoDialog.contrato}
          onClose={() => setContratoDialog(null)}
        />
      )}
      {equipoDialog && (
        <EquipoDialog
          empresa={equipoDialog}
          equipo={equipo}
          asignadas={asignaciones.filter((a) => a.empresa_id === equipoDialog.id)}
          onClose={() => setEquipoDialog(null)}
        />
      )}
    </div>
  );
}
