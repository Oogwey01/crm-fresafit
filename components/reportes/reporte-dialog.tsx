"use client";

import { useState } from "react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaEntrada,
  PastillaFecha,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  crearReporte,
  editarReporte,
  borrarReporte,
  type ReporteInput,
} from "@/app/(app)/reportes/actions";
import { formatearFecha } from "@/lib/fecha";
import type { AgenciaEmpresa, AgenciaReporteConEmpresa } from "@/lib/types";

export function ReporteDialog({
  reporte,
  empresas,
  onClose,
}: {
  reporte: AgenciaReporteConEmpresa | null; // null = alta
  empresas: AgenciaEmpresa[];
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [empresaId, setEmpresaId] = useState(reporte?.empresa_id ?? empresas[0]?.id ?? "");
  const [titulo, setTitulo] = useState(reporte?.titulo ?? "");
  const [desde, setDesde] = useState(reporte?.periodo_desde ?? "");
  const [hasta, setHasta] = useState(reporte?.periodo_hasta ?? "");
  const [resumen, setResumen] = useState(reporte?.resumen ?? "");
  const [url, setUrl] = useState(reporte?.url ?? "");
  const [entregado, setEntregado] = useState(!!reporte?.entregado_at);

  const opcionesEmpresa = empresas.map((e) => ({ id: e.id, nombre: e.nombre, color: e.color }));

  function guardar() {
    const input: ReporteInput = {
      empresa_id: empresaId,
      titulo,
      periodo_desde: desde || null,
      periodo_hasta: hasta || null,
      resumen,
      url,
      entregado,
    };
    ejecutar(
      () =>
        reporte
          ? editarReporte(reporte.id, input, reporte.entregado_at)
          : crearReporte(input),
      {
        ok: reporte ? "Reporte actualizado." : "Reporte creado.",
        error: "No se pudo guardar. Revisa tu conexión.",
        alExito: onClose,
      },
    );
  }

  function borrar() {
    if (!reporte) return;
    ejecutar(() => borrarReporte(reporte.id), {
      confirmar: "¿Borrar este reporte?",
      ok: "Reporte borrado.",
      error: "No se pudo borrar.",
      alExito: onClose,
    });
  }

  return (
    <DialogoFormulario
      titulo={reporte ? "Editar reporte" : "Nuevo reporte"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={reporte ? "Guardar cambios" : "Crear reporte"}
      pending={pending}
      onBorrar={reporte ? borrar : undefined}
    >
      <Hero pasoTitulo="¿Qué se reportó?">
        {/* La empresa primero: el reporte es DE alguien, como el cliente en la
            tarea de agencia. */}
        <div className="md:mb-1">
          <PastillaOpcion
            etiqueta="Empresa"
            opciones={opcionesEmpresa}
            valor={empresaId}
            onCambio={setEmpresaId}
          />
        </div>
        <CampoHero
          id="rep-titulo"
          etiqueta="Título"
          placeholder="Reporte mensual de julio"
          valor={titulo}
          onCambio={setTitulo}
        />
        <DescripcionHero
          id="rep-resumen"
          etiqueta="Qué se le contó"
          placeholder="Los puntos que se repasaron con el cliente"
          valor={resumen}
          onCambio={setResumen}
          rows={3}
        />
      </Hero>

      <Propiedades pasoTitulo="Periodo y entrega">
        <PastillaFecha
          etiqueta="Periodo desde"
          etiquetaVacia="Desde"
          valor={desde}
          onCambio={setDesde}
          limpiable
        />
        <PastillaFecha
          etiqueta="Hasta"
          etiquetaVacia="Hasta"
          valor={hasta}
          onCambio={setHasta}
          limpiable
        />
        <PastillaEntrada
          etiqueta="Enlace"
          valor={url}
          onCambio={setUrl}
          placeholder="Presentación, carpeta de Drive, video…"
          ayuda="Los números se sacan de Meta y Shopify a mano; aquí solo se guarda dónde quedó el reporte para poder volver a él."
          opcional
          idMovil="rep-url"
        />

        <label className="flex w-full items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={entregado}
            onChange={(e) => setEntregado(e.target.checked)}
            className="mt-0.5 size-4 accent-primary"
          />
          <span>
            Ya se entregó
            <span className="block text-[12.5px] leading-relaxed text-muted-foreground">
              {reporte?.entregado_at
                ? `Se entregó el ${formatearFecha(reporte.entregado_at.slice(0, 10))}; editar el resumen no cambia esa fecha.`
                : "Al marcarlo se guarda la fecha de hoy como fecha de entrega."}
            </span>
          </span>
        </label>
      </Propiedades>
    </DialogoFormulario>
  );
}
