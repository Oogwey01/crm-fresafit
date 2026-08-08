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
  PastillaInterruptor,
  PastillaOpcion,
  PastillaPersona,
} from "@/components/compartido/pastillas-campo";
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

  const opcionesEmpresa: { id: string; nombre: string; color?: string }[] = [
    { id: FRESAFIT, nombre: "Fresafit" },
    ...empresas.map((e) => ({ id: e.id, nombre: e.nombre, color: e.color })),
  ];

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
    <DialogoFormulario
      titulo={empleado ? "Editar persona" : "Agregar a la nómina"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={empleado ? "Guardar cambios" : "Agregar"}
      pending={pending}
      onBorrar={empleado ? borrar : undefined}
    >
      <Hero pasoTitulo="¿Quién entra a la nómina?">
        {/* La cuenta va primero: elegirla rellena el nombre de abajo. */}
        <div className="md:mb-1">
          <PastillaPersona
            etiqueta="Cuenta del CRM"
            equipo={equipo}
            valor={profileId}
            onCambio={elegirPersona}
            opcionNula={{ id: SIN_CUENTA, nombre: "No tiene cuenta" }}
            ayuda="El personal de los lives y quien cobra por fuera no tiene cuenta: se captura solo con su nombre."
          />
        </div>
        <CampoHero
          id="emp-nombre"
          etiqueta="Nombre"
          placeholder="Nombre completo"
          valor={nombre}
          onCambio={setNombre}
        />
        <DescripcionHero
          id="emp-notas"
          etiqueta="Notas"
          placeholder="Acuerdos, bonos, lo que haya que recordar (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades pasoTitulo="Puesto y situación">
        <PastillaEntrada
          etiqueta="Puesto"
          placeholder="Diseño, lives, logística…"
          valor={puesto}
          onCambio={setPuesto}
          opcional
          idMovil="emp-puesto"
        />
        {esAgencia && (
          <PastillaOpcion<string>
            etiqueta="Se le carga a"
            opciones={opcionesEmpresa}
            valor={empresaId}
            onCambio={setEmpresaId}
            ayuda="Quien atiende a dos clientes lleva un renglón por cada uno: así el costo de cada contrato se ve por separado."
          />
        )}
        <PastillaOpcion<string>
          etiqueta="Situación"
          opciones={SITUACIONES_LABORALES}
          valor={situacion}
          onCambio={setSituacion}
          ayuda={
            sit && situacion !== "sin_formalizar" ? `Registrada bajo ${sit.nombre}.` : undefined
          }
        />
        <PastillaFecha
          etiqueta="Entró el"
          etiquetaVacia="Entró el"
          valor={inicio}
          onCambio={setInicio}
          limpiable
        />
        <PastillaInterruptor etiqueta="Sigue trabajando" valor={activo} onCambio={setActivo} />
        {situacion === "sin_formalizar" && (
          <span className="w-full text-[12px] leading-relaxed text-amber-700 dark:text-amber-500">
            Sin IMSS ni contrato de por medio. Aparece contado aparte en el panel para que no se
            pierda de vista.
          </span>
        )}
      </Propiedades>

      <Propiedades pasoTitulo="¿Cómo se le paga?">
        <PastillaOpcion<string>
          etiqueta="Esquema"
          opciones={ESQUEMAS_PAGO}
          valor={esquema}
          onCambio={setEsquema}
        />
        <PastillaEntrada
          etiqueta="Monto ($)"
          tipo="number"
          prefijo="$"
          placeholder="0.00"
          valor={monto}
          onCambio={setMonto}
          idMovil="emp-monto"
        />
        <PastillaOpcion<string>
          etiqueta="Cada cuándo"
          opciones={PERIODICIDADES_PAGO}
          valor={periodicidad}
          onCambio={setPeriodicidad}
        />
        <PastillaEntrada
          etiqueta="Día de corte"
          tipo="number"
          placeholder="15"
          valor={diaCorte}
          onCambio={setDiaCorte}
          opcional
          idMovil="emp-dia"
        />
      </Propiedades>
    </DialogoFormulario>
  );
}
