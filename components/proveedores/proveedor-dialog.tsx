"use client";

import { useState } from "react";
import { Globe, Truck } from "lucide-react";
import { toast } from "sonner";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
  SeccionFormulario,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import { PastillaEntrada } from "@/components/compartido/pastillas-campo";
import { Input } from "@/components/ui/input";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import {
  guardarProveedor,
  borrarProveedor,
  type ProveedorInput,
} from "@/app/(app)/proveedores/actions";
import type { Supplier } from "@/lib/types";

/* Alta y edición de un proveedor. */
export function ProveedorDialog({
  proveedor,
  diasEntregaDefault,
  gestor,
  onClose,
}: {
  proveedor: Supplier | null; // null = alta
  /* El que usa «Qué pedir» cuando este proveedor no tiene el suyo capturado. */
  diasEntregaDefault: number;
  gestor: boolean;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const [nombre, setNombre] = useState(proveedor?.nombre ?? "");
  const [pais, setPais] = useState(proveedor?.pais ?? "");
  const [contacto, setContacto] = useState(proveedor?.contacto ?? "");
  const [telefono, setTelefono] = useState(proveedor?.telefono ?? "");
  const [correo, setCorreo] = useState(proveedor?.correo ?? "");
  const [diasEntrega, setDiasEntrega] = useState(proveedor?.dias_entrega?.toString() ?? "");
  const [notas, setNotas] = useState(proveedor?.notas ?? "");

  const diasValidos = (() => {
    if (diasEntrega.trim() === "") return true;
    const dias = Math.trunc(Number(diasEntrega));
    return Number.isFinite(dias) && dias >= 0;
  })();

  const datosContacto = [contacto, telefono, correo].filter((v) => v.trim()).length;

  function guardar() {
    if (!nombre.trim()) {
      toast.error("El proveedor necesita un nombre.");
      return;
    }
    const dias = diasEntrega.trim() === "" ? null : Math.trunc(Number(diasEntrega));
    if (dias !== null && (!Number.isFinite(dias) || dias < 0)) {
      toast.error("Los días de entrega deben ser un número de días.");
      return;
    }
    const input: ProveedorInput = { nombre, pais, contacto, telefono, correo, dias_entrega: dias, notas };
    ejecutar(() => guardarProveedor(proveedor?.id ?? null, input), {
      ok: proveedor ? "Proveedor actualizado." : "Proveedor creado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!proveedor) return;
    ejecutar(() => borrarProveedor(proveedor.id), {
      confirmar: `¿Borrar a «${proveedor.nombre}»? Sus pedidos se borran también.`,
      ok: "Proveedor borrado.",
      error: "No se pudo borrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <DialogoFormulario
      titulo={proveedor ? "Editar proveedor" : "Nuevo proveedor"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={proveedor ? "Guardar cambios" : "Crear proveedor"}
      pending={pending}
      onBorrar={proveedor && gestor ? borrar : undefined}
      anchoEscritorio="md:max-w-lg"
    >
      <Hero
        pasoTitulo="¿Quién es?"
        valido={Boolean(nombre.trim())}
        motivoInvalido="El proveedor necesita un nombre."
      >
        <CampoHero
          id="prov-nombre"
          etiqueta="Nombre"
          placeholder="Nancy"
          valor={nombre}
          onCambio={setNombre}
        />
        <DescripcionHero
          id="prov-notas"
          etiqueta="Notas (opcional)"
          placeholder="Qué surte, tiempos de entrega, condiciones… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades
        pasoTitulo="País y tiempos de entrega"
        valido={diasValidos}
        motivoInvalido="Los días de entrega deben ser un número de días."
      >
        <PastillaEntrada
          etiqueta="País"
          icono={Globe}
          placeholder="China / México…"
          valor={pais}
          onCambio={setPais}
          opcional
          idMovil="prov-pais"
        />
        <PastillaEntrada
          etiqueta="Tiempo aproximado de maquila y entrega (días)"
          icono={Truck}
          tipo="number"
          placeholder={String(diasEntregaDefault)}
          valor={diasEntrega}
          onCambio={setDiasEntrega}
          sufijo="días"
          opcional
          ayuda={`Desde que se hace el pedido hasta que entra a la bodega: maquila, producción, tránsito y aduana. Es lo que usa «Qué pedir» para avisar con tiempo; si se deja vacío se toman ${diasEntregaDefault} días (≈ 3 meses).`}
          idMovil="prov-dias"
        />
      </Propiedades>

      <SeccionFormulario
        titulo="Contacto"
        pasoTitulo="¿Cómo se le contacta?"
        contador={datosContacto || null}
        abiertaPorDefecto={datosContacto > 0}
      >
        <Campo
          etiqueta="Contacto (persona, WeChat, WhatsApp…)"
          htmlFor="prov-contacto"
          className="w-full"
        >
          <Input
            id="prov-contacto"
            placeholder="Nancy · WeChat: nancy_belts"
            value={contacto}
            onChange={(e) => setContacto(e.target.value)}
          />
        </Campo>

        <div className="grid w-full grid-cols-2 gap-3">
          <Campo etiqueta="Teléfono" htmlFor="prov-telefono">
            <Input
              id="prov-telefono"
              type="tel"
              placeholder="+52 …"
              value={telefono}
              onChange={(e) => setTelefono(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Correo" htmlFor="prov-correo">
            <Input
              id="prov-correo"
              type="email"
              placeholder="proveedor@correo.com"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
            />
          </Campo>
        </div>
      </SeccionFormulario>
    </DialogoFormulario>
  );
}
