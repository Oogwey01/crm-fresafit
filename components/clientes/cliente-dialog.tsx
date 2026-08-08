"use client";

import { useState } from "react";
import { Mail, Phone } from "lucide-react";
import { toast } from "sonner";
import {
  DialogoFormulario,
  Hero,
  Propiedades,
} from "@/components/compartido/dialogo-formulario";
import { Campo } from "@/components/compartido/campo";
import { CampoHero, DescripcionHero } from "@/components/compartido/campo-hero";
import {
  PastillaDato,
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import {
  PastillaPropiedad,
  useCerrarPastilla,
} from "@/components/compartido/pastilla-propiedad";
import { Input } from "@/components/ui/input";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { CANALES } from "@/lib/catalogos";
import { guardarCliente, borrarCliente, type ClienteInput } from "@/app/(app)/clientes/actions";
import type { CanalId, Customer } from "@/lib/types";
import type { LucideIcon } from "lucide-react";

const SIN_CANAL = "none";

/* Alta y edición de un cliente. Los que vienen de Tienda Nube se refrescan con
   cada importación: su nombre y contacto se administran en la tienda. */
export function ClienteDialog({
  cliente,
  gestor,
  onClose,
}: {
  cliente: Customer | null; // null = alta
  gestor: boolean;
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();
  const deTiendaNube = cliente?.tiendanube_customer_id != null;

  const [nombre, setNombre] = useState(cliente?.nombre ?? "");
  const [telefono, setTelefono] = useState(cliente?.telefono ?? "");
  const [correo, setCorreo] = useState(cliente?.correo ?? "");
  const [canal, setCanal] = useState<string>(cliente?.canal ?? SIN_CANAL);
  const [notas, setNotas] = useState(cliente?.notas ?? "");

  const opcionesCanal: { id: string; nombre: string; color?: string }[] = [
    { id: SIN_CANAL, nombre: "Sin canal" },
    ...CANALES,
  ];

  function guardar() {
    if (!nombre.trim()) {
      toast.error("El cliente necesita un nombre.");
      return;
    }
    const input: ClienteInput = {
      nombre,
      telefono,
      correo,
      canal: canal === SIN_CANAL ? null : (canal as CanalId),
      notas,
    };
    ejecutar(() => guardarCliente(cliente?.id ?? null, input), {
      ok: cliente ? "Cliente actualizado." : "Cliente creado.",
      error: "No se pudo guardar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  function borrar() {
    if (!cliente) return;
    ejecutar(() => borrarCliente(cliente.id), {
      confirmar: `¿Borrar a «${cliente.nombre}»? Sus compras se conservan, pero quedan sin cliente.`,
      ok: "Cliente borrado.",
      error: "No se pudo borrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  return (
    <DialogoFormulario
      titulo={cliente ? "Editar cliente" : "Nuevo cliente"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={cliente ? "Guardar cambios" : "Crear cliente"}
      pending={pending}
      onBorrar={cliente && gestor ? borrar : undefined}
      anchoEscritorio="md:max-w-lg"
    >
      <Hero
        pasoTitulo="¿Quién es?"
        valido={Boolean(nombre.trim())}
        motivoInvalido="El cliente necesita un nombre."
      >
        {deTiendaNube && (
          <p className="rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground md:mb-1">
            Cliente de Tienda Nube: su nombre y contacto se actualizan con cada importación (se
            administran en la tienda). Las notas sí son tuyas y no se pisan.
          </p>
        )}

        {/* El nombre de un cliente de Tienda Nube no se edita aquí: se pinta tal
            cual, sin caja, en lugar del input del hero. */}
        {deTiendaNube ? (
          <p className="font-heading text-lg font-semibold md:text-xl">{nombre}</p>
        ) : (
          <CampoHero
            id="cli-nombre"
            etiqueta="Nombre"
            placeholder="Nombre y apellido"
            valor={nombre}
            onCambio={setNombre}
          />
        )}
        <DescripcionHero
          id="cli-notas"
          etiqueta="Notas (mayoreo, atención especial…)"
          placeholder="Compra al mayoreo; pedir factura; contactar por WhatsApp… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades
        pasoTitulo="Contacto y canal"
        pasoAyuda={
          deTiendaNube
            ? "El teléfono y el correo se administran en la tienda; aquí solo se consultan."
            : undefined
        }
      >
        {deTiendaNube ? (
          <>
            <PastillaDato
              etiqueta="Teléfono"
              icono={Phone}
              valor={telefono || "Sin teléfono"}
              contenidoMovil={
                <Campo etiqueta="Teléfono" htmlFor="cli-telefono">
                  <Input id="cli-telefono" type="tel" disabled value={telefono} />
                </Campo>
              }
            />
            <PastillaDato
              etiqueta="Correo"
              icono={Mail}
              valor={correo || "Sin correo"}
              contenidoMovil={
                <Campo etiqueta="Correo" htmlFor="cli-correo">
                  <Input id="cli-correo" type="email" disabled value={correo} />
                </Campo>
              }
            />
          </>
        ) : (
          <>
            <PastillaContacto
              etiqueta="Teléfono"
              icono={Phone}
              tipo="tel"
              placeholder="+52 …"
              valor={telefono}
              onCambio={setTelefono}
              idMovil="cli-telefono"
            />
            <PastillaContacto
              etiqueta="Correo"
              icono={Mail}
              tipo="email"
              placeholder="cliente@correo.com"
              valor={correo}
              onCambio={setCorreo}
              idMovil="cli-correo"
            />
          </>
        )}
        <PastillaOpcion<string>
          etiqueta="Canal de origen"
          opciones={opcionesCanal}
          valor={canal}
          onCambio={setCanal}
          idMovil="cli-canal"
        />
      </Propiedades>
    </DialogoFormulario>
  );
}

/* Como PastillaEntrada, pero con type="tel" / type="email" en los inputs: la
   compartida solo maneja text/number y aquí importa el teclado que abre el
   teléfono. Vive en este archivo porque la infra compartida no se toca. */
function PastillaContacto({
  etiqueta,
  icono,
  tipo,
  placeholder,
  valor,
  onCambio,
  idMovil,
}: {
  etiqueta: string;
  icono?: LucideIcon;
  tipo: "tel" | "email";
  placeholder?: string;
  valor: string;
  onCambio: (v: string) => void;
  idMovil?: string;
}) {
  return (
    <PastillaPropiedad
      etiqueta={etiqueta}
      icono={icono}
      vacia={!valor}
      etiquetaVacia={etiqueta}
      valor={valor}
      textoValor={valor || undefined}
      contenidoMovil={
        <Campo etiqueta={etiqueta} opcional htmlFor={idMovil}>
          <Input
            id={idMovil}
            type={tipo}
            placeholder={placeholder}
            value={valor}
            onChange={(e) => onCambio(e.target.value)}
          />
        </Campo>
      }
    >
      <EntradaContacto
        etiqueta={etiqueta}
        tipo={tipo}
        placeholder={placeholder}
        valor={valor}
        onCambio={onCambio}
      />
    </PastillaPropiedad>
  );
}

function EntradaContacto({
  etiqueta,
  tipo,
  placeholder,
  valor,
  onCambio,
}: {
  etiqueta: string;
  tipo: "tel" | "email";
  placeholder?: string;
  valor: string;
  onCambio: (v: string) => void;
}) {
  const cerrar = useCerrarPastilla();
  return (
    <Input
      type={tipo}
      aria-label={etiqueta}
      placeholder={placeholder}
      value={valor}
      onChange={(e) => onCambio(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") cerrar();
      }}
      className="w-56"
    />
  );
}
