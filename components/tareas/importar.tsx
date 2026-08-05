"use client";

import { useMemo, useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { AREAS } from "@/lib/catalogos";
import { importarTareas, type TaskInput } from "@/app/(app)/tareas/actions";
import type { Profile, AreaId, EspacioId, PrioridadId } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Normaliza para comparar nombres sin acentos ni mayúsculas. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

/* Emoji de urgencia → prioridad (🔴 alta, 🟡 media, ⚪ baja). */
function prioridadDeEmoji(s: string): { prioridad: PrioridadId; resto: string } {
  const t = s.trim();
  if (t.startsWith("🔴")) return { prioridad: "alta", resto: t.slice(2).trim() };
  if (t.startsWith("🟡")) return { prioridad: "media", resto: t.slice(2).trim() };
  if (t.startsWith("⚪") || t.startsWith("⚫")) return { prioridad: "baja", resto: t.slice(2).trim() };
  return { prioridad: "media", resto: t };
}

type FilaParseada = TaskInput & {
  areaNombre: string; // lo que se escribió
  areaOk: boolean;
  responsableNombre: string;
  responsableOk: boolean;
  fechaOk: boolean;
};

const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/;

function parsear(texto: string, equipo: Profile[]): FilaParseada[] {
  return texto
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((linea) => {
      const [crudo, areaTxt = "", respTxt = "", fechaTxt = ""] = linea.split("|").map((p) => p.trim());
      const { prioridad, resto: titulo } = prioridadDeEmoji(crudo);

      const area = AREAS.find((a) => norm(a.nombre) === norm(areaTxt) || a.id === norm(areaTxt));
      const persona = respTxt
        ? equipo.find((p) => norm(p.nombre) === norm(respTxt)) ??
          equipo.find((p) => norm(p.nombre).includes(norm(respTxt)))
        : undefined;
      const fechaOk = !fechaTxt || RE_FECHA.test(fechaTxt);

      return {
        titulo,
        descripcion: "",
        responsable_id: persona?.id ?? null,
        area: (area?.id ?? "operaciones") as AreaId,
        prioridad,
        estado: "por_hacer",
        fecha_limite: fechaOk && fechaTxt ? fechaTxt : null,
        recordatorio_at: null,
        etiquetas: [],
        areaNombre: areaTxt,
        areaOk: !areaTxt || !!area,
        responsableNombre: respTxt,
        responsableOk: !respTxt || !!persona,
        fechaOk,
      };
    });
}

/* Botón + diálogo para dar de alta muchas tareas pegando texto (solo gestor).
   Formato por renglón:  emoji Título | Área | Responsable | Fecha(AAAA-MM-DD) */
export function ImportarTareas({
  equipo,
  espacio = "fresafit",
  empresaId = null,
}: {
  equipo: Profile[];
  /* Tablero desde el que se importa (las tareas nacen en ese negocio). */
  espacio?: EspacioId;
  /* Cliente al que se le cargan, si en la agencia hay uno filtrado. */
  empresaId?: string | null;
}) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [pending, startTransition] = useTransition();

  const filas = useMemo(() => (abierto ? parsear(texto, equipo) : []), [texto, equipo, abierto]);
  const conTitulo = filas.filter((f) => f.titulo);

  function cerrar() {
    setAbierto(false);
    setTexto("");
  }

  function importar() {
    if (!conTitulo.length) {
      toast.error("No hay renglones con título para importar.");
      return;
    }
    startTransition(async () => {
      try {
        const r = await importarTareas(conTitulo.map((f) => aTaskInput(f, espacio, empresaId)));
        if ("error" in r) {
          toast.error(r.error);
          return;
        }
        toast.success(`${r.creadas} ${r.creadas === 1 ? "tarea creada" : "tareas creadas"}.`);
        cerrar();
      } catch {
        toast.error("No se pudo importar. Revisa tu conexión.");
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setAbierto(true)}
        className="h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold"
      >
        <Upload className="size-4" strokeWidth={2} />
        Importar
      </Button>

      {abierto && (
        <Dialog open onOpenChange={(v) => !v && cerrar()}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Importar tareas</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Una tarea por renglón:{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  🔴 Título | Área | Responsable | 2026-07-30
                </code>
                . El emoji marca la prioridad (🔴 alta, 🟡 media, ⚪ baja). Los campos después del
                título son opcionales.
              </p>

              <Textarea
                rows={7}
                autoFocus
                placeholder={"🔴 Grabar reel de producto | Contenido | Julio | 2026-07-30\n🟡 Cotizar cajas | Logística | Germán"}
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />

              {conTitulo.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Título</th>
                        <th className="px-3 py-2 font-semibold">Prioridad</th>
                        <th className="px-3 py-2 font-semibold">Área</th>
                        <th className="px-3 py-2 font-semibold">Responsable</th>
                        <th className="px-3 py-2 font-semibold">Fecha</th>
                      </tr>
                    </thead>
                    <tbody>
                      {conTitulo.map((f, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2">{f.titulo}</td>
                          <td className="px-3 py-2 capitalize">{f.prioridad}</td>
                          <td className={cn("px-3 py-2", !f.areaOk && "text-amber-600")}>
                            {AREAS.find((a) => a.id === f.area)?.nombre}
                            {!f.areaOk && f.areaNombre && (
                              <span className="block text-[11px]">«{f.areaNombre}» no existe → Operaciones</span>
                            )}
                          </td>
                          <td className={cn("px-3 py-2", !f.responsableOk && "text-amber-600")}>
                            {f.responsableOk
                              ? (equipo.find((p) => p.id === f.responsable_id)?.nombre ?? "Sin asignar")
                              : `«${f.responsableNombre}» no existe → Sin asignar`}
                          </td>
                          <td className={cn("px-3 py-2", !f.fechaOk && "text-amber-600")}>
                            {f.fechaOk ? (f.fecha_limite ?? "—") : "fecha inválida"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={cerrar} disabled={pending}>
                Cancelar
              </Button>
              <Button onClick={importar} disabled={pending || !conTitulo.length}>
                {pending
                  ? "Importando…"
                  : `Importar ${conTitulo.length || ""} ${conTitulo.length === 1 ? "tarea" : "tareas"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/* Quita los campos de diagnóstico antes de mandar al servidor. Las tareas nacen
   en el tablero desde el que se importó: pegar el acta de una junta de la
   agencia no debe llenar el tablero de Fresafit. */
function aTaskInput(f: FilaParseada, espacio: EspacioId, empresaId: string | null): TaskInput {
  return {
    titulo: f.titulo,
    descripcion: f.descripcion,
    responsable_id: f.responsable_id,
    espacio,
    empresa_id: empresaId,
    area: f.area,
    prioridad: f.prioridad,
    estado: f.estado,
    fecha_limite: f.fecha_limite,
    recordatorio_at: f.recordatorio_at,
    etiquetas: f.etiquetas,
  };
}
