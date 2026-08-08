"use client";

import { useState } from "react";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
  SeccionFormulario,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaEntrada,
  PastillaFecha,
  PastillaInterruptor,
} from "@/components/compartido/pastillas-campo";
import {
  PastillaPropiedad,
  useCerrarPastilla,
} from "@/components/compartido/pastilla-propiedad";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

  const datosContacto = [contactoNombre, contactoCorreo, contactoTelefono].filter((v) =>
    v.trim(),
  ).length;

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
    <DialogoFormulario
      titulo={empresa ? "Editar empresa" : "Nueva empresa"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={empresa ? "Guardar cambios" : "Crear empresa"}
      pending={pending}
      onBorrar={empresa ? borrar : undefined}
    >
      <Hero pasoTitulo="¿Qué empresa es?">
        <CampoHero
          id="emp-nombre"
          etiqueta="Nombre"
          placeholder="Nutravia, Bart Jerseys…"
          valor={nombre}
          onCambio={setNombre}
        />
        <DescripcionHero
          id="emp-notas"
          etiqueta="Notas"
          placeholder="Lo que haya que recordar de esta cuenta (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades pasoTitulo="La cuenta">
        <PastillaEntrada
          etiqueta="Giro"
          placeholder="Suplementos, playeras…"
          valor={giro}
          onCambio={setGiro}
          opcional
          idMovil="emp-giro"
        />
        <PastillaFecha
          etiqueta="Cliente desde"
          etiquetaVacia="Cliente desde"
          valor={inicio}
          onCambio={setInicio}
        />
        <PastillaColor valor={color} onCambio={setColor} />
        <PastillaInterruptor etiqueta="Cliente activo" valor={activa} onCambio={setActiva} />
        <span className="w-full text-[12.5px] leading-relaxed text-muted-foreground md:hidden">
          Al apagar «Cliente activo» deja de contar en los totales, pero conserva su historial de
          cobros y reportes.
        </span>
      </Propiedades>

      <SeccionFormulario
        titulo="Contacto"
        pasoTitulo="¿Con quién se trata?"
        contador={datosContacto || null}
        abiertaPorDefecto={datosContacto > 0}
      >
        <Campo etiqueta="Contacto" htmlFor="emp-contacto" className="w-full">
          <Input
            id="emp-contacto"
            placeholder="Con quién se trata"
            value={contactoNombre}
            onChange={(e) => setContactoNombre(e.target.value)}
          />
        </Campo>
        <div className="grid w-full grid-cols-2 gap-3">
          <Campo etiqueta="Correo" htmlFor="emp-correo">
            <Input
              id="emp-correo"
              type="email"
              placeholder="correo@empresa.com"
              value={contactoCorreo}
              onChange={(e) => setContactoCorreo(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Teléfono" htmlFor="emp-telefono">
            <Input
              id="emp-telefono"
              placeholder="Teléfono"
              value={contactoTelefono}
              onChange={(e) => setContactoTelefono(e.target.value)}
            />
          </Campo>
        </div>
      </SeccionFormulario>
    </DialogoFormulario>
  );
}

/* Pastilla a la medida para la paleta corta: el popover (y el campo móvil)
   enseñan los mismos siete cuadritos de siempre. */
function PastillaColor({ valor, onCambio }: { valor: string; onCambio: (c: string) => void }) {
  return (
    <PastillaPropiedad
      etiqueta="Color"
      valor={
        <span className="flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-full"
            style={{ backgroundColor: valor }}
            aria-hidden="true"
          />
          Color
        </span>
      }
      textoValor={valor}
      color={valor}
      contenidoMovil={
        <div className="flex flex-col gap-1.5">
          <Label>Color</Label>
          <SwatchesColor valor={valor} onCambio={onCambio} />
        </div>
      }
    >
      <SwatchesColor valor={valor} onCambio={onCambio} />
    </PastillaPropiedad>
  );
}

/* Fuera del popover useCerrarPastilla devuelve un noop, así que el mismo
   componente sirve para el campo móvil sin cerrar nada. */
function SwatchesColor({ valor, onCambio }: { valor: string; onCambio: (c: string) => void }) {
  const cerrar = useCerrarPastilla();
  return (
    <div className="flex gap-2 py-1">
      {COLORES.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => {
            onCambio(c);
            cerrar();
          }}
          aria-label={`Color ${c}`}
          aria-pressed={valor === c}
          className={cn(
            "size-7 rounded-lg transition-transform",
            valor === c && "ring-2 ring-foreground ring-offset-2 ring-offset-background",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
    </div>
  );
}
