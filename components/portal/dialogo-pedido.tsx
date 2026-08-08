"use client";

import { useState } from "react";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import { PastillaFecha, PastillaOpcion } from "@/components/compartido/pastillas-campo";
import { CATEGORIAS_TAREA } from "@/lib/catalogos";
import { crearPedido } from "@/app/(app)/portal/acciones/tareas";
import type { CategoriaTareaId } from "@/lib/types";

/* Pedirle algo a Fresafit.

   Cuatro campos y ni uno más. La versión interna de este formulario tiene doce
   —responsable, área, etiquetas, coasignados, recordatorio— y todos ellos son
   vocabulario NUESTRO: a quien está del otro lado no le toca aprenderse cómo
   organizamos el trabajo por dentro. Quién lo atiende y con qué prioridad
   interna se decide del lado de Fresafit, después.

   Lo abre solo el administrador de la empresa (`esExternoAdmin`), y la policy
   "tareas: crear (cliente admin)" lo vuelve a comprobar en la base. */
export function DialogoPedido({ onCerrar }: { onCerrar: () => void }) {
  const { pending, ejecutar } = useAccionServidor();
  const [titulo, setTitulo] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [categoria, setCategoria] = useState<CategoriaTareaId>("otro");
  const [urgente, setUrgente] = useState(false);
  const [fecha, setFecha] = useState("");

  function guardar() {
    ejecutar(
      () => crearPedido({ titulo, descripcion, categoria, urgente, fecha_limite: fecha || null }),
      {
        ok: "Pedido enviado. Fresafit ya está enterado.",
        error: "No se pudo enviar el pedido.",
        alExito: onCerrar,
      },
    );
  }

  return (
    <DialogoFormulario
      titulo="Pedir algo a Fresafit"
      onCerrar={onCerrar}
      onGuardar={guardar}
      etiquetaGuardar="Enviar pedido"
      pending={pending}
    >
      <Hero
        pasoTitulo="¿Qué necesitas?"
        pasoAyuda="Con una línea basta; los detalles van abajo."
        valido={titulo.trim().length > 0}
        motivoInvalido="Escribe qué necesitas."
      >
        <CampoHero
          id="pedido-titulo"
          etiqueta="Título"
          placeholder="Reporte de ventas de la quincena"
          valor={titulo}
          onCambio={setTitulo}
        />
        <DescripcionHero
          id="pedido-desc"
          etiqueta="Detalles"
          placeholder="Qué esperas recibir, en qué formato, para qué lo necesitas…"
          valor={descripcion}
          onCambio={setDescripcion}
          rows={4}
        />
      </Hero>

      <Propiedades
        pasoTitulo="¿De qué se trata?"
        pasoAyuda="Sirve para agrupar y para saber qué hace falta al cerrarlo."
      >
        <PastillaOpcion
          etiqueta="Categoría"
          opciones={CATEGORIAS_TAREA}
          valor={categoria}
          onCambio={setCategoria}
        />
      </Propiedades>

      <Propiedades
        pasoTitulo="¿Para cuándo?"
        pasoAyuda="Opcional. Lo urgente avisa por correo en el momento."
      >
        <PastillaFecha
          etiqueta="Fecha límite"
          etiquetaVacia="Fecha límite"
          valor={fecha}
          onCambio={setFecha}
          limpiable
        />
        {/* El interruptor de urgencia se queda como tarjeta con su explicación:
            para quien entra una vez al mes, el contexto vale más que el espacio. */}
        <label className="flex w-full items-start gap-2.5 rounded-xl border p-3 text-[14px]">
          <input
            type="checkbox"
            checked={urgente}
            onChange={(e) => setUrgente(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            <span className="font-semibold">Es urgente</span>
            <span className="block text-[13px] text-muted-foreground">
              Avisa de inmediato en vez de esperar al resumen del día.
            </span>
          </span>
        </label>
      </Propiedades>
    </DialogoFormulario>
  );
}
