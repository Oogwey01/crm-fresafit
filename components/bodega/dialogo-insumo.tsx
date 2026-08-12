"use client";

/* Alta y edición de un insumo, con sus presentaciones.
   Salió de seccion-insumos.tsx, que eran 894 líneas con la tabla y sus tres
   diálogos dentro. */

import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
  SeccionFormulario,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero } from "@/components/compartido/campo-hero";
import {
  PastillaEntrada,
  PastillaInterruptor,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  borrarInsumo,
  guardarInsumo,
  type PresentacionInput,
} from "@/app/(app)/bodega/actions";
import { CATEGORIAS_INSUMO } from "@/lib/catalogos";
import type {
  CategoriaInsumoId,
  InsumoConPresentaciones,
} from "@/lib/types";

/* Valor centinela: la pastilla de catálogo no maneja null. */
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

  const opcionesCategoria: { id: string; nombre: string; color?: string }[] = [
    { id: SIN_VALOR, nombre: "Sin definir" },
    ...CATEGORIAS_INSUMO,
  ];

  const datosDetalle = [dimensiones, link, notas].filter((v) => v.trim()).length;

  function guardar() {
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
    );
  }

  function borrar() {
    if (!insumo) return;
    ejecutar(() => borrarInsumo(insumo.id), {
      confirmar: `¿Borrar «${insumo.nombre}» y su historial de movimientos?`,
      ok: "Insumo borrado.",
      alExito: onClose,
    });
  }

  return (
    <DialogoFormulario
      titulo={insumo ? "Editar insumo" : "Nuevo insumo"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={insumo ? "Guardar cambios" : "Crear insumo"}
      pending={pending}
      onBorrar={insumo ? borrar : undefined}
      anchoEscritorio="md:max-w-2xl"
    >
      <Hero pasoTitulo="¿Qué insumo es?">
        <CampoHero
          id="ins-nombre"
          etiqueta="Nombre"
          placeholder="Bolsa para cinturones, etiqueta de paquetería…"
          valor={nombre}
          onCambio={setNombre}
        />
      </Hero>

      <Propiedades pasoTitulo="Cómo se controla">
        <PastillaOpcion<string>
          etiqueta="Sección"
          opciones={opcionesCategoria}
          valor={categoria ?? SIN_VALOR}
          onCambio={(v) => setCategoria(v === SIN_VALOR ? null : (v as CategoriaInsumoId))}
        />
        <PastillaEntrada
          etiqueta="Se compra a"
          placeholder="Castipack…"
          valor={empresa}
          onCambio={setEmpresa}
          opcional
          idMovil="ins-empresa"
        />
        <PastillaEntrada
          etiqueta="Unidad"
          valor={unidad}
          onCambio={setUnidad}
          idMovil="ins-unidad"
        />
        <PastillaEntrada
          etiqueta="Mínimo (avisa)"
          tipo="number"
          prefijo="mín "
          valor={minimo}
          onCambio={setMinimo}
          idMovil="ins-minimo"
        />
        <PastillaEntrada
          etiqueta="Máximo"
          tipo="number"
          prefijo="máx "
          placeholder="sin tope"
          valor={maximo}
          onCambio={setMaximo}
          opcional
          idMovil="ins-maximo"
        />
        <PastillaInterruptor etiqueta="Activo" valor={activo} onCambio={setActivo} />
        {!insumo && (
          <span className="w-full text-[12.5px] text-muted-foreground">
            El insumo nace en cero: la existencia se carga con un movimiento de entrada.
          </span>
        )}
      </Propiedades>

      {/* Presentaciones: el mismo insumo se compra en varias medidas y cada
          una tiene su precio. Es la parte de la hoja que no cabía en la
          ficha original. */}
      <SeccionFormulario
        titulo="Cómo se compra"
        pasoTitulo="¿Cómo se compra?"
        pasoAyuda="Cada medida en la que se compra, con su precio. «Apartado» y «En camino» se cuentan en paquetes de esa medida."
        contador={presentaciones.length || null}
        abiertaPorDefecto={presentaciones.length > 0}
      >
        {/* Qué son las dos últimas columnas. Va aquí y no como ayuda de cada
            campo porque son <Input> sueltos dentro de una rejilla de seis
            columnas, y colgarles un renglón de texto la rompería. Sin `md:hidden`
            a propósito: la duda es la misma en la computadora. */}
        {presentaciones.length > 0 && (
          <p className="w-full text-[12.5px] leading-relaxed text-muted-foreground">
            <b className="font-semibold text-foreground">Apartado</b>: paquetes ya comprometidos,
            que aunque estén en bodega ya no se pueden usar.{" "}
            <b className="font-semibold text-foreground">En camino</b>: paquetes ya pedidos que
            todavía no llegan. Se cuentan en <b className="font-semibold text-foreground">paquetes
            de esta presentación</b>, no en piezas, y son informativos: no se suman ni se restan del
            stock.
          </p>
        )}
        <div className="flex w-full items-start gap-2">
          {presentaciones.length === 0 ? (
            <p className="text-[12.5px] text-muted-foreground">
              Sin precios capturados. Agrega al menos una presentación («paquete de 100 a $164.68»)
              para que el CRM pueda calcular el precio por pieza.
            </p>
          ) : (
            <span className="flex-1" />
          )}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto shrink-0"
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
                aria-label={`Paquetes apartados de ${p.descripcion || "esta presentación"}`}
                value={p.reserva}
                onChange={(e) => cambiar(p.llave, "reserva", e.target.value)}
              />
            </div>
            <div className="flex items-end gap-1">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                {/* «En camino» y no «Pedido»: es la palabra que ya usa la tabla
                    de insumos, y «pedido» se confundía con el pedido a
                    proveedor, que es otra cosa. */}
                <span className="text-[11.5px] text-muted-foreground">En camino</span>
                <Input
                  className="h-9"
                  type="number"
                  min="0"
                  aria-label={`Paquetes en camino de ${p.descripcion || "esta presentación"}`}
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
      </SeccionFormulario>

      <SeccionFormulario
        titulo="Detalles"
        pasoTitulo="Detalles"
        pasoAyuda="Opcional: medidas, dónde se compra y lo que haya que recordar."
        contador={datosDetalle || null}
        abiertaPorDefecto={datosDetalle > 0}
      >
        <div className="grid w-full grid-cols-2 gap-3">
          <Campo etiqueta="Dimensiones" htmlFor="ins-dim">
            <Input
              id="ins-dim"
              placeholder="20 x 28 cm"
              value={dimensiones}
              onChange={(e) => setDimensiones(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Dónde se compra" htmlFor="ins-link">
            <Input
              id="ins-link"
              placeholder="https://…"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </Campo>
        </div>
        <Campo etiqueta="Notas" htmlFor="ins-notas" className="w-full">
          <Textarea
            id="ins-notas"
            rows={2}
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
          />
        </Campo>
      </SeccionFormulario>
    </DialogoFormulario>
  );
}
