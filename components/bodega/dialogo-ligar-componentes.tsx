"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Link2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { SelectorProducto } from "@/components/compartido/selector-producto";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { ligarComponentes, type LigaComponentes } from "@/app/(app)/bodega/actions";
import { matchProductoPorSku } from "@/lib/importar/tsv";
import type { ProductoLigeroFila } from "@/app/(app)/bodega/page";
import type { ConjuntoConComponentes } from "@/lib/types";

/* Ligar las piezas de los conjuntos a su ficha del inventario.

   La hoja de bodega escribía las piezas por nombre de diseño —«Akatsuki»— y no
   por SKU, y en el catálogo hay tres muñequeras Akatsuki. El importador prefirió
   dejarlas sin ligar antes que adivinar, y así quedaron 200 renglones.

   La clave de esta pantalla es que NO se liga renglón por renglón: el mismo
   texto aparece en decenas de conjuntos, así que se agrupa por texto y se liga
   una vez. Son ~12 nombres para esos 200 renglones. */

type Grupo = {
  /* El texto tal como venía en la hoja. Es la clave del grupo. */
  sku: string;
  /* Ids de `conjunto_componentes` que comparten ese texto. */
  ids: string[];
  /* En cuántos conjuntos distintos aparece. */
  conjuntos: number;
  /* La ficha que ya tienen, si TODOS coinciden. Si están mezclados es null y el
     grupo cuenta como pendiente: mezclado es justo lo que hay que revisar. */
  ligado: string | null;
};

