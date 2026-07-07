import { MODULOS } from "@/lib/catalogos";

/* Página "en construcción" para los módulos de la Fase 2. */
export function ModuloPlaceholder({ id }: { id: string }) {
  const m = MODULOS.find((x) => x.id === id);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
      <div className="text-5xl">{m?.icono ?? "🚧"}</div>
      <h1 className="mt-4 text-2xl font-bold">{m?.nombre ?? "Módulo"}</h1>
      <p className="mt-2 max-w-md text-muted-foreground">
        Este módulo se construirá en la Fase 2. Por ahora es un espacio
        reservado; su tabla ya existe en la base de datos.
      </p>
      <span className="mt-4 rounded-full bg-muted px-3 py-1 text-sm font-semibold text-muted-foreground">
        Próximamente
      </span>
    </div>
  );
}
