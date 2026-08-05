"use client";

import { useState } from "react";
import { ExternalLink, KeyRound, Lock, Plus, Trash2 } from "lucide-react";
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
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TablaSimple, type Columna } from "@/components/compartido/tabla-simple";
import { Pastilla } from "@/components/compartido/pastilla";
import { ControlSegmentado } from "@/components/compartido/control-segmentado";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { ImportarInsumos } from "@/components/bodega/importar-insumos";
import {
  borrarInsumo,
  cambiarPermisoInsumos,
  guardarInsumo,
  moverInsumo,
  type PresentacionInput,
} from "@/app/(app)/inventario/bodega/actions";
import { CATEGORIAS_INSUMO, obtenerCategoriaInsumo, puedeAdministrar } from "@/lib/catalogos";
import { formatearFechaHora } from "@/lib/fecha";
import { formatearMXN } from "@/lib/moneda";
import type {
  CategoriaInsumoId,
  InsumoConPresentaciones,
  InsumoMovimiento,
  InsumoPermiso,
  Profile,
} from "@/lib/types";

const TIPOS_MOVIMIENTO = [
  ["entrada", "Entrada"],
  ["salida", "Salida"],
  ["ajuste", "Ajuste"],
] as const;

type TipoMovimiento = (typeof TIPOS_MOVIMIENTO)[number][0];

const SIN_VALOR = "sin_valor";

/* Lo que cuesta cada pieza según cómo se compre: es la columna PRECIO P/UNIDAD
   de la hoja, pero calculada, no capturada. Se enseña la presentación más
   barata, que es la decisión que la hoja quiere ayudar a tomar. */
export function precioUnitario(insumo: InsumoConPresentaciones): number | null {
  const precios = insumo.presentaciones
    .filter((p) => p.precio != null && p.unidades > 0)
    .map((p) => (p.precio as number) / p.unidades);
  return precios.length ? Math.min(...precios) : null;
}

/* Los insumos que se consumen en bodega, con lo que la hoja «Recursos FRESA
   FIT» sabe de ellos: de quién se compran, en qué medida y a cómo. La regla que
   pidió René sigue igual: todo el equipo VE cuánto hay (Germán tiene que poder
   mirar), pero solo quien tenga permiso mueve el stock. El botón deshabilitado
   es cortesía; el candado real está en la función mover_insumo() de la base. */
