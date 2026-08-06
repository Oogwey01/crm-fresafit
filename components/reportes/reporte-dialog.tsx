"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DatePicker } from "@/components/compartido/date-picker";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
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
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{reporte ? "Editar reporte" : "Nuevo reporte"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Empresa</Label>
            <Select value={empresaId} onValueChange={(v) => v && setEmpresaId(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) => empresas.find((e) => e.id === v)?.nombre ?? "Elegir empresa"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {empresas.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rep-titulo">Título</Label>
            <Input
              id="rep-titulo"
              autoFocus
              placeholder="Reporte mensual de julio"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rep-desde">Periodo desde</Label>
              <DatePicker id="rep-desde" value={desde} onChange={setDesde} limpiable />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="rep-hasta">Hasta</Label>
              <DatePicker id="rep-hasta" value={hasta} onChange={setHasta} limpiable />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rep-url">Enlace</Label>
            <Input
              id="rep-url"
              type="url"
              placeholder="Presentación, carpeta de Drive, video…"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              Los números se sacan de Meta y Shopify a mano; aquí solo se guarda dónde quedó el
              reporte para poder volver a él.
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="rep-resumen">Qué se le contó</Label>
            <Textarea
              id="rep-resumen"
              rows={3}
              placeholder="Los puntos que se repasaron con el cliente"
              value={resumen}
              onChange={(e) => setResumen(e.target.value)}
            />
          </div>

          <label className="flex items-start gap-2 text-sm">
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
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={reporte ? "Guardar cambios" : "Crear reporte"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={reporte ? borrar : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
