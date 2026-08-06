"use client";

import { useMemo, useState } from "react";
import { ClipboardPaste, Hammer, Info, Link2, Plus, TriangleAlert } from "lucide-react";
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
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { SelectorProducto } from "@/components/compartido/selector-producto";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  borrarConjunto,
  guardarConjunto,
  importarConjuntos,
  ligarFichaConjunto,
  marcarConjuntoSubido,
  type ConjuntoInput,
} from "@/app/(app)/bodega/actions";
import { DialogoArmar } from "@/components/bodega/dialogo-armar";
import { DialogoLigarComponentes } from "@/components/bodega/dialogo-ligar-componentes";
import { ROLES_COMPONENTE } from "@/lib/catalogos";
import { coincide, terminosBusqueda } from "@/lib/busqueda";
import { matchProductoPorSku, parsearTSV } from "@/lib/importar/tsv";
import type { CanalesFicha, ProductoLigeroFila } from "@/app/(app)/bodega/page";
import type {
  ConjuntoArmado,
  ConjuntoConComponentes,
  Profile,
  RolComponenteId,
} from "@/lib/types";

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
  armados,
  canalesFicha,
  equipo,
}: {
  conjuntos: ConjuntoConComponentes[];
  productos: ProductoLigeroFila[];
  armados: ConjuntoArmado[];
  canalesFicha: CanalesFicha;
  equipo: Profile[];
}) {
  const [dialogo, setDialogo] = useState<ConjuntoConComponentes | "nuevo" | null>(null);
  const [armando, setArmando] = useState<ConjuntoConComponentes | null>(null);
  const [ligando, setLigando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [busqueda, setBusqueda] = useState("");
  const { pending, ejecutar } = useAccionServidor();

  /* Se busca por lo que se tiene a la mano en el piso: el SKU del conjunto, su
     nombre o el SKU de cualquiera de sus piezas —de ahí que los componentes
     entren al comparador—. El compilador de React memoiza esto solo. */
  const terminos = terminosBusqueda(busqueda);
  const visibles = conjuntos.filter((c) =>
    coincide(
      terminos,
      c.sku,
      c.titulo,
      c.categoria,
      c.talla,
      ...c.componentes.map((x) => x.sku_componente),
    ),
  );

  /* Armables = el componente que primero se acaba. Sin ficha ligada no se puede
     saber, y se muestra "—" en vez de un número inventado.

     Se mira SOLO `producto_id` —y no, como antes, también el SKU parecido—:
     armar_conjunto() exige la ficha ligada, así que un número calculado por
     parecido saldría en pantalla junto a un botón que no funciona. Un «—» que
     dice la verdad vale más. */
  function armables(c: ConjuntoConComponentes): number | null {
    if (!c.componentes.length) return null;
    let minimo = Infinity;
    for (const comp of c.componentes) {
      const p = productos.find((x) => x.id === comp.producto_id);
      if (!p) return null;
      minimo = Math.min(minimo, Math.floor(p.stock / comp.cantidad));
    }
    return Number.isFinite(minimo) ? minimo : null;
  }

  const fichaDe = (c: ConjuntoConComponentes) =>
    c.producto_id ? (productos.find((p) => p.id === c.producto_id) ?? null) : null;

  /* Piezas de la hoja que todavía no tienen ficha, agrupadas por su texto: es la
     unidad en la que se arreglan (un nombre liga decenas de renglones). */
  const nombresSueltos = new Set(
    conjuntos.flatMap((c) => c.componentes.filter((x) => !x.producto_id).map((x) => x.sku_componente)),
  );
  const sinArmar = conjuntos.filter((c) => armables(c) === null).length;

  /* Lo armado que todavía no se captura en los canales. El neto puede ser
     negativo: deshacer un armado ya subido significa que allá hay que BAJAR. */
  const pendientes = useMemo(() => {
    const porConjunto = new Map<string, number>();
    for (const a of armados) {
      if (a.subido_en || !a.conjunto_id) continue;
      const signo = a.tipo === "armado" ? 1 : -1;
      porConjunto.set(a.conjunto_id, (porConjunto.get(a.conjunto_id) ?? 0) + signo * a.cantidad);
    }
    return [...porConjunto]
      .filter(([, neto]) => neto !== 0)
      .map(([id, neto]) => ({ conjunto: conjuntos.find((c) => c.id === id), neto }))
      .filter((p): p is { conjunto: ConjuntoConComponentes; neto: number } => !!p.conjunto);
  }, [armados, conjuntos]);

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
    {
      clave: "ficha",
      label: "Ficha",
      celda: (c) => <CeldaFicha conjunto={c} ficha={fichaDe(c)} productos={productos} />,
    },
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
    /* Un solo botón, y siempre el SIGUIENTE PASO de ese conjunto —nunca algo que
       picar la fila ya hace, ni algo que hoy es imposible—. Falta la ficha se
       resuelve en su propia celda, no aquí: es un dato de esa columna. */
    {
      clave: "acciones",
      label: "",
      cardAncho: true,
      celda: (c) => {
        const n = armables(c);

        if (n === null) {
          return (
            <Button
              size="sm"
              variant="outline"
              title="Tiene piezas sin ficha ligada: hasta resolverlas no se sabe cuántos alcanzan."
              onClick={() => setLigando(true)}
            >
              <Link2 className="size-3.5" /> Ligar piezas
            </Button>
          );
        }
        if (!c.producto_id) {
          /* Piezas listas pero sin dónde acreditar: el paso está en la celda de
             al lado, y repetirlo aquí sería otro botón que hace lo mismo. */
          return (
            <span className="text-[12.5px] text-muted-foreground">Falta su ficha</span>
          );
        }
        return (
          <Button
            size="sm"
            variant="outline"
            disabled={n === 0}
            title={n === 0 ? "No alcanzan las piezas para armar ninguno." : undefined}
            onClick={() => setArmando(c)}
          >
            <Hammer className="size-3.5" /> Armar
          </Button>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-2.5 rounded-xl border bg-card px-4 py-3 text-[13px] text-muted-foreground">
        <Info className="mt-px size-[17px] shrink-0" strokeWidth={1.8} aria-hidden="true" />
        <span className="leading-relaxed">
          Un conjunto es un SKU que se vende armado —cinturón + muñequeras + straps— y que alguien
          tiene que armar en bodega <b className="font-semibold text-foreground">antes</b> de
          venderlo. Aquí se registra ese trabajo:{" "}
          <b className="font-semibold text-foreground">«Armé N»</b> descuenta las piezas del
          inventario y <b className="font-semibold text-foreground">le acredita N a la ficha del
          conjunto</b>, que es el SKU que se publica en los canales.{" "}
          <b className="font-semibold text-foreground">Armables</b> es cuántos alcanzan hoy con lo
          que hay de cada pieza: manda la que primero se acaba. Vender un conjunto{" "}
          <b className="font-semibold text-foreground">no</b> consume piezas —descuenta su ficha,
          como cualquier producto—, por eso hay que armarlo aquí primero.
        </span>
      </div>

      {nombresSueltos.size > 0 && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-xl bg-amber-500/10 px-4 py-3 text-[13px] leading-relaxed text-amber-700 dark:text-amber-400">
          <span>
            <b className="font-semibold">
              {sinArmar} de {conjuntos.length} conjuntos no se pueden armar todavía.
            </b>{" "}
            La hoja de bodega traía las piezas escritas por nombre («MUÑEQUERAS·Akatsuki»), no por
            SKU, así que {nombresSueltos.size} {nombresSueltos.size === 1 ? "nombre sigue" : "nombres siguen"}{" "}
            sin ficha en el inventario. Ligar un nombre lo arregla en todos los conjuntos donde
            aparece.
          </span>
          <Button size="sm" variant="outline" onClick={() => setLigando(true)}>
            <Link2 className="size-3.5" /> Ligar componentes
          </Button>
        </div>
      )}

      {pendientes.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border bg-card px-4 py-3">
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            <b className="font-semibold text-foreground">Por subir a los canales.</b> Esto ya está
            armado en bodega y contado en el CRM, pero los canales siguen mostrando lo de antes.
            Súbelo en el panel de cada tienda y márcalo aquí para no perderle la pista.
          </p>
          {pendientes.map(({ conjunto, neto }) => {
            const canales = conjunto.producto_id ? canalesFicha[conjunto.producto_id] : undefined;
            const donde = [
              canales?.tienda_nube && "Tienda Nube",
              canales?.mercado_libre && "Mercado Libre",
              canales?.tiktok_shop && "TikTok Shop",
            ].filter(Boolean) as string[];
            return (
              <div key={conjunto.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                <span className="font-mono text-[12.5px] font-semibold">{conjunto.sku}</span>
                <span className={neto < 0 ? "text-amber-700 dark:text-amber-400" : undefined}>
                  · {neto > 0 ? `${neto} armados por subir` : `${-neto} que hay que bajar allá`}
                </span>
                <span className="text-muted-foreground">
                  · {donde.length ? donde.join(" · ") : "sin publicar en ningún canal"}
                </span>
                <div className="flex-1" />
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pending}
                  onClick={() =>
                    ejecutar(() => marcarConjuntoSubido(conjunto.id), {
                      ok: `${conjunto.sku} marcado como subido.`,
                      error: "No se pudo marcar. Revisa tu conexión.",
                    })
                  }
                >
                  Ya lo subí
                </Button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar conjunto, SKU o componente…"
        />
        <p className="text-[13.5px] text-muted-foreground">
          {busqueda.trim()
            ? `${visibles.length} de ${conjuntos.length}`
            : `${conjuntos.length} ${conjuntos.length === 1 ? "conjunto" : "conjuntos"}`}{" "}
          · «Armables» es cuántos alcanzan con las piezas que hay. Sale «—» cuando alguna pieza
          todavía no está ligada a su ficha.
        </p>
        <div className="flex-1" />
        {nombresSueltos.size === 0 && conjuntos.length > 0 && (
          <Button variant="outline" onClick={() => setLigando(true)}>
            <Link2 className="size-4" /> Ligar componentes
          </Button>
        )}
        <Button variant="outline" onClick={() => setImportando(true)}>
          <ClipboardPaste className="size-4" /> Pegar desde Excel
        </Button>
        <Button onClick={() => setDialogo("nuevo")}>
          <Plus className="size-4" /> Nuevo conjunto
        </Button>
      </div>

      <TablaSimple
        cols="grid-cols-[minmax(190px,1.1fr)_minmax(230px,1.5fr)_90px_130px_90px_128px]"
        columnas={columnas}
        datos={visibles}
        filaKey={(c) => c.id}
        minW="min-w-[1000px]"
        vacio={
          busqueda.trim()
            ? `Ningún conjunto coincide con «${busqueda.trim()}».`
            : "Sin conjuntos. Un conjunto es un SKU que se arma con otras piezas —cinturón + muñequeras + straps— y se vende como uno solo. Pega la hoja de CONJUNTOS para cargarlos de una vez."
        }
        onRowClick={setDialogo}
      />

      {dialogo && (
        <DialogoConjunto
          conjunto={dialogo === "nuevo" ? null : dialogo}
          productos={productos}
          onClose={() => setDialogo(null)}
        />
      )}
      {armando && (
        <DialogoArmar
          conjunto={armando}
          productos={productos}
          armados={armados.filter((a) => a.conjunto_id === armando.id)}
          equipo={equipo}
          onClose={() => setArmando(null)}
        />
      )}
      {ligando && (
        <DialogoLigarComponentes
          conjuntos={conjuntos}
          productos={productos}
          onClose={() => setLigando(false)}
        />
      )}
      {importando && (
        <DialogoImportarConjuntos productos={productos} onClose={() => setImportando(false)} />
      )}
    </div>
  );
}

/* --- La ficha, desde la propia tabla -------------------------------------- */

/* Ligar un conjunto a su ficha es UN dato, así que se resuelve donde se ve el
   hueco y no abriendo el formulario entero (que además es lo que ya hace picar
   la fila). Se guarda al elegir: no hay nada más que confirmar. */
function CeldaFicha({
  conjunto,
  ficha,
  productos,
}: {
  conjunto: ConjuntoConComponentes;
  ficha: ProductoLigeroFila | null;
  productos: ProductoLigeroFila[];
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [abierto, setAbierto] = useState(false);
  const [sku, setSku] = useState("");
  const [productoId, setProductoId] = useState<string | null>(null);

  if (ficha) {
    return (
      <span className="text-muted-foreground">
        <span className="font-mono text-[12.5px]">{ficha.sku}</span> · {ficha.stock}
      </span>
    );
  }

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger
        render={
          <button
            type="button"
            title="Sin ficha no hay dónde acreditar lo que se arme. Elige aquí el SKU con el que se vende este conjunto."
            className="inline-flex items-center gap-1 text-amber-600 hover:underline dark:text-amber-500"
          >
            <TriangleAlert className="size-3.5" /> Sin ficha
          </button>
        }
      />
      <PopoverContent className="w-80">
        <div className="flex flex-col gap-2">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            ¿Con qué SKU se vende <span className="font-mono">{conjunto.sku}</span>? Ahí se acredita
            lo que armes. Si todavía no existe en el catálogo, primero hay que crearlo en Inventario.
          </p>
          <SelectorProducto
            valor={sku}
            productoId={productoId}
            productos={productos}
            autoFocus
            placeholder="SKU o nombre del conjunto…"
            onCambio={(valor, id) => {
              setSku(valor);
              setProductoId(id);
            }}
          />
          <Button
            size="sm"
            disabled={pending || !productoId}
            onClick={() =>
              ejecutar(() => ligarFichaConjunto(conjunto.id, productoId), {
                ok: `${conjunto.sku} quedó ligado a su ficha.`,
                error: "No se pudo ligar. Revisa tu conexión.",
                alExito: () => setAbierto(false),
              })
            }
          >
            {pending ? "Ligando…" : "Ligar ficha"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
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
  const [productoId, setProductoId] = useState<string | null>(conjunto?.producto_id ?? null);
  const [skuFicha, setSkuFicha] = useState(
    () => productos.find((p) => p.id === conjunto?.producto_id)?.sku ?? "",
  );
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
      /* Si no se eligió ficha a mano, se intenta por el SKU del propio conjunto:
         es el caso normal cuando el bundle ya existe en el catálogo. */
      producto_id: productoId ?? matchProductoPorSku(sku, productos).producto?.id ?? null,
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
            <Label htmlFor="cj-ficha">Ficha en el inventario</Label>
            <SelectorProducto
              id="cj-ficha"
              valor={skuFicha}
              productoId={productoId}
              productos={productos}
              placeholder="El SKU con el que se vende el conjunto…"
              onCambio={(valor, id) => {
                setSkuFicha(valor);
                setProductoId(id);
              }}
            />
            <p className="text-[12.5px] text-muted-foreground">
              Ahí se acredita lo que se arme, y es el SKU que se publica en los canales. Sin ficha el
              conjunto se puede capturar, pero no armar.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Se arma con</Label>
            {componentes.map((c, idx) => (
              /* items-start, no center: el selector crece hacia abajo con la
                 línea de la ficha ligada y arrastraría a los demás campos. */
              <div key={idx} className="flex items-start gap-2">
                <span className="mt-2 w-24 shrink-0 text-[12.5px] text-muted-foreground">
                  {ROLES_COMPONENTE.find((r) => r.id === c.rol)?.nombre ?? "Componente"}
                </span>
                <SelectorProducto
                  valor={c.sku_componente}
                  productoId={c.producto_id}
                  productos={productos}
                  placeholder="SKU o nombre del producto…"
                  onCambio={(sku, productoId) =>
                    editar(idx, { sku_componente: sku, producto_id: productoId })
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
          /* La hoja no trae la ficha del bundle; se resuelve por su SKU si ya
             existe en el catálogo, y si no queda pendiente de ligar. */
          producto_id: matchProductoPorSku(sku, productos).producto?.id ?? null,
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
