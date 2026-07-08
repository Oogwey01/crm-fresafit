"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AREAS } from "@/lib/catalogos";

/* Filtro de ÁREA (solo en la vista "Por área"). El filtro de PERSONA se movió a la
   barra superior del Board para que aplique también en "Mis tareas". */
export function TaskFilters({
  filtroArea,
  setFiltroArea,
}: {
  filtroArea: string;
  setFiltroArea: (v: string) => void;
}) {
  return (
    <Select
      value={filtroArea}
      onValueChange={(v) => setFiltroArea(v ?? "todas")}
    >
      <SelectTrigger className="w-[160px]">
        <SelectValue>
          {(value: string) =>
            value === "todas" ? "Todas las áreas" : (AREAS.find((a) => a.id === value)?.nombre ?? "Área")}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="todas">Todas las áreas</SelectItem>
        {AREAS.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            {a.nombre}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
