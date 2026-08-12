"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, ClipboardPaste, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Campo } from "@/components/compartido/campo";
import { Pastilla } from "@/components/compartido/pastilla";
import { BarraHerramientas } from "@/components/compartido/barra-herramientas";
import { CampoBusqueda } from "@/components/compartido/campo-busqueda";
import { Resaltado } from "@/components/compartido/resaltado";
import { SelectorProducto } from "@/components/compartido/selector-producto";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  actualizarItemRecepcion,
  agregarItemRecepcion,
  cambiarEstadoItem,
  cerrarRecepcion,
  descontarChecados,
  guardarRecepcion,
  importarItemsRecepcion,
  borrarItemRecepcion,
  borrarRecepcion,
  type RecepcionItemInput,
} from "@/app/(app)/bodega/actions";
import { ESTADOS_RECEPCION, obtenerEstadoRecepcion, obtenerCanal } from "@/lib/catalogos";
import { coincide, terminosBusqueda } from "@/lib/busqueda";
import { matchProductoPorSku, norm, normalizarSku, parsearCantidad, parsearTSV } from "@/lib/importar/tsv";
import { tallaDeVariante } from "@/lib/talla";
import { formatearFecha } from "@/lib/fecha";
import { cn } from "@/lib/utils";
import type { ProductoLigeroFila } from "@/app/(app)/bodega/page";
import type { EstadoRecepcionId, RecepcionConItems, RecepcionItem } from "@/lib/types";

const ENCABEZADOS = [
  "SKU",
  "UNIDADES NO PROCESADAS",
  "SKU CONSOLIDADO",
  "CANTIDAD CONSOLIDADA",
  "CATEGORIA",
  "PRODUCTO",
  "TALLA",
];

/* Las cuatro de los cinturones, que es casi todo lo que entra por bodega. Es un
   datalist, no una lista cerrada: hay mercancía que viene por número. */
const TALLAS_SUGERIDAS = ["CH", "M", "G", "EG"];

/* Recepción de mercancía: la carga abierta con sus renglones, tal como la
   plantilla del Sheet, pero con los estados como botones en vez de fórmulas. */
