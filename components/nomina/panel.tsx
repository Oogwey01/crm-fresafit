"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Banknote, CalendarClock, Plus, Users } from "lucide-react";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { Pastilla } from "@/components/compartido/pastilla";
import { StatCard } from "@/components/compartido/stat-card";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { Button } from "@/components/ui/button";
import { EmpleadoDialog } from "@/components/nomina/empleado-dialog";
import { PagoDialog } from "@/components/nomina/pago-dialog";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { marcarPagoPagado } from "@/app/(app)/agencia/actions";
import {
  PERIODICIDADES_PAGO,
  nombrePeriodo,
  obtenerEsquemaPago,
  obtenerSituacionLaboral,
} from "@/lib/agencia";
import { formatearFecha } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import { cn } from "@/lib/utils";
import type {
  AgenciaEmpresa,
  NominaEmpleadoConEmpresa,
  NominaPagoConEmpleado,
  Profile,
} from "@/lib/types";

/* Una columna menos en Fresafit: allí no se muestra «se le carga a». */
const COLS_PERSONAS_AGENCIA = "grid-cols-[minmax(170px,1fr)_140px_130px_140px_130px_110px]";
const COLS_PERSONAS_FRESAFIT = "grid-cols-[minmax(190px,1fr)_150px_150px_150px_110px]";
const COLS_PAGOS = "grid-cols-[minmax(170px,1fr)_170px_130px_130px_120px]";

type Vista = "personas" | "pagos";

const VISTAS: readonly (readonly [Vista, string])[] = [
  ["personas", "Personas"],
  ["pagos", "Pagos"],
] as const;

/* Cuánto cuesta al mes cada esquema, normalizado. Sin esto, comparar un sueldo
   semanal con uno mensual obliga a hacer la cuenta de cabeza cada vez. */
const FACTOR_MENSUAL: Record<string, number> = {
  semanal: 4.33,
  quincenal: 2,
  mensual: 1,
  por_evento: 0, // impredecible: no se puede proyectar
};

