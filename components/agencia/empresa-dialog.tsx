"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DatePicker } from "@/components/compartido/date-picker";
import { PieDialogoCRUD } from "@/components/compartido/pie-dialogo-crud";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  crearEmpresa,
  editarEmpresa,
  borrarEmpresa,
  type EmpresaInput,
} from "@/app/(app)/agencia/actions";
import type { AgenciaEmpresa } from "@/lib/types";
import { cn } from "@/lib/utils";

/* Paleta corta: el color es solo para distinguir la empresa de un vistazo en
   tablas y gráficas, no hace falta un selector completo. */
const COLORES = ["#e84393", "#0984e3", "#00b894", "#fdcb6e", "#8e44ad", "#e17055", "#636e72"];

export function EmpresaDialog({
  empresa,
  onClose,
}: {
  empresa: AgenciaEmpresa | null; // null = alta
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [nombre, setNombre] = useState(empresa?.nombre ?? "");
  const [giro, setGiro] = useState(empresa?.giro ?? "");
  const [color, setColor] = useState(empresa?.color ?? COLORES[0]);
  const [contactoNombre, setContactoNombre] = useState(empresa?.contacto_nombre ?? "");
  const [contactoCorreo, setContactoCorreo] = useState(empresa?.contacto_correo ?? "");
  const [contactoTelefono, setContactoTelefono] = useState(empresa?.contacto_telefono ?? "");
  const [inicio, setInicio] = useState(empresa?.inicio ?? "");
  const [activa, setActiva] = useState(empresa?.activa ?? true);
  const [notas, setNotas] = useState(empresa?.notas ?? "");

  function guardar() {
    const input: EmpresaInput = {
      nombre,
      giro,
      color,
      contacto_nombre: contactoNombre,
      contacto_correo: contactoCorreo,
      contacto_telefono: contactoTelefono,
      inicio: inicio || null,
      activa,
      notas,
    };
    ejecutar(() => (empresa ? editarEmpresa(empresa.id, input) : crearEmpresa(input)), {
      ok: empresa ? "Empresa actualizada." : "Empresa creada.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!empresa) return;
    ejecutar(() => borrarEmpresa(empresa.id), {
      confirmar:
        "¿Borrar esta empresa? Se van con ella sus contratos, reportes y cobros. Si solo dejó de ser cliente, mejor márcala como inactiva.",
      ok: "Empresa borrada.",
      error: "No se pudo borrar.",
      alExito: onClose,
    });
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{empresa ? "Editar empresa" : "Nueva empresa"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-nombre">Nombre</Label>
            <Input
              id="emp-nombre"
              autoFocus
              placeholder="Nutravia, Bart Jerseys…"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-giro">Giro</Label>
              <Input
                id="emp-giro"
                placeholder="Suplementos, playeras…"
                value={giro}
                onChange={(e) => setGiro(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-inicio">Cliente desde</Label>
              <DatePicker id="emp-inicio" value={inicio} onChange={setInicio} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <div className="flex gap-2">
              {COLORES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  aria-pressed={color === c}
                  className={cn(
                    "size-7 rounded-lg transition-transform",
                    color === c && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5 border-t pt-3">
            <Label htmlFor="emp-contacto">Contacto</Label>
            <Input
              id="emp-contacto"
              placeholder="Con quién se trata"
              value={contactoNombre}
              onChange={(e) => setContactoNombre(e.target.value)}
            />
            <div className="grid grid-cols-2 gap-3">
              <Input
                type="email"
                placeholder="correo@empresa.com"
                value={contactoCorreo}
                onChange={(e) => setContactoCorreo(e.target.value)}
              />
              <Input
                placeholder="Teléfono"
                value={contactoTelefono}
                onChange={(e) => setContactoTelefono(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={activa}
              onChange={(e) => setActiva(e.target.checked)}
              className="mt-0.5 size-4 accent-primary"
            />
            <span>
              Cliente activo
              <span className="block text-[12.5px] leading-relaxed text-muted-foreground">
                Al apagarlo deja de contar en los totales, pero conserva su historial de cobros
                y reportes.
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-notas">Notas</Label>
            <Input
              id="emp-notas"
              placeholder="Lo que haya que recordar de esta cuenta"
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
            />
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={empresa ? "Guardar cambios" : "Crear empresa"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={empresa ? borrar : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
