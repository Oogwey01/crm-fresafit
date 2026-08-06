"use client";

/* Alta y edición de un insumo, con sus presentaciones.
   Salió de seccion-insumos.tsx, que eran 894 líneas con la tabla y sus tres
   diálogos dentro. */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
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
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  borrarInsumo,
  guardarInsumo,
  type PresentacionInput,
} from "@/app/(app)/bodega/actions";
import { CATEGORIAS_INSUMO, obtenerCategoriaInsumo } from "@/lib/catalogos";
import type {
  CategoriaInsumoId,
  InsumoConPresentaciones,
} from "@/lib/types";

/* Valor centinela del Select: los de base-ui no admiten value="". */
const SIN_VALOR = "sin_valor";

/* --- Alta / edición del insumo (administrativo) --------------------------- */
type PresentacionForm = PresentacionInput & { llave: number };

export function DialogoInsumo({
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