export function DialogoLigarComponentes({
  conjuntos,
  productos,
  onClose,
}: {
  conjuntos: ConjuntoConComponentes[];
  productos: ProductoLigeroFila[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();

  const grupos = useMemo(() => {
    const mapa = new Map<string, { ids: string[]; conjuntos: Set<string>; fichas: Set<string | null> }>();
    for (const c of conjuntos) {
      for (const comp of c.componentes) {
        const clave = comp.sku_componente;
        const g = mapa.get(clave) ?? { ids: [], conjuntos: new Set(), fichas: new Set() };
        g.ids.push(comp.id);
        g.conjuntos.add(c.id);
        g.fichas.add(comp.producto_id);
        mapa.set(clave, g);
      }
    }
    const lista: Grupo[] = [...mapa].map(([sku, g]) => {
      const fichas = [...g.fichas];
      return {
        sku,
        ids: g.ids,
        conjuntos: g.conjuntos.size,
        ligado: fichas.length === 1 && fichas[0] ? fichas[0] : null,
      };
    });
    /* El nombre que aparece 30 veces primero: arreglarlo rinde 30 veces más. */
    return lista.sort((a, b) => b.ids.length - a.ids.length || a.sku.localeCompare(b.sku));
  }, [conjuntos]);

  /* Arranque: lo que ya está ligado, y para lo que no, lo que el SKU resuelva
     solo. Los que casan llegan resueltos y solo hay que confirmarlos.

     Se guarda también el texto del campo —y no solo el id— porque el selector es
     controlado: sin texto propio, un grupo preresuelto enseñaría el campo vacío
     con la ficha colgando debajo, que es justo lo que confunde. */
  const [elegido, setElegido] = useState<Record<string, { id: string | null; texto: string }>>(() =>
    Object.fromEntries(
      grupos.map((g) => {
        const id = g.ligado ?? matchProductoPorSku(g.sku, productos).producto?.id ?? null;
        const ficha = id ? productos.find((p) => p.id === id) : null;
        return [g.sku, { id, texto: ficha?.sku ?? g.sku }];
      }),
    ),
  );
  const [vista, setVista] = useState<"pendientes" | "ligadas">("pendientes");

  const pendientes = grupos.filter((g) => !g.ligado);
  const ligadas = grupos.filter((g) => g.ligado);
  const visibles = vista === "pendientes" ? pendientes : ligadas;

  /* Solo viaja lo que cambia: por ficha elegida, los renglones que todavía no la
     tienen. Dos nombres distintos pueden apuntar a la misma ficha, así que se
     agrupan por producto_id y no por texto. */
  const ligas = useMemo(() => {
    const porFicha = new Map<string, string[]>();
    const idsPorGrupo = new Map(grupos.map((g) => [g.sku, g]));
    for (const [sku, sel] of Object.entries(elegido)) {
      const g = idsPorGrupo.get(sku);
      if (!sel.id || !g || g.ligado === sel.id) continue;
      porFicha.set(sel.id, [...(porFicha.get(sel.id) ?? []), ...g.ids]);
    }
    return [...porFicha].map(([producto_id, componente_ids]): LigaComponentes => ({
      producto_id,
      componente_ids,
    }));
  }, [elegido, grupos]);

  const nombresPorLigar = Object.entries(elegido).filter(([sku, sel]) => {
    const g = grupos.find((x) => x.sku === sku);
    return sel.id && g && g.ligado !== sel.id;
  }).length;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Ligar componentes a su ficha</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
            <p>
              Cada renglón es un nombre de pieza tal como venía en la hoja, con los conjuntos en los
              que aparece. Elige a qué ficha del inventario corresponde y queda ligada{" "}
              <b className="font-semibold text-foreground">en todos de una vez</b>: son{" "}
              {grupos.length} {grupos.length === 1 ? "nombre" : "nombres"} para{" "}
              {grupos.reduce((n, g) => n + g.ids.length, 0)} renglones.
            </p>
            <p>
              Se guarda <b className="font-semibold text-foreground">la ficha, no el texto</b>: el
              nombre de la hoja se queda como estaba, para saber de dónde salió cada renglón. Si hay
              varias fichas parecidas, la buena casi siempre es la que tiene el stock — en la lista
              sale cuántas piezas hay de cada una.
            </p>
          </div>

          {grupos.length > 0 && (
            <ControlSegmentado
              className="self-start"
              opciones={[
                ["pendientes", `Sin ligar (${pendientes.length})`],
                ["ligadas", `Ya ligadas (${ligadas.length})`],
              ] as const}
              valor={vista}
              onCambio={setVista}
            />
          )}

          {visibles.length === 0 ? (
            <p className="rounded-lg border bg-muted/40 px-4 py-6 text-center text-sm italic text-muted-foreground">
              {vista === "pendientes"
                ? "Todas las piezas están ligadas a su ficha. Nada que hacer aquí."
                : "Todavía no hay ninguna pieza ligada."}
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {visibles.map((g) => (
                /* items-start: el selector crece hacia abajo con la línea de la
                   ficha ligada y arrastraría al resto. */
                <div key={g.sku} className="flex items-start gap-3">
                  <div className="w-56 shrink-0 pt-2">
                    <div className="truncate font-mono text-[12.5px] font-semibold" title={g.sku}>
                      {g.sku}
                    </div>
                    <div className="text-[12px] text-muted-foreground">
                      en {g.conjuntos} {g.conjuntos === 1 ? "conjunto" : "conjuntos"}
                      {g.ids.length !== g.conjuntos && ` · ${g.ids.length} renglones`}
                    </div>
                  </div>
                  <SelectorProducto
                    valor={elegido[g.sku]?.texto ?? g.sku}
                    productoId={elegido[g.sku]?.id ?? null}
                    productos={productos}
                    placeholder="SKU o nombre de la pieza…"
                    onCambio={(texto, productoId) =>
                      setElegido((prev) => ({ ...prev, [g.sku]: { id: productoId, texto } }))
                    }
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !ligas.length}
            onClick={() =>
              ejecutar(() => ligarComponentes(ligas), {
                error: "No se pudo ligar. Revisa tu conexión.",
                alExito: (r) => {
                  const datos = "datos" in r ? r.datos : { nombres: 0, renglones: 0 };
                  toast.success(
                    `${datos.nombres} ${datos.nombres === 1 ? "nombre ligado" : "nombres ligados"} · ` +
                      `${datos.renglones} ${datos.renglones === 1 ? "renglón arreglado" : "renglones arreglados"}.`,
                  );
                  onClose();
                },
              })
            }
          >
            <Link2 className="size-4" />
            {pending ? "Ligando…" : `Ligar ${nombresPorLigar || ""} ${nombresPorLigar === 1 ? "nombre" : "nombres"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
