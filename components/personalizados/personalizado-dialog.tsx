"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
  SeccionFormulario,
} from "@/components/compartido/dialogo-formulario";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaEntrada,
  PastillaFecha,
  PastillaOpcion,
  PastillaPersona,
} from "@/components/compartido/pastillas-campo";
import { Button } from "@/components/ui/button";
import { Pastilla } from "@/components/compartido/pastilla";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  borrarPersonalizado,
  guardarPersonalizado,
  subirFotoPersonalizado,
  type VentaCandidata,
} from "@/app/(app)/personalizados/actions";
import { PastillaVenta } from "@/components/personalizados/selector-venta";
import {
  CANALES,
  ESTADOS_PERSONALIZADO,
  MODELOS_PERSONALIZADO,
  TIPOS_PERSONALIZADO,
} from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import type {
  EstadoPersonalizadoId,
  ModeloPersonalizadoId,
  Personalizado,
  Profile,
  TipoPersonalizadoId,
} from "@/lib/types";

const SIN_VALOR = "sin_valor";

/* Alta y edición de un personalizado. Todo es captura manual —así se pidió—,
   incluida la foto del diseño que el cliente aprobó. */
export function PersonalizadoDialog({
  personalizado,
  equipo,
  urlDiseno = null,
  onClose,
}: {
  personalizado: Personalizado | null;
  equipo: Profile[];
  /* Enlace firmado del diseño ya subido, para verlo aquí mismo al editar. */
  urlDiseno?: string | null;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const fotoRef = useRef<HTMLInputElement>(null);
  /* Vista previa del archivo recién elegido, antes de guardar: sin ella no se
     sabía qué imagen quedó seleccionada hasta reabrir la ficha. */
  const [previewLocal, setPreviewLocal] = useState<string | null>(null);

  /* Los personalizados los llevan los del área de diseño (Manuel, Ulises y
     Juanpi): ofrecer a todo el equipo solo metía ruido. */
  const disenadores = equipo.filter((p) => p.area === "diseno");

  const [cliente, setCliente] = useState(personalizado?.cliente ?? "");
  const [tipo, setTipo] = useState<TipoPersonalizadoId | null>(personalizado?.tipo ?? null);
  const [modelo, setModelo] = useState<ModeloPersonalizadoId | null>(personalizado?.modelo ?? null);
  const [talla, setTalla] = useState(personalizado?.talla ?? "");
  const [noVenta, setNoVenta] = useState(personalizado?.no_venta ?? "");
  /* La venta del CRM a la que quedó ligado. Al editar una ficha vieja arranca en
     null aunque tenga número: se capturó a mano y nadie confirmó cuál era. La
     pastilla lo dice («sin venta ligada») y basta con buscarla una vez. */
  const [venta, setVenta] = useState<VentaCandidata | null>(null);
  const [saleOrderId, setSaleOrderId] = useState<string | null>(
    personalizado?.sale_order_id ?? null,
  );
  const [canal, setCanal] = useState<string | null>(personalizado?.canal ?? null);
  const [fechaCompra, setFechaCompra] = useState(personalizado?.fecha_compra ?? hoyISO());
  const [fechaProduccion, setFechaProduccion] = useState(personalizado?.fecha_produccion ?? "");
  const [fechaLimite, setFechaLimite] = useState(personalizado?.fecha_limite ?? "");
  const [url, setUrl] = useState(personalizado?.url ?? "");
  const [estado, setEstado] = useState<EstadoPersonalizadoId>(personalizado?.estado ?? "recibido");
  const [notas, setNotas] = useState(personalizado?.notas ?? "");
  const [responsable, setResponsable] = useState<string | null>(
    personalizado?.responsable_id ?? null,
  );

  /* Los catálogos con "Sin definir" al frente: en el viejo Select era el
     SelectItem extra; en la pastilla es una opción más. */
  const opcionesModelo: { id: string; nombre: string }[] = [
    { id: SIN_VALOR, nombre: "Sin definir" },
    ...MODELOS_PERSONALIZADO.map((m) => ({ id: m.id, nombre: m.nombre })),
  ];
  const opcionesTipo: { id: string; nombre: string }[] = [
    { id: SIN_VALOR, nombre: "Sin definir" },
    ...TIPOS_PERSONALIZADO.map((t) => ({ id: t.id, nombre: t.nombre })),
  ];
  const opcionesCanal: { id: string; nombre: string; color?: string }[] = [
    { id: SIN_VALOR, nombre: "Sin definir" },
    ...CANALES.filter((c) => c.id !== "punto_fisico").map((c) => ({
      id: c.id,
      nombre: c.nombre,
      color: c.color,
    })),
  ];

  /* Elegir la venta llena de un golpe los tres datos que salen de ella: el
     folio, el canal y el día de compra. El canal solo si estaba en blanco —si
     alguien ya lo puso a mano, manda—; la fecha sí se pisa, porque su valor por
     defecto es «hoy», que casi nunca es el día en que compraron.
     Al teclear a mano llega venta=null y se suelta la liga: el número queda como
     texto libre, que es lo que era antes de esto. */
  function elegirVenta(texto: string, elegida: VentaCandidata | null) {
    setNoVenta(texto);
    setVenta(elegida);
    setSaleOrderId(elegida?.id ?? null);
    if (!elegida) return;
    if (!canal && elegida.canal !== "punto_fisico") setCanal(elegida.canal);
    setFechaCompra(elegida.fecha);
  }

  function guardar() {
    ejecutar(
      () =>
        guardarPersonalizado(personalizado?.id ?? null, {
          cliente,
          tipo,
          modelo,
          talla,
          no_venta: noVenta,
          sale_order_id: saleOrderId,
          canal: canal as "tienda_nube" | "mercado_libre" | "tiktok_shop" | "otro" | null,
          fecha_compra: fechaCompra || null,
          fecha_produccion: fechaProduccion || null,
          fecha_limite: fechaLimite || null,
          url,
          estado,
          notas,
          responsable_id: responsable,
        }),
      {
        error: "No se pudo guardar. Revisa tu conexión.",
        alExito: async (r) => {
          const id = "datos" in r ? r.datos.id : personalizado?.id;
          const file = fotoRef.current?.files?.[0];
          /* La foto se sube después de tener el id: la ruta del bucket cuelga
             de él, y así una ficha nueva puede traer su diseño de una vez. */
          if (id && file) {
            const fd = new FormData();
            fd.append("file", file);
            const sub = await subirFotoPersonalizado(id, fd);
            if ("error" in sub) {
              toast.error(`Se guardó la ficha, pero la imagen no: ${sub.error}`);
              onClose();
              return;
            }
          }
          toast.success(personalizado ? "Personalizado actualizado." : "Personalizado registrado.");
          onClose();
        },
      },
    );
  }

  const hayDiseno = Boolean(previewLocal ?? urlDiseno ?? personalizado?.foto_path);

  return (
    <DialogoFormulario
      titulo={personalizado ? "Editar personalizado" : "Nuevo personalizado"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={personalizado ? "Guardar cambios" : "Registrar"}
      pending={pending}
      onBorrar={
        personalizado
          ? () =>
              ejecutar(() => borrarPersonalizado(personalizado.id, personalizado.foto_path), {
                confirmar: `¿Borrar el personalizado de ${personalizado.cliente}?`,
                ok: "Personalizado borrado.",
                alExito: onClose,
              })
          : undefined
      }
    >
      <Hero pasoTitulo="¿De quién es el pedido?">
        <CampoHero
          id="pz-cliente"
          etiqueta="Cliente"
          placeholder="Nombre del cliente"
          valor={cliente}
          onCambio={setCliente}
        />
        <DescripcionHero
          id="pz-notas"
          etiqueta="Notas"
          placeholder="Notas del pedido… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades pasoTitulo="El cinto y la venta">
        <PastillaOpcion<string>
          etiqueta="Tipo de cinto"
          opciones={opcionesModelo}
          valor={modelo ?? SIN_VALOR}
          onCambio={(v) => setModelo(v === SIN_VALOR ? null : (v as ModeloPersonalizadoId))}
        />
        <PastillaOpcion<string>
          etiqueta="Técnica"
          opciones={opcionesTipo}
          valor={tipo ?? SIN_VALOR}
          onCambio={(v) => setTipo(v === SIN_VALOR ? null : (v as TipoPersonalizadoId))}
        />
        <PastillaEntrada
          etiqueta="Talla"
          placeholder="CHM, G, GEG…"
          valor={talla}
          onCambio={setTalla}
          opcional
          idMovil="pz-talla"
        />
        <PastillaVenta
          etiqueta="Nº de venta"
          valor={noVenta}
          ventaLigada={venta}
          onCambio={elegirVenta}
          ayuda="Búscala entre las ventas del CRM o escribe el número a mano."
          idMovil="pz-venta"
        />
        <PastillaOpcion<string>
          etiqueta="Canal"
          opciones={opcionesCanal}
          valor={canal ?? SIN_VALOR}
          onCambio={(v) => setCanal(v === SIN_VALOR ? null : v)}
        />
        <PastillaFecha
          etiqueta="Fecha de compra"
          etiquetaVacia="Fecha de compra"
          valor={fechaCompra}
          onCambio={setFechaCompra}
          limpiable
        />
      </Propiedades>

      <Propiedades pasoTitulo="Producción y seguimiento">
        <PastillaFecha
          etiqueta="Mandado a producción"
          etiquetaVacia="A producción"
          valor={fechaProduccion}
          onCambio={setFechaProduccion}
          limpiable
        />
        <PastillaFecha
          etiqueta="Fecha límite"
          etiquetaVacia="Fecha límite"
          valor={fechaLimite}
          onCambio={setFechaLimite}
          limpiable
        />
        <PastillaOpcion
          etiqueta="Estado"
          opciones={ESTADOS_PERSONALIZADO}
          valor={estado}
          onCambio={setEstado}
        />
        <PastillaPersona
          etiqueta="Quién lo lleva"
          equipo={disenadores}
          valor={responsable ?? SIN_VALOR}
          onCambio={(v) => setResponsable(v === SIN_VALOR ? null : v)}
          opcionNula={{ id: SIN_VALOR, nombre: "Sin asignar" }}
        />
        <PastillaEntrada
          etiqueta="Link"
          placeholder="https://…"
          valor={url}
          onCambio={setUrl}
          opcional
          ayuda="Diseño, conversación, publicación…"
          idMovil="pz-url"
        />
      </Propiedades>

      <SeccionFormulario
        titulo="Diseño aprobado"
        pasoTitulo="El diseño aprobado"
        pasoAyuda="La imagen del diseño que el cliente aprobó (la sube quien diseña)."
        contador={hayDiseno ? 1 : null}
        abiertaPorDefecto={hayDiseno}
      >
        <div className="flex w-full flex-col gap-2">
          {/* El diseño se ve aquí mismo: antes solo decía "ya tiene imagen" y
              para verla había que cerrar y buscar la fila en la tabla. Con un
              archivo recién elegido se enseña ESE, aún sin guardar. */}
          {(previewLocal ?? urlDiseno) && (
            <div className="flex h-20 w-full items-center justify-start rounded-lg border bg-muted/40 px-2">
              <Image
                src={previewLocal ?? urlDiseno!}
                alt={`Diseño de ${cliente || "personalizado"}`}
                width={760}
                height={80}
                unoptimized
                className="max-h-full w-auto max-w-full rounded object-contain"
              />
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fotoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                setPreviewLocal((prev) => {
                  if (prev) URL.revokeObjectURL(prev);
                  return f ? URL.createObjectURL(f) : null;
                });
              }}
            />
            <Button variant="outline" size="sm" onClick={() => fotoRef.current?.click()}>
              <Upload className="size-3.5" />
              {personalizado?.foto_path ? "Reemplazar diseño" : "Subir diseño aprobado"}
            </Button>
            <span className="text-[12.5px] text-muted-foreground">
              La imagen del diseño que el cliente aprobó (la sube quien diseña).
            </span>
            {previewLocal ? (
              <Pastilla nombre="Se sube al guardar" color="#f59e0b" />
            ) : (
              personalizado?.foto_path && <Pastilla nombre="Ya tiene imagen" color="#22c55e" />
            )}
          </div>
        </div>
      </SeccionFormulario>
    </DialogoFormulario>
  );
}
