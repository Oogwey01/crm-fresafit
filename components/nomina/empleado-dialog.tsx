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
  crearEmpleado,
  editarEmpleado,
  borrarEmpleado,
  type EmpleadoInput,
} from "@/app/(app)/nomina/actions";
import {
  ESQUEMAS_PAGO,
  PERIODICIDADES_PAGO,
  SITUACIONES_LABORALES,
  obtenerSituacionLaboral,
} from "@/lib/agencia";
import { aNumero } from "@/lib/validacion";
import type { AgenciaEmpresa, NominaEmpleadoConEmpresa, Profile } from "@/lib/types";

const SIN_CUENTA = "__sin_cuenta__";
const FRESAFIT = "__fresafit__";

export function EmpleadoDialog({
  empleado,
  empresas,
  equipo,
  ambito,
  onClose,
}: {
  empleado: NominaEmpleadoConEmpresa | null; // null = alta
  empresas: AgenciaEmpresa[];
  equipo: Profile[];
  /* En Fresafit no hay a quién cargarle el sueldo más que a Fresafit, así que el
     selector de empresa no se muestra y el alta queda ahí por defecto. */
  ambito: "fresafit" | "agencia";
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const esAgencia = ambito === "agencia";
  const [profileId, setProfileId] = useState(empleado?.profile_id ?? SIN_CUENTA);
  const [nombre, setNombre] = useState(empleado?.nombre ?? "");
  const [puesto, setPuesto] = useState(empleado?.puesto ?? "");
  const [empresaId, setEmpresaId] = useState(
    empleado?.empresa_id ?? (esAgencia ? (empresas[0]?.id ?? FRESAFIT) : FRESAFIT),
  );
  const [esquema, setEsquema] = useState<string>(empleado?.esquema ?? "sueldo");
  const [monto, setMonto] = useState(empleado ? String(empleado.monto) : "");
  const [periodicidad, setPeriodicidad] = useState<string>(empleado?.periodicidad ?? "quincenal");
  const [diaCorte, setDiaCorte] = useState(empleado?.dia_corte ? String(empleado.dia_corte) : "");
  const [situacion, setSituacion] = useState<string>(empleado?.situacion ?? "sin_formalizar");
  const [activo, setActivo] = useState(empleado?.activo ?? true);
  const [inicio, setInicio] = useState(empleado?.inicio ?? "");
  const [notas, setNotas] = useState(empleado?.notas ?? "");

  /* Al elegir a alguien del equipo se rellena su nombre: casi siempre es el
     mismo y volver a teclearlo solo introduce variantes ("Julio" vs "Julio Zea"). */
  function elegirPersona(id: string) {
    setProfileId(id);
    if (id !== SIN_CUENTA && !nombre.trim()) {
      setNombre(equipo.find((p) => p.id === id)?.nombre ?? "");
    }
  }

  function guardar() {
    const input: EmpleadoInput = {
      profile_id: profileId === SIN_CUENTA ? null : profileId,
      nombre,
      puesto,
      empresa_id: empresaId === FRESAFIT ? null : empresaId,
      esquema,
      monto: Math.max(0, aNumero(monto) ?? 0),
      periodicidad,
      dia_corte: diaCorte ? Math.trunc(aNumero(diaCorte) ?? 0) || null : null,
      situacion,
      activo,
      inicio: inicio || null,
      notas,
    };
    ejecutar(() => (empleado ? editarEmpleado(empleado.id, input) : crearEmpleado(input)), {
      ok: empleado ? "Datos actualizados." : "Persona agregada a la nómina.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!empleado) return;
    ejecutar(() => borrarEmpleado(empleado.id), {
      confirmar:
        "¿Borrar a esta persona de la nómina? Se van con ella sus pagos registrados. Si solo dejó de trabajar, mejor márcala como inactiva.",
      ok: "Persona borrada.",
      error: "No se pudo borrar.",
      alExito: onClose,
    });
  }

  const sit = obtenerSituacionLaboral(situacion);

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{empleado ? "Editar persona" : "Agregar a la nómina"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Cuenta del CRM</Label>
            <Select value={profileId} onValueChange={(v) => v && elegirPersona(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) =>
                    v === SIN_CUENTA
                      ? "No tiene cuenta"
                      : (equipo.find((p) => p.id === v)?.nombre ?? "Elegir")}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={SIN_CUENTA}>No tiene cuenta</SelectItem>
                {equipo.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[12px] text-muted-foreground">
              El personal de los lives y quien cobra por fuera no tiene cuenta: se captura solo
              con su nombre.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-nombre">Nombre</Label>
              <Input
                id="emp-nombre"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre completo"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-puesto">Puesto</Label>
              <Input
                id="emp-puesto"
                value={puesto}
                onChange={(e) => setPuesto(e.target.value)}
                placeholder="Diseño, lives, logística…"
              />
            </div>
          </div>

          {esAgencia && (
            <div className="flex flex-col gap-1.5">
              <Label>Se le carga a</Label>
              <Select value={empresaId} onValueChange={(v) => v && setEmpresaId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === FRESAFIT
                        ? "Fresafit"
                        : (empresas.find((e) => e.id === v)?.nombre ?? "Elegir")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={FRESAFIT}>Fresafit</SelectItem>
                  {empresas.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[12px] text-muted-foreground">
                Quien atiende a dos clientes lleva un renglón por cada uno: así el costo de
                cada contrato se ve por separado.
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Esquema</Label>
              <Select value={esquema} onValueChange={(v) => v && setEsquema(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => ESQUEMAS_PAGO.find((x) => x.id === v)?.nombre ?? "Esquema"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ESQUEMAS_PAGO.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-monto">Monto ($)</Label>
              <Input
                id="emp-monto"
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                value={monto}
                onChange={(e) => setMonto(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Cada cuándo</Label>
              <Select value={periodicidad} onValueChange={(v) => v && setPeriodicidad(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      PERIODICIDADES_PAGO.find((x) => x.id === v)?.nombre ?? "Periodicidad"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PERIODICIDADES_PAGO.map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-dia">Día de corte</Label>
              <Input
                id="emp-dia"
                type="number"
                min="1"
                max="31"
                step="1"
                placeholder="15"
                value={diaCorte}
                onChange={(e) => setDiaCorte(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Situación</Label>
            <Select value={situacion} onValueChange={(v) => v && setSituacion(v)}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v: string) =>
                    SITUACIONES_LABORALES.find((x) => x.id === v)?.nombre ?? "Situación"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {SITUACIONES_LABORALES.map((x) => (
                  <SelectItem key={x.id} value={x.id}>
                    {x.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {situacion === "sin_formalizar" && (
              <p className="text-[12px] leading-relaxed text-amber-700 dark:text-amber-500">
                Sin IMSS ni contrato de por medio. Aparece contado aparte en el panel para que no
                se pierda de vista.
              </p>
            )}
            {sit && situacion !== "sin_formalizar" && (
              <p className="text-[12px] text-muted-foreground">Registrada bajo {sit.nombre}.</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="emp-inicio">Entró el</Label>
              <DatePicker id="emp-inicio" value={inicio} onChange={setInicio} limpiable />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input
                type="checkbox"
                checked={activo}
                onChange={(e) => setActivo(e.target.checked)}
                className="size-4 accent-primary"
              />
              Sigue trabajando
            </label>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="emp-notas">Notas</Label>
            <Textarea
              id="emp-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Acuerdos, bonos, lo que haya que recordar"
            />
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={empleado ? "Guardar cambios" : "Agregar"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={empleado ? borrar : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