export function PanelNomina({
  empleados,
  pagos,
  empresas,
  equipo,
  ambito,
}: {
  empleados: NominaEmpleadoConEmpresa[];
  pagos: NominaPagoConEmpleado[];
  empresas: AgenciaEmpresa[];
  equipo: Profile[];
  /* Los dos negocios llevan su propia nómina y no tienen por qué verse
     mezcladas: el sueldo de quien empaca cinturones y el de quien lleva las
     campañas de Nutravia salen de bolsas distintas. La misma tabla los guarda
     (`empresa_id` null = Fresafit) y el ámbito decide cuáles se muestran. */
  ambito: "fresafit" | "agencia";
}) {
  const esAgencia = ambito === "agencia";
  const { pending, ejecutar } = useAccionServidor();
  const [vista, setVista] = useState<Vista>("personas");
  const [empleadoDialog, setEmpleadoDialog] = useState<
    NominaEmpleadoConEmpresa | "nuevo" | null
  >(null);
  const [pagoDialog, setPagoDialog] = useState<NominaEmpleadoConEmpresa | "nuevo" | null>(null);

  const resumen = useMemo(() => {
    const activos = empleados.filter((e) => e.activo);
    const mensual = activos.reduce(
      (a, e) => a + Number(e.monto || 0) * (FACTOR_MENSUAL[e.periodicidad] ?? 1),
      0,
    );
    const sinFormalizar = activos.filter((e) => e.situacion === "sin_formalizar").length;
    const pendiente = pagos
      .filter((p) => p.estado === "pendiente")
      .reduce((a, p) => a + Number(p.monto || 0), 0);
    return { activos: activos.length, mensual, sinFormalizar, pendiente };
  }, [empleados, pagos]);

  function alternarPago(id: string, pagado: boolean) {
    ejecutar(() => marcarPagoPagado(id, pagado), { error: "No se pudo actualizar el pago." });
  }

  const columnasPersonas: Columna<NominaEmpleadoConEmpresa>[] = [
    {
      clave: "nombre",
      label: "Persona",
      esTitulo: true,
      celda: (e) => (
        <div className="min-w-0">
          <div className={cn("truncate font-medium", !e.activo && "text-muted-foreground")}>
            {e.nombre}
            {!e.activo && <span className="ml-1.5 text-[11px]">(inactivo)</span>}
          </div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {e.puesto || "Sin puesto"}
          </div>
        </div>
      ),
    },
    /* En Fresafit todos se cargan a Fresafit: una columna con el mismo valor en
       todas las filas es ruido. Solo aparece en la Agencia, donde sí distingue. */
    ...(esAgencia
      ? [
          {
            clave: "carga",
            label: "Se le carga a",
            celda: (e: NominaEmpleadoConEmpresa) =>
              e.empresa ? (
                <Pastilla nombre={e.empresa.nombre} color={e.empresa.color} />
              ) : (
                <span className="text-[13px] text-muted-foreground">Fresafit</span>
              ),
          },
        ]
      : []),
    {
      clave: "esquema",
      label: "Esquema",
      celda: (e) => (
        <span className="text-[13px] text-muted-foreground">
          {obtenerEsquemaPago(e.esquema)?.nombre ?? e.esquema}
        </span>
      ),
    },
    {
      clave: "monto",
      label: "Pago",
      celda: (e) => (
        <div>
          <div className="font-semibold tabular-nums">{formatearMXN(e.monto)}</div>
          <div className="text-[11.5px] text-muted-foreground">
            {PERIODICIDADES_PAGO.find((p) => p.id === e.periodicidad)?.nombre?.toLowerCase() ??
              e.periodicidad}
            {e.dia_corte ? ` · día ${e.dia_corte}` : ""}
          </div>
        </div>
      ),
    },
    {
      clave: "situacion",
      label: "Situación",
      celda: (e) => {
        const s = obtenerSituacionLaboral(e.situacion);
        return s ? <Pastilla nombre={s.nombre} color={s.color} /> : null;
      },
    },
    {
      clave: "acciones",
      label: "",
      celda: (e) => (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPagoDialog(e)}
        >
          Pagar
        </Button>
      ),
    },
  ];

  const columnasPagos: Columna<NominaPagoConEmpleado>[] = [
    {
      clave: "persona",
      label: "Persona",
      esTitulo: true,
      celda: (p) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{p.empleado?.nombre ?? "—"}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {p.empleado?.puesto || ""}
          </div>
        </div>
      ),
    },
    {
      clave: "periodo",
      label: "Periodo",
      celda: (p) => (
        <span className="text-[13px] text-muted-foreground">
          {p.periodo_desde && p.periodo_hasta
            ? nombrePeriodo(p.periodo_desde, p.periodo_hasta)
            : "—"}
        </span>
      ),
    },
    {
      clave: "monto",
      label: "Monto",
      celda: (p) => <span className="font-semibold tabular-nums">{formatearMXN(p.monto)}</span>,
    },
    {
      clave: "pagado",
      label: "Pagado",
      celda: (p) => (
        <span className="text-[13px] text-muted-foreground">
          {p.fecha_pago ? formatearFecha(p.fecha_pago) : "—"}
        </span>
      ),
    },
    {
      clave: "estado",
      label: "Estado",
      celda: (p) => (
        <button
          type="button"
          disabled={pending}
          onClick={() => alternarPago(p.id, p.estado !== "pagado")}
          title={p.estado === "pagado" ? "Marcar como pendiente" : "Marcar como pagado"}
        >
          <Pastilla
            nombre={p.estado === "pagado" ? "Pagado" : "Pendiente"}
            color={p.estado === "pagado" ? "#00b894" : "#fdcb6e"}
          />
        </button>
      ),
    },
  ];

  return (
    <div>
      <div className="mb-5 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-[26px] font-bold tracking-[-0.5px]">
            {esAgencia ? "Nómina de la Agencia" : "Nómina"}
          </h1>
          <p className="mt-1.5 text-[14.5px] text-muted-foreground">
            {esAgencia
              ? "Lo que cuesta atender a cada cliente: quién trabaja para quién y cuánto se le paga."
              : "Quién cobra qué, cada cuándo y bajo qué figura."}
          </p>
        </div>
        <div className="flex w-full flex-wrap gap-2 md:w-auto">
          <Button
            variant="outline"
            onClick={() => setPagoDialog("nuevo")}
            className="flex-1 md:flex-none"
          >
            <Banknote className="size-4" strokeWidth={2} />
            Registrar pago
          </Button>
          <Button onClick={() => setEmpleadoDialog("nuevo")} className="flex-1 md:flex-none">
            <Plus className="size-4" strokeWidth={2.2} />
            Agregar persona
          </Button>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <StatCard etiqueta="En nómina" valor={String(resumen.activos)} icono={Users} />
        <StatCard
          etiqueta="Costo al mes"
          valor={formatearMXN(resumen.mensual)}
          nota="sueldos fijos proyectados"
          icono={Banknote}
        />
        <StatCard
          etiqueta="Por pagar"
          valor={formatearMXN(resumen.pendiente)}
          nota="pagos registrados sin liquidar"
          icono={CalendarClock}
          valorClassName={resumen.pendiente > 0 ? "text-amber-600" : undefined}
        />
        <StatCard
          etiqueta="Sin formalizar"
          valor={String(resumen.sinFormalizar)}
          nota="ni IMSS ni contrato"
          icono={AlertTriangle}
          valorClassName={resumen.sinFormalizar > 0 ? "text-red-600" : undefined}
        />
      </div>

      <div className="mb-4">
        <ControlSegmentado opciones={VISTAS} valor={vista} onCambio={setVista} />
      </div>

      {vista === "personas" ? (
        <TablaSimple
          cols={esAgencia ? COLS_PERSONAS_AGENCIA : COLS_PERSONAS_FRESAFIT}
          columnas={columnasPersonas}
          datos={empleados}
          filaKey={(e) => e.id}
          minW={esAgencia ? "min-w-[860px]" : "min-w-[760px]"}
          onRowClick={(e) => setEmpleadoDialog(e)}
          filaClassName={(e) => (e.activo ? "" : "opacity-60")}
          vacio={
            esAgencia
              ? "Nadie asignado todavía. Agrega a quien atienda a los clientes de la agencia."
              : "Todavía no hay nadie en la nómina."
          }
        />
      ) : (
        <TablaSimple
          cols={COLS_PAGOS}
          columnas={columnasPagos}
          datos={pagos}
          filaKey={(p) => p.id}
          minW="min-w-[760px]"
          vacio="Todavía no se ha registrado ningún pago."
        />
      )}

      {empleadoDialog && (
        <EmpleadoDialog
          empleado={empleadoDialog === "nuevo" ? null : empleadoDialog}
          empresas={empresas}
          equipo={equipo}
          ambito={ambito}
          onClose={() => setEmpleadoDialog(null)}
        />
      )}
      {pagoDialog && (
        <PagoDialog
          empleados={empleados}
          preseleccionado={pagoDialog === "nuevo" ? null : pagoDialog}
          onClose={() => setPagoDialog(null)}
        />
      )}
    </div>
  );
}
