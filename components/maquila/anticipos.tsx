"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pastilla } from "@/components/compartido/pastilla";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { AnticipoDialog } from "@/components/maquila/anticipo-dialog";
import { obtenerTipoAnticipoMaquila } from "@/lib/catalogos";
import { formatearFecha } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type { AnticipoMaquila } from "@/lib/types";

/* Lo que se le adelantó a Eduardo y todavía no se consume. Al arrancar hay que
   ponerle dinero por delante para que compre materia prima; conforme se
   liquidan quincenas, el saldo baja solo. El día que llegue a cero y se quede
   ahí, el proyecto se sostiene con su propio flujo. */
export function AnticiposMaquila({
  anticipos,
  aFavor,
}: {
  anticipos: AnticipoMaquila[];
  aFavor: number;
}) {
  const [nuevo, setNuevo] = useState(false);

  const columnas: Columna<AnticipoMaquila>[] = [
    {
      clave: "concepto",
      label: "Concepto",
      esTitulo: true,
      celda: (a) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{a.concepto}</div>
          <div className="truncate text-[11.5px] text-muted-foreground">
            {formatearFecha(a.fecha)}
            {a.especie_cantidad
              ? ` · ${a.especie_cantidad} ${a.especie_unidad ?? "piezas"}`
              : ""}
          </div>
        </div>
      ),
    },
    {
      clave: "tipo",
      label: "Tipo",
      celda: (a) => (
        <span className="text-muted-foreground">
          {obtenerTipoAnticipoMaquila(a.tipo)?.nombre ?? a.tipo}
        </span>
      ),
    },
    {
      clave: "monto",
      label: "Monto",
      celda: (a) => <span className="tabular-nums">{formatearMXN(a.monto)}</span>,
    },
    {
      clave: "saldo",
      label: "Le queda a favor",
      celda: (a) => {
        const saldo = a.saldo ?? a.monto;
        return saldo > 0 ? (
          <span className="font-semibold tabular-nums text-emerald-600">
            {formatearMXN(saldo)}
          </span>
        ) : (
          <Pastilla nombre="Consumido" color="#94a3b8" />
        );
      },
    },
  ];

  return (
    <div className="grid gap-3 rounded-2xl border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-[13px] font-semibold">Anticipos a Eduardo</div>
          <p className="text-[12.5px] text-muted-foreground">
            Dinero o material adelantado. El corte los consume solo, del más viejo al más nuevo.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <div className="text-[11.5px] text-muted-foreground">Tiene a favor</div>
            <div className="text-[19px] font-bold tabular-nums">{formatearMXN(aFavor)}</div>
          </div>
          <Button variant="outline" className="gap-1.5" onClick={() => setNuevo(true)}>
            <Plus className="size-4" />
            Anticipo
          </Button>
        </div>
      </div>

      <TablaSimple
        cols="grid-cols-[minmax(220px,1.4fr)_150px_130px_150px]"
        columnas={columnas}
        datos={anticipos}
        filaKey={(a) => a.id}
        minW="min-w-[700px]"
        vacio="Todavía no se le ha adelantado nada."
      />

      {nuevo && <AnticipoDialog onClose={() => setNuevo(false)} />}
    </div>
  );
}
