"use client";

import { useMemo, useState } from "react";
import { ClipboardPaste, Plus } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  borrarConjunto,
  guardarConjunto,
  importarConjuntos,
  type ConjuntoInput,
} from "@/app/(app)/inventario/bodega/actions";
import { ROLES_COMPONENTE } from "@/lib/catalogos";
import { matchProductoPorSku, normalizarSku, parsearTSV } from "@/lib/importar/tsv";
import type { ProductoLigeroFila } from "@/app/(app)/inventario/bodega/page";
import type { ConjuntoConComponentes, RolComponenteId } from "@/lib/types";

const ENCABEZADOS = [
  "SKU CONJUNTO",
  "TITULO",
  "CATEGORIA",
  "PRODUCTO",
  "TALLA",
  "SKU CINTURON",
  "CINTURON",
  "SKU MUÑEQUERAS",
  "MUÑEQUERAS",
  "SKU STRAPS",
  "STRAPS",
];

/* Conjuntos (bundles): un SKU que se arma con otros. Lo importante en el piso
   es cuántos se pueden armar HOY, que es el mínimo de sus componentes. */
export function SeccionConjuntos({
  conjuntos,
  productos,
}: {
  conjuntos: ConjuntoConComponentes[];
  productos: ProductoLigeroFila[];
}) {
  const [dialogo, setDialogo] = useState<ConjuntoConComponentes | "nuevo" | null>(null);
  const [importando, setImportando] = useState(false);

  /* Armables = el componente que primero se acaba. Sin ficha ligada no se puede
     saber, y se muestra "—" en vez de un número inventado. */
  function armables(c: ConjuntoConComponentes): number | null {
    if (!c.componentes.length) return null;
    let minimo = Infinity;
    for (const comp of c.componentes) {
      const p = productos.find(
        (x) =>
          x.id === comp.producto_id ||
          (x.sku && normalizarSku(x.sku) === normalizarSku(comp.sku_componente)),
      );
      if (!p) return null;
      minimo = Math.min(minimo, Math.floor(p.stock / comp.cantidad));
    }
    return Number.isFinite(minimo) ? minimo : null;
  }

  const columnas: Columna<ConjuntoConComponentes>[] = [
    {
      clave: "sku",
      label: "SKU",
      esTitulo: true,
      celda: (c) => (
        <div className="min-w-0">
          <div className="font-mono text-[12.5px] font-semibold">{c.sku}</div>
          <div className="truncate text-[12.5px] text-muted-foreground">{c.titulo}</div>
        </div>
      ),
    },
    {
      clave: "componentes",
      label: "Se arma con",
      celda: (c) => (
        <span className="text-muted-foreground">
          {c.componentes.length
            ? c.componentes
                .map((x) => `${x.cantidad > 1 ? `${x.cantidad}× ` : ""}${x.sku_componente}`)
                .join(" + ")
            : "—"}
        </span>
      ),
    },
    { clave: "talla", label: "Talla", celda: (c) => c.talla ?? "—" },
    {
      clave: "armables",
      label: "Armables",
      celda: (c) => {
        const n = armables(c);
        if (n === null) return <span className="text-muted-foreground">—</span>;
        return (
          <span className={n === 0 ? "font-semibold text-red-600 tabular-nums" : "tabular-nums"}>
            {n}
          </span>
        );
      },
    },
    {
      clave: "acciones",
      label: "",
      celda: (c) => (
        <Button variant="outline" size="sm" onClick={() => setDialogo(c)}>
          Editar
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13.5px] text-muted-foreground">
          {conjuntos.length} {conjuntos.length === 1 ? "conjunto" : "conjuntos"} · «Armables» es
          cuántos alcanzan con el stock de sus componentes.
        </p>
        <div className="flex-1" />
        <Button variant="outline" onClick={() => setImportando(true)}>
          <ClipboardPaste className="size-4" /> Pegar desde Excel
        </Button>
        <Button onClick={() => setDialogo("nuevo")}>
          <Plus className="size-4" /> Nuevo conjunto
        </Button>
      </div>

      <TablaSimple
        cols="grid-cols-[minmax(200px,1.2fr)_minmax(240px,1.6fr)_100px_110px_90px]"
        columnas={columnas}
        datos={conjuntos}
        filaKey={(c) => c.id}
        minW="min-w-[860px]"
        vacio="Sin conjuntos. Pega la hoja de CONJUNTOS para cargarlos de una vez."
        onRowClick={setDialogo}
      />

      {dialogo && (
        <DialogoConjunto
          conjunto={dialogo === "nuevo" ? null : dialogo}
          productos={productos}
          onClose={() => setDialogo(null)}
        />
      )}
      {importando && (
        <DialogoImportarConjuntos productos={productos} onClose={() => setImportando(false)} />
      )}
    </div>
  );
}

/* --- Alta / edición ------------------------------------------------------- */
type ComponenteForm = {
  sku_componente: string;
  producto_id: string | null;
  rol: RolComponenteId | null;
  cantidad: string;
};

function DialogoConjunto({
  conjunto,
  productos,
  onClose,
}: {
  conjunto: ConjuntoConComponentes | null;
  productos: ProductoLigeroFila[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [sku, setSku] = useState(conjunto?.sku ?? "");
  const [titulo, setTitulo] = useState(conjunto?.titulo ?? "");
  const [categoria, setCategoria] = useState(conjunto?.categoria ?? "");
  const [talla, setTalla] = useState(conjunto?.talla ?? "");
  const [componentes, setComponentes] = useState<ComponenteForm[]>(() =>
    conjunto?.componentes.length
      ? conjunto.componentes.map((c) => ({
          sku_componente: c.sku_componente,
          producto_id: c.producto_id,
          rol: c.rol,
          cantidad: String(c.cantidad),
        }))
      : /* Los conjuntos de Fresafit son siempre estos tres; se prellenan. */
        [
          { sku_componente: "", producto_id: null, rol: "cinturon", cantidad: "1" },
          { sku_componente: "", producto_id: null, rol: "munequeras", cantidad: "1" },
          { sku_componente: "", producto_id: null, rol: "straps", cantidad: "1" },
        ],
  );

  function editar(idx: number, cambio: Partial<ComponenteForm>) {
    setComponentes((prev) => prev.map((c, i) => (i === idx ? { ...c, ...cambio } : c)));
  }

  function guardar() {
    const input: ConjuntoInput = {
      sku,
      titulo,
      categoria: categoria.trim() || null,
      talla: talla.trim() || null,
      componentes: componentes
        .filter((c) => c.sku_componente.trim())
        .map((c) => ({
          sku_componente: c.sku_componente,
          producto_id:
            c.producto_id ??
            matchProductoPorSku(c.sku_componente, productos).producto?.id ??
            null,
          rol: c.rol,
          cantidad: Number(c.cantidad) || 1,
        })),
    };
    ejecutar(() => guardarConjunto(conjunto?.id ?? null, input), {
      ok: conjunto ? "Conjunto actualizado." : "Conjunto creado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{conjunto ? "Editar conjunto" : "Nuevo conjunto"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cj-sku">SKU del conjunto</Label>
              <Input
                id="cj-sku"
                className="font-mono"
                value={sku}
                onChange={(e) => setSku(e.target.value.toUpperCase())}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="cj-talla">Talla</Label>
              <Input id="cj-talla" value={talla} onChange={(e) => setTalla(e.target.value)} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="cj-titulo">Título</Label>
              <Input id="cj-titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            </div>
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="cj-cat">Categoría</Label>
              <Input id="cj-cat" value={categoria} onChange={(e) => setCategoria(e.target.value)} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Se arma con</Label>
            {componentes.map((c, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-[12.5px] text-muted-foreground">
                  {ROLES_COMPONENTE.find((r) => r.id === c.rol)?.nombre ?? "Componente"}
                </span>
                <Input
                  placeholder="SKU"
                  className="font-mono"
                  value={c.sku_componente}
                  onChange={(e) =>
                    editar(idx, { sku_componente: e.target.value.toUpperCase(), producto_id: null })
                  }
                />
                <Input
                  type="number"
                  min="1"
                  aria-label="Cantidad"
                  className="w-20 shrink-0"
                  value={c.cantidad}
                  onChange={(e) => editar(idx, { cantidad: e.target.value })}
                />
              </div>
            ))}
            <div>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setComponentes((prev) => [
                    ...prev,
                    { sku_componente: "", producto_id: null, rol: "otro", cantidad: "1" },
                  ])
                }
              >
                + Otro componente
              </Button>
            </div>
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={conjunto ? "Guardar cambios" : "Crear conjunto"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={
            conjunto
              ? () =>
                  ejecutar(() => borrarConjunto(conjunto.id), {
                    confirmar: `¿Borrar el conjunto ${conjunto.sku}?`,
                    ok: "Conjunto borrado.",
                    alExito: onClose,
                  })
              : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/* --- Pegar la hoja de conjuntos ------------------------------------------- */
function DialogoImportarConjuntos({
  productos,
  onClose,
}: {
  productos: ProductoLigeroFila[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [texto, setTexto] = useState("");

  const filas = useMemo(() => {
    return parsearTSV(texto, ENCABEZADOS)
      .map((celdas): ConjuntoInput | null => {
        const [
          sku = "",
          titulo = "",
          categoria = "",
          ,
          talla = "",
          skuCinturon = "",
          ,
          skuMunequeras = "",
          ,
          skuStraps = "",
        ] = celdas;
        if (!sku.trim() || !titulo.trim()) return null;

        const componente = (s: string, rol: RolComponenteId) =>
          s.trim()
            ? [
                {
                  sku_componente: s.trim(),
                  producto_id: matchProductoPorSku(s, productos).producto?.id ?? null,
                  rol,
                  cantidad: 1,
                },
              ]
            : [];

        return {
          sku: sku.trim(),
          titulo: titulo.trim(),
          categoria: categoria.trim() || null,
          talla: talla.trim() || null,
          componentes: [
            ...componente(skuCinturon, "cinturon"),
            ...componente(skuMunequeras, "munequeras"),
            ...componente(skuStraps, "straps"),
          ],
        };
      })
      .filter((f): f is ConjuntoInput => f !== null);
  }, [texto, productos]);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pegar conjuntos desde Excel</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Copia la hoja de CONJUNTOS con sus columnas:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              SKU CONJUNTO · TITULO · CATEGORIA · PRODUCTO · TALLA · SKU CINTURON · CINTURON · SKU
              MUÑEQUERAS · MUÑEQUERAS · SKU STRAPS · STRAPS
            </code>
            . Los conjuntos que ya existan se omiten.
          </p>

          <Textarea
            rows={7}
            autoFocus
            className="font-mono text-[12.5px]"
            placeholder={"CJ001\tConjunto Olimpo G\tConjuntos\tConjunto\tG\tPRM001G\tCinturón Olimpo\tMQR004\tMuñequeras\tSTR002\tStraps"}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />

          {filas.length > 0 && (
            <div className="max-h-[300px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">SKU</th>
                    <th className="px-3 py-2 font-semibold">Título</th>
                    <th className="px-3 py-2 font-semibold">Componentes</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i} className="border-t">
                      <td className="px-3 py-1.5 font-mono text-[12.5px]">{f.sku}</td>
                      <td className="px-3 py-1.5">{f.titulo}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {f.componentes.map((c) => c.sku_componente).join(" + ") || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending || !filas.length}
            onClick={() =>
              ejecutar(() => importarConjuntos(filas), {
                error: "No se pudo importar. Revisa tu conexión.",
                alExito: (r) => {
                  const datos = "datos" in r ? r.datos : { creados: 0, omitidos: 0 };
                  toast.success(
                    `${datos.creados} ${datos.creados === 1 ? "conjunto creado" : "conjuntos creados"}` +
                      (datos.omitidos > 0 ? ` · ${datos.omitidos} ya existían.` : "."),
                  );
                  onClose();
                },
              })
            }
          >
            {pending ? "Importando…" : `Importar ${filas.length || ""} conjuntos`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
