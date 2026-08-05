"use client";

import { useMemo, useState } from "react";
import { ClipboardPaste } from "lucide-react";
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
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { importarProspectos, type ProspectoInput } from "@/app/(app)/influencers/actions";
import { parsearHandle, parsearSeguidores, parsearTSV } from "@/lib/importar/tsv";
import { textoONulo } from "@/lib/validacion";
import { cn } from "@/lib/utils";

/* Columnas del formulario de convocatoria, en el orden en que las entrega la
   hoja de respuestas. La marca temporal se ignora: no aporta nada a la ficha. */
const ENCABEZADOS = [
  "Marca temporal",
  "Nombre completo",
  "Resides en México?",
  "Correo y celular de contacto",
  "@ de instagram",
  "Seguidores en Instagram",
  "@ de titkok",
  "Seguidores en tiktok",
  "¿Cómo definirias tu contenido?",
];

type FilaPreview = {
  input: ProspectoInput;
  igSospechoso: boolean;
  ttSospechoso: boolean;
  igCrudo: string;
  ttCrudo: string;
};

/* Alta en lote pegando las respuestas del formulario. Los datos vienen sucios a
   propósito de la vida real ("32mil", "8.2", el correo y el teléfono en la
   misma celda): nada se rechaza, lo dudoso se pinta ámbar y se importa igual. */
export function ImportarProspectos() {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const { pending, ejecutar } = useAccionServidor();

  const filas = useMemo(() => (abierto ? parsear(texto) : []), [abierto, texto]);
  const dudosas = filas.filter((f) => f.igSospechoso || f.ttSospechoso).length;

  function cerrar() {
    setAbierto(false);
    setTexto("");
  }

  function importar() {
    if (!filas.length) {
      toast.error("No hay renglones con nombre para importar.");
      return;
    }
    ejecutar(() => importarProspectos(filas.map((f) => f.input)), {
      error: "No se pudo importar. Revisa tu conexión.",
      alExito: (r) => {
        const datos = "datos" in r ? r.datos : { creados: 0, omitidos: 0 };
        toast.success(
          `${datos.creados} ${datos.creados === 1 ? "prospecto creado" : "prospectos creados"}` +
            (datos.omitidos > 0 ? ` · ${datos.omitidos} ya estaban.` : "."),
        );
        cerrar();
      },
    });
  }

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setAbierto(true)}
        className="h-auto w-full gap-1.5 rounded-[11px] px-[15px] py-2.5 text-[13.5px] font-semibold md:w-auto"
      >
        <ClipboardPaste className="size-4" strokeWidth={2} />
        Importar prospectos
      </Button>

      {abierto && (
        <Dialog open onOpenChange={(v) => !v && cerrar()}>
          <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
            <DialogHeader>
              <DialogTitle>Importar prospectos del formulario</DialogTitle>
            </DialogHeader>

            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">
                Copia las respuestas de la hoja del formulario tal cual, con sus columnas:{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">
                  Marca temporal · Nombre · Reside en México · Correo y celular · @IG · Seguidores IG
                  · @TikTok · Seguidores TikTok · Tipo de contenido
                </code>
                . Quien ya esté registrado (mismo correo o mismo Instagram) se omite.
              </p>

              <Textarea
                rows={7}
                autoFocus
                className="font-mono text-[12.5px]"
                placeholder={
                  "12/06/2025\tMaría López\tSí\tmaria@correo.com 6621234567\t@marialopez\t32mil\t@marialpz\t8.2\tFitness"
                }
                value={texto}
                onChange={(e) => setTexto(e.target.value)}
              />

              {dudosas > 0 && (
                <p className="text-[13px] text-amber-600">
                  {dudosas} {dudosas === 1 ? "renglón trae" : "renglones traen"} un número de
                  seguidores escrito a mano que hubo que interpretar. Se importan igual; revísalos
                  después en la ficha.
                </p>
              )}

              {filas.length > 0 && (
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-semibold">Nombre</th>
                        <th className="px-3 py-2 font-semibold">Contacto</th>
                        <th className="px-3 py-2 font-semibold">Instagram</th>
                        <th className="px-3 py-2 font-semibold">TikTok</th>
                        <th className="px-3 py-2 font-semibold">Contenido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filas.map((f, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 font-medium">{f.input.nombre}</td>
                          <td className="px-3 py-2 text-muted-foreground">
                            {f.input.correo ?? "—"}
                            {f.input.celular && (
                              <span className="block text-[11px]">{f.input.celular}</span>
                            )}
                          </td>
                          <td className={cn("px-3 py-2", f.igSospechoso && "text-amber-600")}>
                            {f.input.ig_usuario ?? "—"}
                            <span className="block text-[11px]">
                              {f.input.ig_seguidores?.toLocaleString("es-MX") ?? "sin dato"}
                              {f.igSospechoso && ` · escrito «${f.igCrudo}»`}
                            </span>
                          </td>
                          <td className={cn("px-3 py-2", f.ttSospechoso && "text-amber-600")}>
                            {f.input.tiktok_usuario ?? "—"}
                            <span className="block text-[11px]">
                              {f.input.tiktok_seguidores?.toLocaleString("es-MX") ?? "sin dato"}
                              {f.ttSospechoso && ` · escrito «${f.ttCrudo}»`}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">
                            <span className="block max-w-[220px] truncate">
                              {f.input.tipo_contenido ?? "—"}
                            </span>
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
              <Button onClick={importar} disabled={pending || !filas.length}>
                {pending
                  ? "Importando…"
                  : `Importar ${filas.length || ""} ${filas.length === 1 ? "prospecto" : "prospectos"}`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}

/* El formulario junta correo y celular en una sola celda: se parte por el
   primer texto con arroba (correo) y lo que quede con muchos dígitos (teléfono). */
function partirContacto(celda: string): { correo: string | null; celular: string | null } {
  const partes = (celda ?? "").split(/[\s,;/]+/).filter(Boolean);
  const correo = partes.find((p) => p.includes("@") && p.includes(".")) ?? null;
  const celular = partes.find((p) => p !== correo && (p.match(/\d/g)?.length ?? 0) >= 7) ?? null;
  return { correo, celular };
}

function parsear(texto: string): FilaPreview[] {
  return parsearTSV(texto, ENCABEZADOS)
    .map((celdas): FilaPreview | null => {
      /* La primera columna es la marca temporal del formulario; se descarta. */
      const [, nombre = "", , contacto = "", ig = "", igSeg = "", tt = "", ttSeg = "", contenido = ""] =
        celdas;
      if (!nombre.trim()) return null;

      const { correo, celular } = partirContacto(contacto);
      const seguidoresIg = parsearSeguidores(igSeg);
      const seguidoresTt = parsearSeguidores(ttSeg);

      return {
        input: {
          nombre: nombre.trim(),
          correo,
          celular,
          ig_usuario: parsearHandle(ig),
          ig_seguidores: seguidoresIg.valor,
          tiktok_usuario: parsearHandle(tt),
          tiktok_seguidores: seguidoresTt.valor,
          tipo_contenido: textoONulo(contenido),
        },
        igSospechoso: seguidoresIg.sospechoso,
        ttSospechoso: seguidoresTt.sospechoso,
        igCrudo: igSeg,
        ttCrudo: ttSeg,
      };
    })
    .filter((f): f is FilaPreview => f !== null);
}
