"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { registrarAnticipoMaquila } from "@/app/(app)/maquila/actions";
import { TIPOS_ANTICIPO_MAQUILA, obtenerTipoAnticipoMaquila } from "@/lib/catalogos";
import { hoyISO } from "@/lib/fecha";
import type { TipoAnticipoMaquilaId } from "@/lib/types";

/* Registrar un adelanto. En especie —«le compré 50 cinturones»— se piden dos
   cosas: el material, para leerlo como lo piensa Armando, y el valor acordado,
   que es lo que el corte resta de verdad. */
export function AnticipoDialog({ onClose }: { onClose: () => void }) {
  const { pending, ejecutar } = useAccionServidor();
  const [fecha, setFecha] = useState(hoyISO());
  const [tipo, setTipo] = useState<TipoAnticipoMaquilaId>("transferencia");
  const [concepto, setConcepto] = useState("");
  const [monto, setMonto] = useState("");
  const [cantidad, setCantidad] = useState("");
  const [unidad, setUnidad] = useState("");
  const [notas, setNotas] = useState("");

  const enEspecie = tipo === "especie";

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Anticipo a Eduardo</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ant-fecha">Fecha</Label>
              <Input
                id="ant-fecha"
                type="date"
                value={fecha}
                onChange={(e) => setFecha(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Tipo</Label>
              <Select value={tipo} onValueChange={(v) => v && setTipo(v as TipoAnticipoMaquilaId)}>
                <SelectTrigger>
                  <SelectValue>
                    {(v: string) => obtenerTipoAnticipoMaquila(v)?.nombre ?? v}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {TIPOS_ANTICIPO_MAQUILA.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ant-concepto">De qué es</Label>
            <Input
              id="ant-concepto"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              placeholder="Adelanto para materia prima de gamuza prensada"
              autoFocus
            />
          </div>

          {enEspecie && (
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="ant-cantidad">Cuánto material</Label>
                <Input
                  id="ant-cantidad"
                  type="number"
                  min={0}
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value)}
                  placeholder="20"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="ant-unidad">De qué</Label>
                <Input
                  id="ant-unidad"
                  value={unidad}
                  onChange={(e) => setUnidad(e.target.value)}
                  placeholder="gamuzas"
                />
              </div>
            </div>
          )}

          <div className="grid gap-1.5">
            <Label htmlFor="ant-monto">
              {enEspecie ? "Valor acordado (lo que el corte descuenta)" : "Monto"}
            </Label>
            <Input
              id="ant-monto"
              type="number"
              min={0}
              step="0.01"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="ant-notas">Notas</Label>
            <Textarea
              id="ant-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>
        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar="Registrar anticipo"
          onCancelar={onClose}
          onGuardar={() =>
            ejecutar(
              () =>
                registrarAnticipoMaquila({
                  fecha,
                  tipo,
                  concepto,
                  monto: Number(monto),
                  especie_cantidad: enEspecie && cantidad ? Number(cantidad) : null,
                  especie_unidad: enEspecie ? unidad : "",
                  notas,
                }),
              {
                ok: "Anticipo registrado. Se descontará solo en el siguiente corte.",
                error: "No se pudo registrar. Revisa tu conexión.",
                alExito: onClose,
              },
            )
          }
        />
      </DialogContent>
    </Dialog>
  );
}