export function SeccionRecepcion({
  recepciones,
  productos,
}: {
  recepciones: RecepcionConItems[];
  productos: ProductoLigeroFila[];
}) {
  const { pending, ejecutar } = useAccionServidor();
  /* Una carga abierta a la vez, como los envíos full. Antes era un <Select> que
     enseñaba una sola carga y escondía cuántas hay y cuáles siguen abiertas —que
     es justo lo que dice la tarjeta «Cargas abiertas» de arriba—, y además no
     daba dónde colapsar al cerrar. */
  const [abiertoId, setAbiertoId] = useState<string | null>(recepciones[0]?.id ?? null);
  const [dialogoCarga, setDialogoCarga] = useState<RecepcionConItems | "nueva" | null>(null);
  const [importandoEn, setImportandoEn] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  /* Índice de búsqueda por carga, armado UNA vez por cambio de datos: se listan
     hasta 50 cargas y una sola pasa de mil renglones, así que rehacer ese
     recorrido en cada tecla se siente en el teléfono. */
  const indice = useMemo(() => {
    const nombres = new Map(productos.map((p) => [p.id, p.nombre]));
    const mapa = new Map<string, string>();
    for (const r of recepciones) {
      const partes: string[] = [r.titulo];
      for (const i of r.items) {
        partes.push(
          i.sku,
          i.sku_consolidado ?? "",
          (i.producto_id ? nombres.get(i.producto_id) : null) ?? i.producto_nombre ?? "",
          i.talla ?? "",
          i.categoria ?? "",
        );
      }
      mapa.set(r.id, norm(partes.join(" ")));
    }
    return mapa;
  }, [recepciones, productos]);

  const terminos = terminosBusqueda(busqueda);
  const visibles = terminos.length
    ? recepciones.filter((r) => {
        const texto = indice.get(r.id) ?? "";
        return terminos.every((t) => texto.includes(t));
      })
    : recepciones;

  if (!recepciones.length) {
    return (
      <div className="rounded-2xl border bg-card p-10 text-center shadow-sm">
        <p className="text-[15px] font-semibold">Todavía no hay ninguna carga registrada.</p>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Una carga es la mercancía que llega y se va cargando al sistema, con sus estados
          Traer → Cargado → Checado → Descontado.
        </p>
        <Button className="mt-4" onClick={() => setDialogoCarga("nueva")}>
          <Plus className="size-4" /> Nueva carga
        </Button>
        {dialogoCarga && <DialogoCarga carga={null} onClose={() => setDialogoCarga(null)} />}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Buscar un SKU es lo que más se hace aquí, y desde el teléfono. Ahora
          además dice en QUÉ carga está: el buscador recorta la lista de cargas
          (mirando sus renglones) y, dentro de la que se abra, sus renglones. */}
      <BarraHerramientas className="mb-0">
        <CampoBusqueda
          valor={busqueda}
          onCambio={setBusqueda}
          placeholder="Buscar SKU, producto o talla…"
          conteo={{ visibles: visibles.length, total: recepciones.length, unidad: "cargas" }}
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex-1" />
          <Button onClick={() => setDialogoCarga("nueva")}>
            <Plus className="size-4" /> Nueva carga
          </Button>
        </div>
      </BarraHerramientas>

      {visibles.length === 0 && (
        <div className="rounded-2xl border bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          Ninguna carga contiene «{busqueda.trim()}».
        </div>
      )}

      {visibles.map((carga) => (
        <DetalleCarga
          key={carga.id}
          carga={carga}
          productos={productos}
          abierta={abiertoId === carga.id}
          onAlternar={() => setAbiertoId(abiertoId === carga.id ? null : carga.id)}
          busqueda={busqueda}
          onLimpiarBusqueda={() => setBusqueda("")}
          pending={pending}
          onEditarCarga={() => setDialogoCarga(carga)}
          onPegarRenglones={() => setImportandoEn(carga.id)}
          onCambiarEstado={(item, estado) =>
            ejecutar(() => cambiarEstadoItem(item.id, estado), {
              ok:
                estado === "descontado"
                  ? `${item.sku}: ${item.unidades_no_procesadas} al stock.`
                  : undefined,
              error: "No se pudo mover el renglón. Revisa tu conexión.",
            })
          }
          onBorrarItem={(item) =>
            ejecutar(() => borrarItemRecepcion(item.id), {
              confirmar: `¿Quitar ${item.sku} de la carga?`,
              ok: "Renglón quitado de la carga.",
            })
          }
          onDescontarChecados={() =>
            ejecutar(() => descontarChecados(carga.id), {
              confirmar: "Se van a sumar al stock todos los renglones checados. ¿Seguir?",
              error: "No se pudo descontar. Revisa tu conexión.",
              alExito: (r) => {
                const datos = "datos" in r ? r.datos : { descontados: 0 };
                toast.success(
                  datos.descontados === 0
                    ? "No había renglones checados."
                    : `${datos.descontados} ${datos.descontados === 1 ? "renglón descontado" : "renglones descontados"}.`,
                );
              },
            })
          }
          onCerrar={() =>
            ejecutar(() => cerrarRecepcion(carga.id, carga.estado === "abierta"), {
              ok: carga.estado === "abierta" ? "Carga cerrada." : "Carga reabierta.",
              /* Cerrar una carga es decir «con ésta ya terminé», así que se
                 pliega y deja ver el resto. Al reabrir NO se toca: si alguien la
                 reabre es justamente para volver a meterle mano.
                 Va en alExito y no junto a la acción porque `revalidar()` vuelve
                 a pintar desde el servidor sin tocar el estado del cliente. */
              alExito: () => {
                if (carga.estado === "abierta") setAbiertoId(null);
              },
            })
          }
          onBorrarCarga={() =>
            ejecutar(() => borrarRecepcion(carga.id), {
              confirmar: `¿Borrar la carga «${carga.titulo}» y todos sus renglones?`,
              ok: "Carga borrada.",
              alExito: () => setAbiertoId(null),
            })
          }
        />
      ))}

      {dialogoCarga && (
        <DialogoCarga
          carga={dialogoCarga === "nueva" ? null : dialogoCarga}
          onClose={() => setDialogoCarga(null)}
        />
      )}
      {importandoEn && (
        <DialogoImportarRenglones
          recepcionId={importandoEn}
          productos={productos}
          onClose={() => setImportandoEn(null)}
        />
      )}
    </div>
  );
}