export function SeccionInsumos({
  insumos,
  movimientos,
  permisos,
  equipo,
  puedeMover,
  admin,
}: {
  insumos: InsumoConPresentaciones[];
  movimientos: InsumoMovimiento[];
  permisos: InsumoPermiso[];
  equipo: Profile[];
  puedeMover: boolean;
  admin: boolean;
}) {
  const [dialogo, setDialogo] = useState<InsumoConPresentaciones | "nuevo" | null>(null);
  const [moviendo, setMoviendo] = useState<InsumoConPresentaciones | null>(null);
  const [dialogoPermisos, setDialogoPermisos] = useState(false);
  const [filtro, setFiltro] = useState("todas");

  const nombreDe = (id: string | null) => equipo.find((p) => p.id === id)?.nombre ?? "—";

  /* El compilador de React memoiza esto solo. */
  const visibles =
    filtro === "todas" ? insumos : insumos.filter((i) => (i.categoria ?? "otro") === filtro);
  const bajos = insumos.filter((i) => i.activo && i.stock <= i.minimo).length;

  const columnas: Columna<InsumoConPresentaciones>[] = [
    {
      clave: "nombre",
      label: "Insumo",
      esTitulo: true,
      celda: (i) => (
        <div className="min-w-0">
          <div className="truncate font-semibold">{i.nombre}</div>
          <div className="truncate text-[12.5px] text-muted-foreground">
            {[i.empresa, i.dimensiones].filter(Boolean).join(" · ") || "—"}
          </div>
        </div>
      ),
    },
    {
      clave: "categoria",
      label: "Sección",
      celda: (i) => {
        const cat = obtenerCategoriaInsumo(i.categoria);
        return cat ? (
          <Pastilla nombre={cat.nombre} color={cat.color} />
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      clave: "stock",
      label: "Hay",
      celda: (i) => (
        <div className="min-w-0">
          <div
            className={
              i.stock <= i.minimo ? "font-semibold tabular-nums text-red-600" : "tabular-nums"
            }
          >
            {i.stock} {i.unidad}
          </div>
          {(i.reserva > 0 || i.pedido > 0) && (
            <div className="text-[11.5px] text-muted-foreground">
              {i.reserva > 0 && `${i.reserva} apartado`}
              {i.reserva > 0 && i.pedido > 0 && " · "}
              {i.pedido > 0 && `${i.pedido} en camino`}
            </div>
          )}
        </div>
      ),
    },
    {
      clave: "rango",
      label: "Mín · máx",
      celda: (i) => (
        <span className="tabular-nums text-muted-foreground">
          {i.minimo}
          {i.maximo != null ? ` · ${i.maximo}` : ""}
        </span>
      ),
    },
    {
      clave: "precio",
      label: "Por unidad",
      celda: (i) => {
        const precio = precioUnitario(i);
        if (precio == null) return <span className="text-muted-foreground">—</span>;
        return (
          <div className="min-w-0">
            <div className="tabular-nums">{formatearMXN(precio)}</div>
            <div className="text-[11.5px] text-muted-foreground">
              {i.presentaciones.length}{" "}
              {i.presentaciones.length === 1 ? "presentación" : "presentaciones"}
            </div>
          </div>
        );
      },
    },
    {
      clave: "estado",
      label: "",
      celda: (i) =>
        !i.activo ? (
          <Pastilla nombre="Inactivo" color="#94a3b8" />
        ) : i.stock <= i.minimo ? (
          <Pastilla nombre="Por acabarse" color="#d63031" />
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      clave: "acciones",
      label: "",
      celda: (i) => (
        <div className="flex items-center gap-1.5">
          {i.link && (
            <a
              href={i.link}
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-primary"
              aria-label="Dónde se compra"
            >
              <ExternalLink className="size-4" />
            </a>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={!puedeMover}
            title={puedeMover ? undefined : "No tienes permiso para mover insumos"}
            onClick={() => setMoviendo(i)}
          >
            {puedeMover ? "Mover" : <Lock className="size-3.5" />}
          </Button>
          {admin && (
            <Button variant="ghost" size="sm" onClick={() => setDialogo(i)}>
              Editar
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={filtro} onValueChange={(v) => setFiltro(v ?? "todas")}>
          <SelectTrigger className="w-[210px] bg-card">
            <SelectValue>
              {(v: string) =>
                v === "todas"
                  ? "Todas las secciones"
                  : (obtenerCategoriaInsumo(v)?.nombre ?? "Sección")
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="todas">Todas las secciones</SelectItem>
            {CATEGORIAS_INSUMO.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.nombre}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[13.5px] text-muted-foreground">
          {puedeMover
            ? "Puedes registrar entradas y salidas."
            : "Puedes consultar el inventario; para descontar necesitas permiso de dirección."}
        </p>
        {bajos > 0 && <Pastilla nombre={`${bajos} por acabarse`} color="#d63031" />}
        <div className="flex-1" />
        {admin && (
          <>
            <ImportarInsumos />
            <Button variant="outline" onClick={() => setDialogoPermisos(true)}>
              <KeyRound className="size-4" /> Quién descuenta
            </Button>
            <Button onClick={() => setDialogo("nuevo")}>
              <Plus className="size-4" /> Nuevo insumo
            </Button>
          </>
        )}
      </div>

      <TablaSimple
        cols="grid-cols-[minmax(200px,2fr)_180px_130px_100px_130px_130px_170px]"
        columnas={columnas}
        datos={visibles}
        filaKey={(i) => i.id}
        minW="min-w-[1080px]"
        vacio={
          admin
            ? "Sin insumos en esta sección. Da de alta lo que se consume en bodega o pega el bloque de la hoja de recursos."
            : "Sin insumos dados de alta todavía."
        }
      />

      {movimientos.length > 0 && (
        <div className="rounded-2xl border bg-card shadow-sm">
          <div className="border-b px-5 py-3 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Últimos movimientos
          </div>
          <div className="divide-y">
            {movimientos.slice(0, 20).map((m) => {
              const insumo = insumos.find((i) => i.id === m.insumo_id);
              return (
                <div key={m.id} className="flex flex-wrap items-center gap-2 px-5 py-2 text-sm">
                  <span className="w-[130px] shrink-0 text-[12.5px] text-muted-foreground">
                    {formatearFechaHora(m.created_at)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <b>{insumo?.nombre ?? "—"}</b>
                    {m.motivo && <span className="text-muted-foreground"> · {m.motivo}</span>}
                  </span>
                  <span
                    className={
                      m.tipo === "salida"
                        ? "tabular-nums font-semibold text-red-600"
                        : "tabular-nums font-semibold text-green-600"
                    }
                  >
                    {m.tipo === "salida" ? "−" : m.tipo === "entrada" ? "+" : "="}
                    {m.cantidad}
                  </span>
                  <span className="w-[110px] shrink-0 text-right text-[12.5px] text-muted-foreground">
                    quedan {m.stock_resultante ?? "—"}
                  </span>
                  <span className="w-[150px] shrink-0 truncate text-right text-[12.5px] text-muted-foreground">
                    {nombreDe(m.created_by)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {dialogo && (
        <DialogoInsumo
          insumo={dialogo === "nuevo" ? null : dialogo}
          onClose={() => setDialogo(null)}
        />
      )}
      {moviendo && <DialogoMovimiento insumo={moviendo} onClose={() => setMoviendo(null)} />}
      {dialogoPermisos && (
        <DialogoPermisos
          equipo={equipo}
          permisos={permisos}
          onClose={() => setDialogoPermisos(false)}
        />
      )}
    </div>
  );
}

/* --- Alta / edición del insumo (administrativo) --------------------------- */
type PresentacionForm = PresentacionInput & { llave: number };

function DialogoInsumo({
  insumo,
  onClose,
}: {
  insumo: InsumoConPresentaciones | null;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [nombre, setNombre] = useState(insumo?.nombre ?? "");
  const [categoria, setCategoria] = useState<CategoriaInsumoId | null>(insumo?.categoria ?? null);
  const [empresa, setEmpresa] = useState(insumo?.empresa ?? "");
  const [dimensiones, setDimensiones] = useState(insumo?.dimensiones ?? "");
  const [unidad, setUnidad] = useState(insumo?.unidad ?? "pieza");
  const [minimo, setMinimo] = useState(insumo?.minimo?.toString() ?? "0");
  const [maximo, setMaximo] = useState(insumo?.maximo?.toString() ?? "");
  const [link, setLink] = useState(insumo?.link ?? "");
  const [notas, setNotas] = useState(insumo?.notas ?? "");
  const [activo, setActivo] = useState(insumo?.activo ?? true);
  const [presentaciones, setPresentaciones] = useState<PresentacionForm[]>(() =>
    (insumo?.presentaciones ?? []).map((p, i) => ({
      llave: i,
      descripcion: p.descripcion ?? "",
      unidades: p.unidades,
      precio: p.precio,
      reserva: p.reserva,
      pedido: p.pedido,
      link: p.link ?? "",
    })),
  );

  const cambiar = (llave: number, campo: keyof PresentacionInput, valor: string) =>
    setPresentaciones((ps) =>
      ps.map((p) =>
        p.llave !== llave
          ? p
          : {
              ...p,
              [campo]:
                campo === "descripcion" || campo === "link"
                  ? valor
                  : valor === ""
                    ? campo === "precio"
                      ? null
                      : 0
                    : Number(valor),
            },
      ),
    );

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{insumo ? "Editar insumo" : "Nuevo insumo"}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="ins-nombre">Nombre</Label>
              <Input
                id="ins-nombre"
                autoFocus
                placeholder="Bolsa para cinturones, etiqueta de paquetería…"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Sección</Label>
              <Select
                value={categoria ?? SIN_VALOR}
                onValueChange={(v) =>
                  setCategoria(v === SIN_VALOR ? null : (v as CategoriaInsumoId))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === SIN_VALOR ? "Sin definir" : (obtenerCategoriaInsumo(v)?.nombre ?? "")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_VALOR}>Sin definir</SelectItem>
                  {CATEGORIAS_INSUMO.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ins-empresa">Se compra a</Label>
              <Input
                id="ins-empresa"
                placeholder="Castipack…"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ins-dim">Dimensiones</Label>
              <Input
                id="ins-dim"
                placeholder="20 x 28 cm"
                value={dimensiones}
                onChange={(e) => setDimensiones(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ins-unidad">Unidad</Label>
              <Input id="ins-unidad" value={unidad} onChange={(e) => setUnidad(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ins-link">Dónde se compra</Label>
              <Input
                id="ins-link"
                placeholder="https://…"
                value={link}
                onChange={(e) => setLink(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ins-minimo">Mínimo (avisa)</Label>
              <Input
                id="ins-minimo"
                type="number"
                min="0"
                step="1"
                value={minimo}
                onChange={(e) => setMinimo(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="ins-maximo">Máximo</Label>
              <Input
                id="ins-maximo"
                type="number"
                min="0"
                step="1"
                placeholder="sin tope"
                value={maximo}
                onChange={(e) => setMaximo(e.target.value)}
              />
            </div>
          </div>

          {/* Presentaciones: el mismo insumo se compra en varias medidas y cada
              una tiene su precio. Es la parte de la hoja que no cabía en la
              ficha original. */}
          <div className="flex flex-col gap-2 rounded-xl border p-3">
            <div className="flex items-center gap-2">
              <Label className="text-[13px]">Cómo se compra</Label>
              <div className="flex-1" />
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setPresentaciones((ps) => [
                    ...ps,
                    {
                      llave: (ps.at(-1)?.llave ?? -1) + 1,
                      descripcion: "",
                      unidades: 1,
                      precio: null,
                      reserva: 0,
                      pedido: 0,
                      link: "",
                    },
                  ])
                }
              >
                <Plus className="size-3.5" /> Presentación
              </Button>
            </div>

            {presentaciones.length === 0 && (
              <p className="text-[12.5px] text-muted-foreground">
                Sin precios capturados. Agrega al menos una presentación («paquete de 100 a $164.68»)
                para que el CRM pueda calcular el precio por pieza.
              </p>
            )}

            {presentaciones.map((p) => (
              <div key={p.llave} className="grid grid-cols-2 items-end gap-2 sm:grid-cols-6">
                <div className="col-span-2 flex flex-col gap-1">
                  <span className="text-[11.5px] text-muted-foreground">Descripción</span>
                  <Input
                    className="h-9"
                    placeholder="Paquete de 100"
                    value={p.descripcion}
                    onChange={(e) => cambiar(p.llave, "descripcion", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-muted-foreground">Piezas</span>
                  <Input
                    className="h-9"
                    type="number"
                    min="1"
                    value={p.unidades}
                    onChange={(e) => cambiar(p.llave, "unidades", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-muted-foreground">Precio</span>
                  <Input
                    className="h-9"
                    type="number"
                    min="0"
                    step="0.01"
                    value={p.precio ?? ""}
                    onChange={(e) => cambiar(p.llave, "precio", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[11.5px] text-muted-foreground">Apartado</span>
                  <Input
                    className="h-9"
                    type="number"
                    min="0"
                    value={p.reserva}
                    onChange={(e) => cambiar(p.llave, "reserva", e.target.value)}
                  />
                </div>
                <div className="flex items-end gap-1">
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="text-[11.5px] text-muted-foreground">Pedido</span>
                    <Input
                      className="h-9"
                      type="number"
                      min="0"
                      value={p.pedido}
                      onChange={(e) => cambiar(p.llave, "pedido", e.target.value)}
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-9 shrink-0 text-muted-foreground hover:text-red-600"
                    aria-label="Quitar presentación"
                    onClick={() =>
                      setPresentaciones((ps) => ps.filter((x) => x.llave !== p.llave))
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ins-notas">Notas</Label>
            <Textarea
              id="ins-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={activo}
              onChange={(e) => setActivo(e.target.checked)}
              className="size-4 accent-primary"
            />
            Activo
          </label>
          {!insumo && (
            <p className="text-[12.5px] text-muted-foreground">
              El insumo nace en cero: la existencia se carga con un movimiento de entrada.
            </p>
          )}
        </div>
        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={insumo ? "Guardar cambios" : "Crear insumo"}
          onGuardar={() =>
            ejecutar(
              () =>
                guardarInsumo(insumo?.id ?? null, {
                  nombre,
                  unidad,
                  minimo: Number(minimo) || 0,
                  notas,
                  activo,
                  categoria,
                  empresa,
                  dimensiones,
                  maximo: maximo.trim() === "" ? null : Number(maximo),
                  link,
                  /* `llave` solo existe para que React distinga los renglones
                     del formulario; la acción no la necesita. */
                  presentaciones: presentaciones.map((p) => ({
                    descripcion: p.descripcion,
                    unidades: p.unidades,
                    precio: p.precio,
                    reserva: p.reserva,
                    pedido: p.pedido,
                    link: p.link,
                  })),
                }),
              {
                ok: insumo ? "Insumo actualizado." : "Insumo creado.",
                error: "No se pudo guardar. Revisa tu conexión.",
                alExito: onClose,
              },
            )
          }
          onCancelar={onClose}
          onBorrar={
            insumo
              ? () =>
                  ejecutar(() => borrarInsumo(insumo.id), {
                    confirmar: `¿Borrar «${insumo.nombre}» y su historial de movimientos?`,
                    ok: "Insumo borrado.",
                    alExito: onClose,
                  })
              : undefined
          }
        />
      </DialogContent>
    </Dialog>
  );
}

/* --- Entrada / salida / ajuste -------------------------------------------- */
function DialogoMovimiento({
  insumo,
  onClose,
}: {
  insumo: InsumoConPresentaciones;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [tipo, setTipo] = useState<TipoMovimiento>("salida");
  const [cantidad, setCantidad] = useState("");
  const [motivo, setMotivo] = useState("");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{insumo.nombre}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            Hay{" "}
            <b className="text-foreground">
              {insumo.stock} {insumo.unidad}
            </b>
            .
          </p>
          <ControlSegmentado opciones={TIPOS_MOVIMIENTO} valor={tipo} onCambio={setTipo} />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mov-cant">{tipo === "ajuste" ? "Cuánto hay realmente" : "Cuánto"}</Label>
            <Input
              id="mov-cant"
              type="number"
              min="0"
              step="0.01"
              autoFocus
              value={cantidad}
              onChange={(e) => setCantidad(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mov-motivo">Motivo</Label>
            <Input
              id="mov-motivo"
              placeholder={tipo === "salida" ? "Para qué se usó" : "De dónde salió"}
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={pending}>
            Cancelar
          </Button>
          <Button
            disabled={pending || cantidad.trim() === ""}
            onClick={() =>
              ejecutar(() => moverInsumo(insumo.id, tipo, Number(cantidad), motivo), {
                error: "No se pudo mover. Revisa tu conexión.",
                alExito: (r) => {
                  const datos = "datos" in r ? r.datos : { stock: 0 };
                  toast.success(`Listo: quedan ${datos.stock} ${insumo.unidad}.`);
                  onClose();
                },
              })
            }
          >
            {pending ? "Guardando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* --- Quién puede descontar (solo administración) -------------------------- */
function DialogoPermisos({
  equipo,
  permisos,
  onClose,
}: {
  equipo: Profile[];
  permisos: InsumoPermiso[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const tiene = (id: string) => permisos.some((p) => p.profile_id === id && p.puede_descontar);

  /* Dirección y administración pueden siempre: no tiene caso ofrecerles un
     interruptor que no hace nada. */
  const candidatos = equipo.filter((p) => !puedeAdministrar(p.rol) && p.rol !== "externo");

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Quién puede descontar insumos</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Todo el equipo interno ve el inventario. Marca a quien además pueda registrar entradas y
          salidas. Dirección y administración pueden siempre.
        </p>
        <div className="flex flex-col gap-1">
          {candidatos.map((p) => (
            <label
              key={p.id}
              className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm hover:bg-muted/50"
            >
              <input
                type="checkbox"
                checked={tiene(p.id)}
                disabled={pending}
                onChange={(e) =>
                  ejecutar(() => cambiarPermisoInsumos(p.id, e.target.checked), {
                    ok: e.target.checked
                      ? `${p.nombre} ya puede descontar.`
                      : `${p.nombre} ya solo puede consultar.`,
                  })
                }
                className="size-4 accent-primary"
              />
              <span
                className="flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white"
                style={{ backgroundColor: p.color }}
              >
                {p.nombre.slice(0, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
            </label>
          ))}
          {candidatos.length === 0 && (
            <p className="text-[13px] text-muted-foreground">
              No hay nadie más a quien dar el permiso.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cerrar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
