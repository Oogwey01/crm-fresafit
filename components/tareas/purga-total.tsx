"use client";

import { useState } from "react";
import { AlertTriangle, Download, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { exportarRespaldo, purgarTodasLasTareas } from "@/app/(app)/tareas/actions";
import { FRASE_PURGA } from "@/lib/tareas/purga";

/* «Borrar absolutamente todas las tareas para empezar de cero» (Armando,
   junta 13/08/2026). El flujo obliga a pasar por el respaldo: el botón rojo no
   se habilita hasta que el .json se descargó Y se tecleó la frase. La server
   action re-verifica las dos cosas que puede verificar (rol y frase). */
export function PurgaTotal({
  totalTareas,
  esAgencia,
}: {
  /* Cuántas tareas hay a la vista del tablero (para dimensionar el aviso). */
  totalTareas: number;
  esAgencia: boolean;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [abierto, setAbierto] = useState(false);
  const [respaldado, setRespaldado] = useState(false);
  const [descargando, setDescargando] = useState(false);
  const [frase, setFrase] = useState("");
  const [incluirAgencia, setIncluirAgencia] = useState(esAgencia);

  function cerrar() {
    setAbierto(false);
    setRespaldado(false);
    setFrase("");
  }

  function descargarRespaldo() {
    setDescargando(true);
    ejecutar(() => exportarRespaldo(), {
      error: "No se pudo generar el respaldo. Sin respaldo no hay purga.",
      alExito: (r) => {
        if (!("datos" in r)) return;
        const blob = new Blob([JSON.stringify(r.datos, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `respaldo-fresafit-crm-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setRespaldado(true);
        toast.success("Respaldo descargado. Guárdalo antes de seguir.");
      },
      siempre: () => setDescargando(false),
    });
  }

  function purgar() {
    ejecutar(() => purgarTodasLasTareas(frase, incluirAgencia), {
      error: "No se pudo vaciar el módulo. Nada se borró a medias: reintenta.",
      alExito: (r) => {
        const datos = "datos" in r ? r.datos : { tareas: 0, archivos: 0 };
        toast.success(
          `Listo: ${datos.tareas} tareas y ${datos.archivos} adjuntos borrados. Tablero en cero.`,
        );
        cerrar();
      },
    });
  }

  const listo = respaldado && frase === FRASE_PURGA;

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setAbierto(true)}
        className="h-auto gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold text-destructive hover:text-destructive"
        title="Borra TODAS las tareas para empezar de cero (con respaldo previo)"
      >
        <Trash2 className="size-4" strokeWidth={2} />
        Empezar de cero
      </Button>

      {abierto && (
        <Dialog open onOpenChange={(v) => !v && cerrar()}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <AlertTriangle className="size-5 text-destructive" />
                Vaciar el módulo de tareas
              </DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3 text-sm">
              <p>
                Se van a borrar <b>{totalTareas} tareas a la vista</b> (y las de la papelera), con
                sus comentarios, subtareas, enlaces, historial y archivos adjuntos.{" "}
                <b className="text-destructive">Esto no se puede deshacer.</b>
              </p>

              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={incluirAgencia}
                  onChange={(e) => setIncluirAgencia(e.target.checked)}
                  className="size-4 accent-primary"
                />
                Borrar también las tareas de la Agencia (no solo las de Fresafit)
              </label>

              {/* Paso 1: el respaldo. Sin descarga no hay botón rojo. */}
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <p className="mb-2 text-[13px] font-semibold">
                  1. Descarga el respaldo completo {respaldado && "✓"}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={descargarRespaldo}
                  disabled={descargando}
                >
                  <Download className="size-4" />
                  {descargando ? "Generando…" : respaldado ? "Descargar otra vez" : "Descargar respaldo (.json)"}
                </Button>
              </div>

              {/* Paso 2: la frase. */}
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <p className="mb-2 text-[13px] font-semibold">
                  2. Escribe <code className="rounded bg-muted px-1">{FRASE_PURGA}</code> para
                  confirmar
                </p>
                <Input
                  value={frase}
                  onChange={(e) => setFrase(e.target.value)}
                  placeholder={FRASE_PURGA}
                  disabled={!respaldado}
                  className="font-mono"
                />
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={cerrar} disabled={pending}>
                Cancelar
              </Button>
              <Button variant="destructive" onClick={purgar} disabled={!listo || pending}>
                {pending ? "Borrando…" : "Borrar todo y empezar de cero"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
