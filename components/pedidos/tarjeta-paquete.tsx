"use client";

import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { ChevronLeft, ChevronRight, ExternalLink, GripVertical } from "lucide-react";
import { ETAPAS_EMPAQUE, obtenerCanal } from "@/lib/catalogos";
import { duracionCorta } from "@/lib/fecha";
import { SITUACION } from "@/lib/canales/despacho";
import { etapaDe, numeroOrden, plazoUrgente } from "@/lib/pedidos/bandejas";
import { urlOrdenCanal } from "@/lib/pedidos/rastreo";
import { nombreVenta } from "@/lib/ventas";
import type { EtapaEmpaqueId, PedidoEnvio } from "@/lib/types";
import { Pastilla } from "@/components/compartido/pastilla";
import { cn } from "@/lib/utils";

/* Una caja en la mesa de empaque.

   El asa de arrastre NO es la tarjeta entera, a diferencia de las de Tareas:
   aquí dentro hay botones y un enlace, y un `useDraggable` sobre el contenedor
   se traga sus pointerdown —o al revés, tocar un botón levanta la tarjeta—. Los
   `listeners` van en la barra de arriba, que además se ve como lo que es: una
   cabecera con su ⣿ para agarrarla. */
export function TarjetaPaquete({
  pedido,
  ahora,
  onMover,
  onAbrir,
  dominioTiendaNube,
  overlay = false,
}: {
  pedido: PedidoEnvio;
  /* El "ahora" del tablero, que avanza con su propio latido de un minuto. Entra
     como prop y no se lee aquí para que el primer render coincida con el del
     servidor (si no, React tira la hidratación). */
  ahora: number;
  onMover?: (p: PedidoEnvio, etapa: EtapaEmpaqueId) => void;
  onAbrir?: (p: PedidoEnvio) => void;
  /* Subdominio del panel de Tienda Nube: el respaldo del enlace a la
     publicación cuando la sync todavía no ha guardado su permalink público. */
  dominioTiendaNube?: string | null;
  /* La copia que va pegada al cursor mientras se arrastra: sin listeners y sin
     controles, o dnd-kit tendría dos elementos con el mismo id. */
  overlay?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: pedido.id,
    disabled: overlay,
  });

  const canal = obtenerCanal(pedido.canal);
  const etapa = etapaDe(pedido);
  const idx = ETAPAS_EMPAQUE.findIndex((e) => e.id === etapa);
  const plazo = plazoUrgente(pedido, ahora);
  const orden = pedido.referencia_externa ? numeroOrden(pedido.referencia_externa) : null;
  const enEtapa = pedido.etapa_empaque_en ? duracionCorta(pedido.etapa_empaque_en, ahora) : null;
  /* El PEDIDO en el panel del canal —no la publicación pública—: es la pantalla
     con la que se trabaja al empacar, la que lleva el detalle de la venta, la
     dirección y la guía. En Mercado Libre sale de `url_orden`, que la sync ya
     guarda con la forma /ventas/<pack>/detalle; en Tienda Nube se arma con el
     subdominio del admin, y en TikTok con el número de orden.

     Va por la ORDEN y no por el producto a propósito: la mitad larga de los
     pendientes de Tienda Nube no tiene ficha ligada en el catálogo —entran con
     la descripción del canal— y se quedaban sin botón. La orden existe siempre. */
  const enCanal = pedido.referencia_externa
    ? urlOrdenCanal(pedido.canal, numeroOrden(pedido.referencia_externa), dominioTiendaNube, pedido.url_orden)
    : null;
  const foto = pedido.producto?.imagen_url ?? null;

  return (
    <div
      ref={setNodeRef}
      style={transform ? { transform: CSS.Translate.toString(transform) } : undefined}
      className={cn(
        "overflow-hidden rounded-xl border bg-card shadow-sm transition-shadow hover:shadow-md",
        isDragging && "opacity-50",
        plazo === "vencido" && "ring-1 ring-red-300",
      )}
    >
      {/* ---- El asa: número de orden + canal. Es lo único que arrastra. ---- */}
      <div
        {...(overlay ? {} : { ...listeners, ...attributes })}
        className={cn(
          "flex items-center gap-1.5 border-b bg-muted/40 px-2.5 py-2",
          !overlay && "cursor-grab active:cursor-grabbing",
        )}
      >
        {!overlay && (
          <GripVertical className="size-3.5 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        )}
        <span className="truncate font-mono text-[13px] font-bold tabular-nums">
          {orden ?? nombreVenta(pedido)}
        </span>
        {canal && (
          <Pastilla
            nombre={canal.nombre}
            color={canal.color}
            className="ml-auto shrink-0 px-1.5 py-0.5 text-[10px] uppercase"
          />
        )}
      </div>

      <div className="relative">
        {/* La foto del producto, de fondo y por detrás de todo.

            Va de adorno útil, no de miniatura: al armar la caja se reconoce
            antes el producto por la foto que por el nombre —entre variantes que
            solo cambian de color, el nombre hay que leerlo entero—. Ocupa la
            mitad derecha, que es la que el texto deja libre.

            `object-contain` y no `cover`, por lo mismo que Miniatura: las fotos
            del catálogo traen fondo blanco y su propio encuadre, y recortarlas
            para llenar el hueco les come las asas y las hebillas. La opacidad
            baja más en oscuro: ese fondo blanco, encendido, se lee como una
            mancha. Y `aria-hidden` + alt vacío porque no aporta nada a quien
            usa lector de pantalla: el nombre ya está escrito al lado.

            Solo la tiene un tercio de los pendientes —el resto entra sin ficha
            ligada en el catálogo—, así que la tarjeta está pensada para verse
            igual de bien sin ella. */}
        {foto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={foto}
            alt=""
            aria-hidden="true"
            loading="lazy"
            className="pointer-events-none absolute inset-y-0 right-0 h-full w-1/2 object-contain opacity-20 dark:opacity-[0.13]"
          />
        )}

        <div className="relative flex flex-col gap-2 p-2.5">
          {/* Qué es, para no tener que abrirlo: el nombre del producto es lo que
              se busca en el estante. */}
          <div className="line-clamp-2 text-[12.5px] font-semibold leading-snug">
            {nombreVenta(pedido)}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
            {/* Cuánto lleva parado aquí. Es el dato por el que este tablero existe:
                en la tabla, un pedido atorado desde la mañana se ve idéntico a uno
                que acaba de entrar. */}
            {enEtapa && (
              <span className="rounded-full bg-muted px-2 py-0.5 font-semibold tabular-nums text-muted-foreground">
                {enEtapa} en esta etapa
              </span>
            )}
            {/* El plazo del canal: esto el rastreador de fuera no lo sabía, y es
                justo lo que decide qué caja va primero. */}
            {plazo && (
              <Pastilla
                nombre={SITUACION[plazo].nombre}
                color={SITUACION[plazo].color}
                className="px-2 py-0.5 text-[11px]"
              />
            )}
          </div>

          {!overlay && (
            <>
              {/* Mover ◀ ▶, el pedido en el canal y el envío. Los botones de mover no
                  son un adorno del arrastre: arrastrar con las manos ocupadas —o
                  desde el teclado— no siempre sale, y sin ellos el tablero sería
                  inoperable para media bodega. */}
              <div className="flex items-center gap-1.5 border-t pt-2">
                {idx > 0 && (
                  <button
                    type="button"
                    aria-label={`Regresar a ${ETAPAS_EMPAQUE[idx - 1].nombre}`}
                    title={`Regresar a ${ETAPAS_EMPAQUE[idx - 1].nombre}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onMover?.(pedido, ETAPAS_EMPAQUE[idx - 1].id)}
                    className="flex size-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <ChevronLeft className="size-3.5" />
                  </button>
                )}
                {idx < ETAPAS_EMPAQUE.length - 1 && (
                  <button
                    type="button"
                    aria-label={`Avanzar a ${ETAPAS_EMPAQUE[idx + 1].nombre}`}
                    title={`Avanzar a ${ETAPAS_EMPAQUE[idx + 1].nombre}`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={() => onMover?.(pedido, ETAPAS_EMPAQUE[idx + 1].id)}
                    className="flex size-6 items-center justify-center rounded-md border text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <ChevronRight className="size-3.5" />
                  </button>
                )}
                {/* Es un `<a>` y no un botón porque abrir el pedido solo LEE: al
                    revés que «imprimir la guía», que en Mercado Libre da la
                    etiqueta por impresa y mueve el envío, y por eso vive detrás
                    de una confirmación (ver imprimirGuia en el panel). */}
                {enCanal && (
                  <a
                    href={enCanal}
                    target="_blank"
                    rel="noopener noreferrer"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                    title={`Abrir el pedido en ${canal?.nombre ?? "el canal"}`}
                    aria-label={`Abrir el pedido en ${canal?.nombre ?? "el canal"}`}
                    className="ml-auto inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  >
                    <ExternalLink className="size-3.5" />
                    Pedido
                  </a>
                )}
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => onAbrir?.(pedido)}
                  className={cn(
                    "rounded-md border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                    /* Sin pedido que abrir, éste es el que se va a la derecha;
                       con él, van los dos juntos al final. */
                    !enCanal && "ml-auto",
                  )}
                >
                  Envío
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
