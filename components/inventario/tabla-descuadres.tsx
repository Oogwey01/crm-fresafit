"use client";

import { useState } from "react";
import type { Descuadre } from "@/lib/inventario/reconciliacion";
import { TIPOS_PRODUCTO, obtenerTipoProducto } from "@/lib/catalogos";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { cn } from "@/lib/utils";

const COLS = "grid-cols-[minmax(200px,1fr)_130px_110px_130px_130px]";

/* Filtro para los combos/bundles (variantes sin control de stock en TN). */
const COMBOS = [
  ["todos", "Combos incluidos"],
  ["ocultar", "Ocultar combos"],
  ["solo", "Solo combos"],
] as const;

/* Celda de stock de un canal: resalta en rojo cuando difiere del CRM, marca
   "no está" cuando el producto está vinculado pero ya no aparece en el canal, y
   "—" cuando simplemente no está vinculado a ese canal. */
function CeldaCanal({
  valor,
  falta,
  vinculado,
  stockCrm,
}: {
  valor: number | null;
  falta: boolean;
  vinculado: boolean;
  stockCrm: number;
}) {
  if (falta) {
    return <span className="text-[12.5px] font-semibold text-amber-600">No está en el canal</span>;
  }
  if (!vinculado || valor === null) {
    return <span className="text-muted-foreground/50">—</span>;
  }
  const difiere = valor !== stockCrm;
  return (
    <span className={cn("tabular-nums", difiere ? "font-bold text-red-600" : "text-muted-foreground")}>
      {valor}
    </span>
  );
}

export function TablaDescuadres({ descuadres }: { descuadres: Descuadre[] }) {
  const [filtroTipo, setFiltroTipo] = useState("todos");
  const [filtroCombo, setFiltroCombo] = useState("todos");

  const visibles = descuadres.filter((d) => {
    if (filtroTipo !== "todos" && d.tipo !== filtroTipo) return false;
    if (filtroCombo === "ocultar" && d.es_combo) return false;
    if (filtroCombo === "solo" && !d.es_combo) return false;
    return true;
  });

  const columnas: Columna<Descuadre>[] = [
    {
      clave: "producto",
      label: "Producto",
      esTitulo: true,
      celda: (d) => (
        <div className="flex min-w-0 items-center gap-2" title={d.nombre}>
          <span className="truncate">
            <span className="font-medium">{d.nombre}</span>
            {d.variante && <span className="text-muted-foreground"> · {d.variante}</span>}
          </span>
          {d.es_combo && (
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
              Combo
            </span>
          )}
        </div>
      ),
    },
    {
      clave: "sku",
      label: "SKU",
      celda: (d) => (
        <div className="truncate text-muted-foreground" title={d.sku ?? undefined}>
          {d.sku ?? "—"}
        </div>
      ),
    },
    {
      clave: "crm",
      label: "CRM",
      celda: (d) => <span className="font-semibold tabular-nums">{d.stock_crm}</span>,
    },
    {
      clave: "tn",
      label: "Tienda Nube",
      celda: (d) => (
        <CeldaCanal
          valor={d.stock_tn}
          falta={d.falta_en_tn}
          vinculado={d.stock_tn !== null || d.falta_en_tn}
          stockCrm={d.stock_crm}
        />
      ),
    },
    {
      clave: "ml",
      label: "Mercado Libre",
      celda: (d) => (
        <CeldaCanal
          valor={d.stock_ml}
          falta={d.falta_en_ml}
          vinculado={d.stock_ml !== null || d.falta_en_ml}
          stockCrm={d.stock_crm}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filtroTipo} onValueChange={(v) => setFiltroTipo(v ?? "todos")}>
          <SelectTrigger className="w-[190px] bg-card">
            <SelectValue>
              {(v: string) => (v === "todos" ? "Todos los tipos" : (obtenerTipoProducto(v)?.nombre ?? "Tipo"))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todos">Todos los tipos</SelectItem>
            {TIPOS_PRODUCTO.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filtroCombo} onValueChange={(v) => setFiltroCombo(v ?? "todos")}>
          <SelectTrigger className="w-[175px] bg-card">
            <SelectValue>
              {(v: string) => COMBOS.find(([id]) => id === v)?.[1] ?? "Combos"}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {COMBOS.map(([id, label]) => (
              <SelectItem key={id} value={id}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-[12.5px] text-muted-foreground">
          {visibles.length} de {descuadres.length}
        </span>
      </div>
      <TablaSimple
        cols={COLS}
        columnas={columnas}
        datos={visibles}
        filaKey={(d) => d.id}
        minW="min-w-[760px]"
        vacio="Sin descuadres con estos filtros."
      />
    </div>
  );
}
