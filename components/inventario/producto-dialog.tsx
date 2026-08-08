"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
  SeccionFormulario,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaDato,
  PastillaEntrada,
  PastillaInterruptor,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import { Input } from "@/components/ui/input";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import type { VistaDinero } from "@/lib/permisos-dinero";
import { aNumero } from "@/lib/validacion";
import { TIPOS_PRODUCTO } from "@/lib/catalogos";
import {
  guardarProducto,
  borrarProducto,
  galeriaDeProducto,
  type ProductoInput,
} from "@/app/(app)/inventario/actions";
import { useDetalleRemoto } from "@/components/compartido/use-detalle-remoto";
import type { ProductConProveedor, Supplier, TipoProductoId } from "@/lib/types";

const SIN_PROVEEDOR = "none";

/* Alta y edición de un producto. */
export function ProductoDialog({
  producto,
  proveedores,
  gestor,
  dinero,
  escrituraCanales,
  onClose,
}: {
  producto: ProductConProveedor | null; // null = alta
  proveedores: Supplier[];
  gestor: boolean;
  /* Qué puede ver de dinero quien edita: costo (egreso) y precio (ingreso). */
  dinero: VistaDinero;
  /* false (el default del sistema) = el CRM no modifica nada en las plataformas. */
  escrituraCanales: boolean;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();

  /* La galería no viaja en el listado (pesa demasiado en el catálogo entero):
     se pide aquí, al abrir el diálogo de este producto. */
  const { datos: imagenesCargadas } = useDetalleRemoto<string[]>(async () => {
    if (!producto) return [];
    const r = await galeriaDeProducto(producto.id);
    return "error" in r ? [] : r.imagenes;
  }, producto?.id ?? "");
  const imagenes = imagenesCargadas ?? [];
  /* Vinculado a un canal: nombre/variante se administran allá (la sync los
     pisaría). El stock de un producto vinculado NO se edita aquí: solo cambia
     con los botones +/− de la tabla. Con la escritura a canales apagada (el
     default) nada de lo que se guarde aquí viaja a las plataformas; con ella
     encendida, el precio/costo se empujan a Tienda Nube (el de ML se
     administra en ML). */
  const deTiendaNube = producto?.tiendanube_variant_id != null;
  const deMeli = producto?.meli_item_id != null;
  const vinculado = deTiendaNube || deMeli;
  const canal =
    deTiendaNube && deMeli ? "Tienda Nube y Mercado Libre" : deTiendaNube ? "Tienda Nube" : "Mercado Libre";
  const avisoCanales = !vinculado
    ? null
    : !escrituraCanales
      ? `Vinculado a ${canal}: el nombre y la variante se administran allá. Lo que guardes aquí (precio, costo, notas) se queda en el CRM: no modifica nada en ${canal}. El stock se ajusta con los botones +/− de la tabla.`
      : deTiendaNube && deMeli
        ? "Vinculado a Tienda Nube y Mercado Libre: el precio y costo que guardes aquí se actualizan en Tienda Nube. El stock se ajusta con los botones +/− de la tabla."
        : deTiendaNube
          ? "Producto vinculado a Tienda Nube: el nombre y la variante se editan en la tienda; el precio y costo que guardes aquí se actualizan también allá. El stock se ajusta con los botones +/− de la tabla."
          : "Publicación vinculada a Mercado Libre: nombre, variante y precio se editan allá. El stock se ajusta con los botones +/− de la tabla.";
  const [nombre, setNombre] = useState(producto?.nombre ?? "");
  const [tipo, setTipo] = useState<TipoProductoId>(producto?.tipo ?? "otro");
  const [variante, setVariante] = useState(producto?.variante ?? "");
  const [costo, setCosto] = useState(producto?.costo?.toString() ?? "");
  const [precio, setPrecio] = useState(producto?.precio?.toString() ?? "");
  const [stock, setStock] = useState(producto?.stock?.toString() ?? "0");
  const [stockMinimo, setStockMinimo] = useState(producto?.stock_minimo?.toString() ?? "5");
  const [proveedorId, setProveedorId] = useState(producto?.proveedor_id ?? SIN_PROVEEDOR);
  const [activo, setActivo] = useState(producto?.activo ?? true);
  const [bajoPedido, setBajoPedido] = useState(producto?.bajo_pedido ?? false);
  const [descontinuado, setDescontinuado] = useState(producto?.descontinuado ?? false);
  const [notas, setNotas] = useState(producto?.notas ?? "");

  const opcionesProveedor: { id: string; nombre: string }[] = [
    { id: SIN_PROVEEDOR, nombre: "Sin proveedor" },
    ...proveedores.map((p) => ({ id: p.id, nombre: p.nombre })),
  ];

  function guardar() {
    if (!nombre.trim()) {
      toast.error("El producto necesita un nombre.");
      return;
    }
    const input: ProductoInput = {
      nombre,
      tipo,
      variante,
      costo: aNumero(costo),
      precio: aNumero(precio),
      stock: Math.max(0, Math.trunc(Number(stock) || 0)),
      stock_minimo: Math.max(0, Math.trunc(Number(stockMinimo) || 0)),
      proveedor_id: proveedorId === SIN_PROVEEDOR ? null : proveedorId,
      activo,
      bajo_pedido: bajoPedido,
      descontinuado,
      notas,
    };
    ejecutar(() => guardarProducto(producto?.id ?? null, input), {
      ok: producto ? "Producto actualizado." : "Producto creado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!producto) return;
    ejecutar(() => borrarProducto(producto.id), {
      confirmar: `¿Borrar «${producto.nombre}»? Esto no se puede deshacer.`,
      ok: "Producto borrado.",
      error: "No se pudo borrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <DialogoFormulario
      titulo={producto ? "Editar producto" : "Nuevo producto"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={producto ? "Guardar cambios" : "Crear producto"}
      pending={pending}
      onBorrar={producto && gestor ? borrar : undefined}
    >
      <Hero
        pasoTitulo="¿Qué producto es?"
        valido={Boolean(nombre.trim())}
        motivoInvalido="El producto necesita un nombre."
      >
        {avisoCanales && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground md:mb-1">
            {avisoCanales}
          </p>
        )}

        {/* El nombre y la variante de un producto vinculado se administran en el
            canal: se pintan tal cual, sin caja. */}
        {vinculado ? (
          <div className="flex flex-col">
            <p className="font-heading text-lg font-semibold md:text-xl">{nombre}</p>
            {variante && <p className="text-sm text-muted-foreground">{variante}</p>}
          </div>
        ) : (
          <>
            <CampoHero
              id="prod-nombre"
              etiqueta="Nombre"
              placeholder="Cinturón de palanca"
              valor={nombre}
              onCambio={setNombre}
            />
            <CampoHero
              id="prod-variante"
              etiqueta="Variante (opcional)"
              placeholder="Variante: Rosa / M… (opcional)"
              valor={variante}
              onCambio={setVariante}
              className="font-sans text-[15px] font-normal md:text-[15px]"
            />
          </>
        )}
        <DescripcionHero
          id="prod-notas"
          etiqueta="Notas (opcional)"
          placeholder="Detalles del producto… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades pasoTitulo="Catálogo y precio">
        <PastillaOpcion
          etiqueta="Tipo"
          opciones={TIPOS_PRODUCTO}
          valor={tipo}
          onCambio={setTipo}
        />
        <PastillaOpcion<string>
          etiqueta="Proveedor"
          opciones={opcionesProveedor}
          valor={proveedorId}
          onCambio={setProveedorId}
          buscable
        />

        {/* Costo y precio desaparecen para quien no puede verlos: al editar
            llegarían vacíos y guardar los dejaría en nulo sin que nadie lo
            pidiera. Al dar de alta sí se piden —ahí el número lo pone quien
            captura—; el servidor conserva los anteriores de todas formas. */}
        {(dinero.egresos || !producto) && (
          <PastillaEntrada
            etiqueta="Costo ($)"
            tipo="number"
            prefijo="$"
            placeholder="0.00"
            valor={costo}
            onCambio={setCosto}
            opcional
            idMovil="prod-costo"
          />
        )}
        {(dinero.ingresos || !producto) &&
          (deMeli && !deTiendaNube ? (
            /* El precio de una publicación de ML se administra en ML. */
            <PastillaDato
              etiqueta="Precio"
              valor={precio ? `$${precio}` : "Precio en ML"}
              contenidoMovil={
                <Campo etiqueta="Precio ($)" htmlFor="prod-precio">
                  <Input id="prod-precio" type="number" disabled value={precio} />
                </Campo>
              }
            />
          ) : (
            <PastillaEntrada
              etiqueta="Precio ($)"
              tipo="number"
              prefijo="$"
              placeholder="0.00"
              valor={precio}
              onCambio={setPrecio}
              opcional
              idMovil="prod-precio"
            />
          ))}
      </Propiedades>

      <Propiedades pasoTitulo="Stock y estado">
        {vinculado ? (
          <PastillaDato
            etiqueta="Stock"
            valor={`${stock} en stock`}
            contenidoMovil={
              <Campo
                etiqueta="Stock"
                htmlFor="prod-stock"
                ayuda="El stock se ajusta con los botones +/− de la tabla"
              >
                <Input id="prod-stock" type="number" disabled value={stock} />
              </Campo>
            }
          />
        ) : (
          <PastillaEntrada
            etiqueta="Stock"
            tipo="number"
            sufijo="en stock"
            valor={stock}
            onCambio={setStock}
            idMovil="prod-stock"
          />
        )}
        <PastillaEntrada
          etiqueta="Aviso si ≤"
          tipo="number"
          prefijo="avisa ≤"
          valor={stockMinimo}
          onCambio={setStockMinimo}
          ayuda="Se avisa cuando el stock baja a este número o menos."
          idMovil="prod-minimo"
        />
        <PastillaInterruptor
          etiqueta="Se hace bajo pedido"
          valor={bajoPedido}
          onCambio={setBajoPedido}
        />
        <PastillaInterruptor
          etiqueta="Descontinuado"
          valor={descontinuado}
          onCambio={setDescontinuado}
        />
        {producto && (
          <PastillaInterruptor etiqueta="Producto activo" valor={activo} onCambio={setActivo} />
        )}

        {/* Las explicaciones de los interruptores, que en el teléfono siguen
            leyéndose completas (la pastilla sola no las carga). */}
        <div className="flex w-full flex-col gap-1.5 md:hidden">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            <b className="text-foreground">Bajo pedido:</b> se fabrica cuando alguien lo compra
            (personalizados). No lleva inventario: queda fuera de los agotados y de «Qué pedir».
          </p>
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            <b className="text-foreground">Descontinuado (ya no se repone):</b> líneas viejas que
            no se van a volver a maquilar (p. ej. las OG). Conserva su histórico y su stock, pero
            queda fuera de «Qué pedir» y de los avisos, y se oculta del catálogo vigente.
          </p>
          {producto && (
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              <b className="text-foreground">Producto activo:</b> desmárcalo para retirarlo del
              catálogo sin borrarlo.
            </p>
          )}
        </div>
      </Propiedades>

      {/* Galería importada de Tienda Nube (solo lectura; click para ampliar).
          Se pide al abrir el diálogo: traerla en el listado del inventario
          costaba ~950 KB por carga de página. */}
      {producto && imagenes.length > 0 && (
        <SeccionFormulario
          titulo="Fotos"
          pasoTitulo="Fotos"
          contador={imagenes.length}
          abiertaPorDefecto
        >
          <div className="flex w-full gap-2 overflow-x-auto pb-1">
            {imagenes.map((src, i) => (
              <a
                key={src}
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0"
                title={`Foto ${i + 1} — abrir en tamaño completo`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`${producto.nombre} — foto ${i + 1}`}
                  loading="lazy"
                  className="size-20 rounded-md border object-cover transition hover:opacity-80"
                />
              </a>
            ))}
          </div>
        </SeccionFormulario>
      )}
    </DialogoFormulario>
  );
}
