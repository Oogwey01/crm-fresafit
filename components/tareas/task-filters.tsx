"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AREAS } from "@/lib/catalogos";
import type { Profile } from "@/lib/types";

export function TaskFilters({
  equipo,
  filtroResponsable,
  setFiltroResponsable,
  filtroArea,
  setFiltroArea,
}: {
  equipo: Profile[];
  filtroResponsable: string;
  setFiltroResponsable: (v: string) => void;
  filtroArea: string;
  setFiltroArea: (v: string) => void;
}) {
  const responsableItems = [
    { value: "todos", label: "Todos los responsables" },
    ...equipo.map((p) => ({ value: p.id, label: p.nombre })),
  ];
  const areaItems = [
    { value: "todas", label: "Todas las áreas" },
    ...AREAS.map((a) => ({ value: a.id, label: a.nombre })),
  ];

  return (
    <>
      <Select
        items={responsableItems}
        value={filtroResponsable}
        onValueChange={(v) => setFiltroResponsable(v ?? "todos")}
      >
        <SelectTrigger className="w-[190px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="todos">Todos los responsables</SelectItem>
          {equipo.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.nombre}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        items={areaItems}
        value={filtroArea}
        onValueChange={(v) => setFiltroArea(v ?? "todas")}
      >
        <SelectTrigger className="w-[160px]">
          <SelectValue />
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
    </>
  );
}