/* --- Una carga: cabecera plegable + avance por estado + tabla de renglones -- */
function DetalleCarga({
  carga,
  productos,
  abierta,
  onAlternar,
  busqueda,
  onLimpiarBusqueda,
  pending,
  onEditarCarga,
  onPegarRenglones,
  onCambiarEstado,
  onBorrarItem,
  onDescontarChecados,
  onCerrar,
  onBorrarCarga,
}: {
  carga: RecepcionConItems;
  productos: ProductoLigeroFila[];
  abierta: boolean;
  onAlternar: () => void;
  busqueda: string;
  onLimpiarBusqueda: () => void;
  pending: boolean;
  onEditarCarga: () => void;
  onPegarRenglones: () => void;
  onCambiarEstado: (item: RecepcionItem, estado: EstadoRecepcionId) => void;
  onBorrarItem: (item: RecepcionItem) => void;
  onDescontarChecados: () => void;
  onCerrar: () => void;
  onBorrarCarga: () => void;
}) {
  /* null = cerrado; objeto = corrigiendo ese renglón. */
  const [renglonEnEdicion, setRenglonEnEdicion] = useState<RecepcionItem | null>(null);
  /* La CANTIDAD CONSOLIDADA de la hoja: suma de unidades por SKU consolidado.
     Se deriva aquí en vez de guardarse para que no pueda descuadrarse. */
  const consolidado = useMemo(() => {
    const mapa = new Map<string, number>();
    for (const i of carga.items) {
      const clave = i.sku_consolidado || i.sku;
      mapa.set(clave, (mapa.get(clave) ?? 0) + i.unidades_no_procesadas);
    }
    return mapa;
  }, [carga.items]);

  const porEstado = ESTADOS_RECEPCION.map((e) => ({
    ...e,
    n: carga.items.filter((i) => i.estado === e.id).length,
  }));
  const canal = obtenerCanal(carga.canal);

  /* Por id y no recorriendo el catálogo por renglón: una carga pasa de mil
     renglones y el catálogo de mil fichas, y el nombre se pide dos veces por
     renglón (al buscar y al pintarlo). */
  const nombresPorId = useMemo(() => new Map(productos.map((p) => [p.id, p.nombre])), [productos]);
  const nombreProducto = (i: RecepcionItem) =>
    (i.producto_id ? nombresPorId.get(i.producto_id) : null) ?? i.producto_nombre ?? "—";

  /* La búsqueda recorta lo que se PINTA, no la carga: el avance por estado y la
     cantidad consolidada siguen contando los renglones completos, que es lo que
     dice si la carga ya está lista. */
  const terminos = terminosBusqueda(busqueda);
  const visibles = carga.items.filter((i) =>
    coincide(
      terminos,
      i.sku,
      i.sku_consolidado,
      nombreProducto(i),
      i.producto_nombre,
      i.talla,
      i.categoria,
    ),
  );

  return (
    <div className="rounded-2xl border bg-card shadow-sm">
      {/* La cabecera ES el disparador del acordeón, así que los botones de
          acción bajan al cuerpo: un <button> dentro de otro es HTML inválido y
          el clic deja de responder donde se solapan. */}
      <button
        type="button"
        onClick={onAlternar}
        aria-expanded={abierta}
        className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left"
      >
        <ChevronDown
          className={cn("size-4 shrink-0 text-muted-foreground transition-transform", !abierta && "-rotate-90")}
          strokeWidth={2}
          aria-hidden="true"
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-[16px] font-bold">{carga.titulo}</h2>
            {canal && <Pastilla nombre={canal.nombre} color={canal.color} />}
            {carga.estado === "cerrada" && <Pastilla nombre="Cerrada" color="#94a3b8" />}
          </div>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">
            {busqueda.trim() && abierta
              ? `${visibles.length} de ${carga.items.length} renglones`
              : `${carga.items.length} ${carga.items.length === 1 ? "renglón" : "renglones"}`}{" "}
            · {formatearFecha(carga.created_at.slice(0, 10))}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {porEstado.map((e) => (
            <Pastilla key={e.id} nombre={`${e.nombre}: ${e.n}`} color={e.color} />
          ))}
        </div>
      </button>

      {!abierta ? null : (
        <>
      <div className="flex flex-wrap gap-2 border-t px-5 py-2.5">
        <Button variant="outline" size="sm" onClick={onPegarRenglones} disabled={pending}>
          <ClipboardPaste className="size-4" /> Pegar renglones
        </Button>
        <Button variant="outline" size="sm" onClick={onEditarCarga} disabled={pending}>
          <Pencil className="size-4" /> Editar carga
        </Button>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={onDescontarChecados} disabled={pending}>
          Descontar checados
        </Button>
        <Button variant="outline" size="sm" onClick={onCerrar} disabled={pending}>
          {carga.estado === "abierta" ? "Cerrar carga" : "Reabrir"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onBorrarCarga} disabled={pending}>
          <Trash2 className="size-4" />
        </Button>
      </div>

      {carga.pedido_proveedor_id && (
        <p className="border-b bg-amber-500/10 px-5 py-2 text-[13px] text-amber-700 dark:text-amber-400">
          Esta carga viene de un pedido a proveedor. Si ese pedido ya se recibió «sumando stock», no
          lo descuentes aquí también: se contaría dos veces.
        </p>
      )}

      {carga.items.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          Sin renglones todavía. Pega la plantilla de la hoja con «Pegar renglones», o captura aquí
          abajo los que hagan falta.
        </p>
      ) : visibles.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          Ningún renglón de esta carga coincide con «{busqueda.trim()}».
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-2.5 font-semibold">SKU</th>
                <th className="px-3 py-2.5 font-semibold">Producto</th>
                <th className="px-3 py-2.5 font-semibold">Talla</th>
                <th className="px-3 py-2.5 text-right font-semibold">Unidades</th>
                <th className="px-3 py-2.5 text-right font-semibold">Consolidado</th>
                <th className="px-3 py-2.5 font-semibold">Estado</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visibles.map((i) => {
                const estado = obtenerEstadoRecepcion(i.estado);
                return (
                  <tr key={i.id} className="border-t">
                    <td className="px-5 py-2 font-mono text-[12.5px]">
                      <Resaltado texto={i.sku} busca={busqueda} />
                      {!i.producto_id && (
                        <span className="ml-1.5 text-[11px] text-amber-600">sin ficha</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Resaltado texto={nombreProducto(i)} busca={busqueda} />
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">
                      <Resaltado texto={i.talla ?? "—"} busca={busqueda} />
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{i.unidades_no_procesadas}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                      {consolidado.get(i.sku_consolidado || i.sku) ?? 0}
                    </td>
                    <td className="px-3 py-2">
                      {i.estado === "descontado" ? (
                        <Pastilla nombre={estado?.nombre ?? i.estado} color={estado?.color ?? "#94a3b8"} />
                      ) : (
                        <Select
                          value={i.estado}
                          disabled={pending}
                          onValueChange={(v) =>
                            v && v !== i.estado && onCambiarEstado(i, v as EstadoRecepcionId)
                          }
                        >
                          <SelectTrigger className="h-8 w-[140px]">
                            <SelectValue>
                              {(v: string) => obtenerEstadoRecepcion(v)?.nombre ?? "Estado"}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {ESTADOS_RECEPCION.map((e) => (
                              <SelectItem key={e.id} value={e.id}>
                                {e.nombre}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setRenglonEnEdicion(i)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Corregir ${i.sku}`}
                          title="Corregir este renglón"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onBorrarItem(i)}
                          className="text-muted-foreground hover:text-destructive"
                          aria-label="Quitar renglón"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <AltaRenglon
        carga={carga}
        productos={productos}
        onAgregado={(fila) => {
          /* Si el filtro puesto esconde justo lo que se acaba de capturar, se
             quita: agregar un renglón y no verlo aparecer se lee como que no se
             guardó. Mientras el nuevo sí coincida, la búsqueda se respeta. */
          if (!coincide(terminos, fila.sku, fila.talla, fila.producto_nombre)) onLimpiarBusqueda();
        }}
      />

      {renglonEnEdicion && (
        <DialogoRenglon
          carga={carga}
          item={renglonEnEdicion}
          productos={productos}
          onClose={() => setRenglonEnEdicion(null)}
        />
      )}
        </>
      )}
    </div>
  );
}

/* --- Lo que un renglón capturado a mano deriva solo ------------------------
   Lo comparten el alta y la corrección para que un renglón editado quede
   idéntico a uno recién capturado (y a uno pegado, que normaliza igual del lado
   del servidor con `filaRecepcion`). */
function derivarRenglon(
  carga: RecepcionConItems,
  productos: ProductoLigeroFila[],
  campos: { sku: string; productoId: string | null; talla: string; unidades: number },
): RecepcionItemInput {
  const limpio = campos.sku.trim().toUpperCase();
  const t = campos.talla.trim().toUpperCase();

  /* El SKU de la hoja es base + talla (SBD002 + CH), y la columna «Consolidado»
     suma por esa base. Se deriva quitando la talla del final en vez de pedir
     otro campo: es lo que se haría a mano, siempre igual. */
  const consolidado =
    t && normalizarSku(limpio).endsWith(normalizarSku(t)) && limpio.length > t.length
      ? limpio.slice(0, limpio.length - t.length)
      : null;

  /* La categoría (POWERLIFT, HEBILLA…) no se captura: se hereda del hermano que
     ya esté en la carga, que es de donde salió al pegar la hoja. */
  const hermano = consolidado
    ? carga.items.find((i) => (i.sku_consolidado || i.sku) === consolidado)
    : undefined;
  const producto = productos.find((p) => p.id === campos.productoId);

  return {
    sku: limpio,
    producto_id: campos.productoId ?? matchProductoPorSku(limpio, productos).producto?.id ?? null,
    unidades_no_procesadas: Math.trunc(campos.unidades),
    sku_consolidado: consolidado,
    categoria: hermano?.categoria ?? null,
    producto_nombre: producto?.nombre ?? hermano?.producto_nombre ?? null,
    talla: t || null,
  };
}

/* --- Capturar un renglón a mano -------------------------------------------
   El pegado cubre la carga completa, pero no todo llega por la hoja: un SKU que
   no venía en la plantilla, unas piezas que mandó el proveedor de más, o una
   carga chica que no vale un Excel. El SKU se elige del catálogo mientras se
   escribe —así el renglón nace ligado a su ficha y al descontarlo sí mueve
   stock—, aunque se acepta texto libre: hay mercancía que todavía no tiene
   ficha, y eso la pantalla ya lo marca como «sin ficha». */
function AltaRenglon({
  carga,
  productos,
  onAgregado,
}: {
  carga: RecepcionConItems;
  productos: ProductoLigeroFila[];
  onAgregado: (fila: RecepcionItemInput) => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const idTallas = useId();
  /* Remonta el selector para devolverle el foco tras cada alta: en el piso se
     capturan varios seguidos. En el primer montaje no, que robaría el foco al
     abrir la pantalla. */
  const [llave, setLlave] = useState(0);
  const [sku, setSku] = useState("");
  const [productoId, setProductoId] = useState<string | null>(null);
  const [talla, setTalla] = useState("");
  const [unidades, setUnidades] = useState("1");

  const cantidad = Number(unidades);
  const listo = sku.trim() !== "" && Number.isFinite(cantidad) && cantidad > 0;

  function agregar() {
    if (!listo) return;
    const fila = derivarRenglon(carga, productos, {
      sku,
      productoId,
      talla,
      unidades: cantidad,
    });

    ejecutar(() => agregarItemRecepcion(carga.id, fila), {
      ok: `${fila.sku}: ${fila.unidades_no_procesadas} al renglón de la carga.`,
      error: "No se pudo agregar el renglón. Revisa tu conexión.",
      alExito: () => {
        setSku("");
        setProductoId(null);
        setTalla("");
        setUnidades("1");
        setLlave((n) => n + 1);
        onAgregado(fila);
      },
    });
  }

  return (
    <div className="flex flex-wrap items-start gap-2 border-t px-5 py-3">
      <SelectorProducto
        key={llave}
        valor={sku}
        productoId={productoId}
        productos={productos}
        autoFocus={llave > 0}
        className="min-w-[200px] basis-[260px]"
        placeholder="SKU o nombre del producto…"
        onCambio={(nuevoSku, id) => {
          setSku(nuevoSku);
          setProductoId(id);
          /* Al elegir del catálogo, la talla ya viene en la variante de la
             ficha («Rosa / M»): se rellena sola si no se escribió otra. */
          if (id && !talla.trim()) {
            const elegido = productos.find((p) => p.id === id);
            setTalla(tallaDeVariante(elegido?.variante) ?? "");
          }
        }}
      />
      <Input
        list={idTallas}
        aria-label="Talla"
        placeholder="Talla"
        className="w-[88px] uppercase"
        value={talla}
        onChange={(e) => setTalla(e.target.value.toUpperCase())}
      />
      <datalist id={idTallas}>
        {TALLAS_SUGERIDAS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>
      <Input
        type="number"
        min="1"
        step="1"
        aria-label="Unidades"
        className="w-[88px]"
        value={unidades}
        onChange={(e) => setUnidades(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            agregar();
          }
        }}
      />
      <Button variant="outline" disabled={pending || !listo} onClick={agregar}>
        <Plus className="size-4" /> {pending ? "Agregando…" : "Agregar renglón"}
      </Button>
    </div>
  );
}

/* --- Corregir un renglón ya capturado --------------------------------------
   Va en diálogo y no editando la fila en su sitio: la tabla es ancha (860 px con
   scroll horizontal) y esto se usa desde el teléfono, donde editar dentro de la
   fila es pelearse con el scroll. Tampoco sirve reusar el alta de abajo: con
   doscientos renglones estarías corrigiendo el de arriba mirando un formulario
   que está al final de la lista. */
function DialogoRenglon({
  carga,
  item,
  productos,
  onClose,
}: {
  carga: RecepcionConItems;
  item: RecepcionItem;
  productos: ProductoLigeroFila[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const idTallas = useId();
  const [sku, setSku] = useState(item.sku);
  const [productoId, setProductoId] = useState<string | null>(item.producto_id);
  const [talla, setTalla] = useState(item.talla ?? "");
  const [unidades, setUnidades] = useState(String(item.unidades_no_procesadas));

  /* Ya descontado = sus unidades YA se sumaron a products.stock y quedaron
     firmadas en el ledger. Cambiarlas aquí no deshace esa suma, así que los dos
     campos que mueven inventario se bloquean —lo descriptivo sí se corrige—. El
     mismo candado está en la server action, que es el que de verdad cuenta. */
  const descontado = item.estado === "descontado";
  const cantidad = Number(unidades);
  const listo = sku.trim() !== "" && Number.isFinite(cantidad) && cantidad > 0;

  function guardar() {
    if (!listo) return;
    ejecutar(
      () =>
        actualizarItemRecepcion(
          item.id,
          derivarRenglon(carga, productos, { sku, productoId, talla, unidades: cantidad }),
        ),
      {
        ok: "Renglón corregido.",
        error: "No se pudo guardar el renglón. Revisa tu conexión.",
        alExito: onClose,
      },
    );
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Corregir renglón</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {descontado && (
            <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
              Este renglón ya se descontó: sus {item.unidades_no_procesadas} unidades ya se sumaron
              al stock. Cambiarlas aquí no lo corregiría —hay que ajustar el stock desde
              Inventario—, así que el producto y las unidades quedan fijos. La talla y el SKU sí se
              pueden corregir.
            </p>
          )}
          <Campo
            etiqueta="SKU"
            htmlFor={descontado ? "renglon-sku" : undefined}
            ayuda={
              descontado
                ? "Se corrige el texto; la ficha a la que ya se le sumó el stock no cambia."
                : "Elige del catálogo para que al descontarlo mueva stock."
            }
          >
            {descontado ? (
              /* Sin selector de ficha: elegir otra no movería nada —el stock ya
                 se sumó a la de antes— y ofrecerlo haría creer lo contrario. */
              <Input
                id="renglon-sku"
                className="font-mono uppercase"
                value={sku}
                onChange={(e) => setSku(e.target.value.toUpperCase())}
              />
            ) : (
              <SelectorProducto
                valor={sku}
                productoId={productoId}
                productos={productos}
                placeholder="SKU o nombre del producto…"
                onCambio={(nuevoSku, id) => {
                  setSku(nuevoSku);
                  setProductoId(id);
                  if (id && !talla.trim()) {
                    const elegido = productos.find((p) => p.id === id);
                    setTalla(tallaDeVariante(elegido?.variante) ?? "");
                  }
                }}
              />
            )}
          </Campo>
          <div className="flex gap-3">
            <Campo etiqueta="Talla" htmlFor="renglon-talla" className="flex-1">
              <Input
                id="renglon-talla"
                list={idTallas}
                className="uppercase"
                value={talla}
                onChange={(e) => setTalla(e.target.value.toUpperCase())}
              />
              <datalist id={idTallas}>
                {TALLAS_SUGERIDAS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Campo>
            <Campo etiqueta="Unidades" htmlFor="renglon-unidades" className="flex-1">
              <Input
                id="renglon-unidades"
                type="number"
                min="1"
                step="1"
                disabled={descontado}
                value={unidades}
                onChange={(e) => setUnidades(e.target.value)}
              />
            </Campo>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button disabled={pending || !listo} onClick={guardar}>
            {pending ? "Guardando…" : "Guardar cambios"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --- Alta y edición de una carga ------------------------------------------ */
function DialogoCarga({
  carga,
  onClose,
}: {
  carga: RecepcionConItems | null;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState(carga?.titulo ?? "");
  const [canal, setCanal] = useState<"tienda_nube" | "mercado_libre">(
    (carga?.canal as "tienda_nube" | "mercado_libre") ?? "tienda_nube",
  );
  const [notas, setNotas] = useState(carga?.notas ?? "");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{carga ? "Editar carga" : "Nueva carga"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <Campo etiqueta="Nombre" htmlFor="carga-titulo">
            <Input
              id="carga-titulo"
              autoFocus
              placeholder="Carga 04/08 playeras"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Plantilla">
            <Select value={canal} onValueChange={(v) => v && setCanal(v as typeof canal)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => (v === "mercado_libre" ? "Mercado Libre" : "Tienda Nube")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tienda_nube">Tienda Nube</SelectItem>
                <SelectItem value="mercado_libre">Mercado Libre</SelectItem>
              </SelectContent>
            </Select>
          </Campo>
          <Campo etiqueta="Notas" htmlFor="carga-notas">
            <Textarea
              id="carga-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </Campo>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              ejecutar(
                () =>
                  guardarRecepcion(carga?.id ?? null, {
                    titulo,
                    canal,
                    /* Se arrastra tal cual: el diálogo no lo captura, pero la
                       acción escribe la columna siempre. Mandar null al editar
                       desligaría la carga de su pedido a proveedor sin decirlo,
                       y con ello se iría el aviso de no contar el stock dos
                       veces. */
                    pedido_proveedor_id: carga?.pedido_proveedor_id ?? null,
                    notas,
                  }),
                {
                  ok: carga ? "Carga actualizada." : "Carga creada.",
                  error: "No se pudo guardar. Revisa tu conexión.",
                  alExito: onClose,
                },
              )
            }
          >
            {pending ? "Guardando…" : carga ? "Guardar cambios" : "Crear carga"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* Renglón pegado, con el diagnóstico del emparejamiento para pintarlo. */
type FilaRecepcionPreview = {
  input: RecepcionItemInput;
  tipo: "exacto" | "parcial" | "ambiguo" | "ninguno";
};

/* --- Pegar la plantilla de la hoja ---------------------------------------- */
function DialogoImportarRenglones({
  recepcionId,
  productos,
  onClose,
}: {
  recepcionId: string;
  productos: ProductoLigeroFila[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [texto, setTexto] = useState("");

  const filas = useMemo<FilaRecepcionPreview[]>(() => {
    return parsearTSV(texto, ENCABEZADOS)
      .map((celdas): FilaRecepcionPreview | null => {
        const [
          sku = "",
          unidades = "",
          consolidado = "",
          ,
          categoria = "",
          producto = "",
          talla = "",
        ] = celdas;
        if (!sku.trim()) return null;
        const match = matchProductoPorSku(sku, productos);
        const input: RecepcionItemInput = {
          sku: sku.trim(),
          producto_id: match.tipo === "exacto" ? (match.producto?.id ?? null) : null,
          unidades_no_procesadas: parsearCantidad(unidades) ?? 0,
          sku_consolidado: consolidado.trim() || null,
          categoria: categoria.trim() || null,
          producto_nombre: producto.trim() || match.producto?.nombre || null,
          talla: talla.trim() || null,
        };
        return { input, tipo: match.tipo };
      })
      .filter((f): f is FilaRecepcionPreview => f !== null);
  }, [texto, productos]);

  const sinFicha = filas.filter((f) => f.tipo !== "exacto").length;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pegar renglones de la carga</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Copia la plantilla de la hoja con sus columnas:{" "}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">
              SKU · UNIDADES NO PROCESADAS · SKU CONSOLIDADO · CANTIDAD CONSOLIDADA · CATEGORIA ·
              PRODUCTO · TALLA
            </code>
            . La cantidad consolidada se recalcula sola, no hace falta que cuadre.
          </p>

          <Textarea
            rows={7}
            autoFocus
            className="font-mono text-[12.5px]"
            placeholder={"PLY001G\t20\tPLY001\t60\tRopa\tPlayera Olimpo\tG"}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />

          {sinFicha > 0 && (
            <p className="text-[13px] text-amber-600">
              {sinFicha} {sinFicha === 1 ? "renglón no coincide" : "renglones no coinciden"} con
              ningún SKU del catálogo: se registran igual, pero al descontarlos no se moverá stock
              (no hay ficha a la que sumarle).
            </p>
          )}

          {filas.length > 0 && (
            <div className="max-h-[320px] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted/60 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-semibold">SKU</th>
                    <th className="px-3 py-2 font-semibold">Producto</th>
                    <th className="px-3 py-2 font-semibold">Talla</th>
                    <th className="px-3 py-2 text-right font-semibold">Unidades</th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f, i) => (
                    <tr key={i} className="border-t">
                      <td className={cn("px-3 py-1.5 font-mono text-[12.5px]", f.tipo !== "exacto" && "text-amber-600")}>
                        {f.input.sku}
                      </td>
                      <td className="px-3 py-1.5">{f.input.producto_nombre ?? "—"}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">{f.input.talla ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">
                        {f.input.unidades_no_procesadas}
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
              ejecutar(() => importarItemsRecepcion(recepcionId, filas.map((f) => f.input)), {
                error: "No se pudo importar. Revisa tu conexión.",
                alExito: (r) => {
                  const datos = "datos" in r ? r.datos : { creados: 0 };
                  toast.success(`${datos.creados} renglones agregados a la carga.`);
                  onClose();
                },
              })
            }
          >
            {pending ? "Importando…" : `Agregar ${filas.length || ""} renglones`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
