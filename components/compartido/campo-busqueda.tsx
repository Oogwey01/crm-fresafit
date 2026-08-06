"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/* El buscador de las listas: lupa dentro del campo y una cruz para vaciarlo
   —en el piso se busca desde el teléfono y borrar letra por letra es un
   fastidio—. El criterio de coincidencia vive en lib/busqueda.ts para que todas
   las listas busquen igual. */
export function CampoBusqueda({
  valor,
  onCambio,
  placeholder = "Buscar…",
  className,
}: {
  valor: string;
  onCambio: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={cn("relative flex w-full items-center md:w-auto md:min-w-[260px]", className)}>
      <Search
        className="pointer-events-none absolute left-3 size-4 text-muted-foreground"
        strokeWidth={1.9}
      />
      <Input
        type="search"
        aria-label={placeholder}
        placeholder={placeholder}
        value={valor}
        onChange={(e) => onCambio(e.target.value)}
        className={cn("h-auto rounded-[10px] bg-card py-2 pl-9", valor && "pr-9")}
      />
      {valor && (
        <button
          type="button"
          onClick={() => onCambio("")}
          className="absolute right-2.5 text-muted-foreground hover:text-foreground"
          aria-label="Limpiar búsqueda"
        >
          <X className="size-4" strokeWidth={2} />
        </button>
      )}
    </div>
  );
}
