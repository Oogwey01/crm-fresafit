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
  PastillaOpcion,
} from "@/components/compartido/pastillas-campo";
import { Input } from "@/components/ui/input";
import { useAccionServidor } from "@/components/compartido/use-accion-servidor";
import { guardarInfluencer, borrarInfluencer } from "@/app/(app)/influencers/actions";
import {
  ETAPAS_INFLUENCER,
  TIERS_INFLUENCER,
  obtenerTierInfluencer,
} from "@/lib/catalogos";
import { aNumero } from "@/lib/validacion";
import { formatearMXN } from "@/lib/moneda";
import type { VistaDinero } from "@/lib/permisos-dinero";
import type { EtapaInfluencerId, Influencer, TierInfluencerId } from "@/lib/types";

const SIN_TIER = "sin_tier";

/* Alta y edición de una ficha del programa. Los porcentajes y el crédito se
   dejan vacíos a propósito: en vacío rige lo del tier, y el placeholder enseña
   cuál es ese valor para no tener que escribirlo. */
export function InfluencerDialog({
  influencer,
  dinero,
  onClose,
}: {
  influencer: Influencer | null;
  /* El crédito al mes es egreso: sin permiso, el campo no aparece al editar. */
  dinero: VistaDinero; // null = alta
  onClose: () => void;
}) {
  const { pending, ejecutar } = useAccionServidor();

  const [nombre, setNombre] = useState(influencer?.nombre ?? "");
  const [correo, setCorreo] = useState(influencer?.correo ?? "");
  const [celular, setCelular] = useState(influencer?.celular ?? "");
  const [ig, setIg] = useState(influencer?.ig_usuario ?? "");
  const [igSeguidores, setIgSeguidores] = useState(influencer?.ig_seguidores?.toString() ?? "");
  const [tiktok, setTiktok] = useState(influencer?.tiktok_usuario ?? "");
  const [tiktokSeguidores, setTiktokSeguidores] = useState(
    influencer?.tiktok_seguidores?.toString() ?? "",
  );
  const [tipoContenido, setTipoContenido] = useState(influencer?.tipo_contenido ?? "");
  const [etapa, setEtapa] = useState<EtapaInfluencerId>(influencer?.etapa ?? "prospecto");
  const [tier, setTier] = useState<TierInfluencerId | null>(influencer?.tier ?? null);
  const [codigo, setCodigo] = useState(influencer?.codigo ?? "");
  const [descuento, setDescuento] = useState(influencer?.descuento_pct?.toString() ?? "");
  const [comision, setComision] = useState(influencer?.comision_pct?.toString() ?? "");
  const [credito, setCredito] = useState(influencer?.credito_mensual?.toString() ?? "");
  const [inicioPrueba, setInicioPrueba] = useState(influencer?.inicio_prueba ?? "");
  const [notas, setNotas] = useState(influencer?.notas ?? "");

  /* Si la ficha ya trae redes o contacto, esas secciones nacen abiertas al
     editar. Capturado al montar: que abrir/cerrar no baile mientras se teclea. */
  const [redesAbiertas] = useState(() =>
    Boolean(influencer?.ig_usuario || influencer?.tiktok_usuario),
  );
  const [contactoAbierto] = useState(() => Boolean(influencer?.correo || influencer?.celular));

  const tierElegido = obtenerTierInfluencer(tier);

  const opcionesTier: { id: string; nombre: string; color?: string }[] = [
    { id: SIN_TIER, nombre: "Sin asignar" },
    ...TIERS_INFLUENCER.map((t) => ({
      id: t.id,
      nombre: `${t.nombre} · ${t.seguidores}`,
      color: t.color,
    })),
  ];

  function guardar() {
    ejecutar(
      () =>
        guardarInfluencer(influencer?.id ?? null, {
          nombre,
          correo,
          celular,
          ig_usuario: ig,
          ig_seguidores: aNumero(igSeguidores),
          tiktok_usuario: tiktok,
          tiktok_seguidores: aNumero(tiktokSeguidores),
          tipo_contenido: tipoContenido,
          etapa,
          tier,
          codigo,
          descuento_pct: aNumero(descuento),
          comision_pct: aNumero(comision),
          credito_mensual: aNumero(credito),
          inicio_prueba: inicioPrueba || null,
          notas,
        }),
      {
        ok: influencer ? "Ficha actualizada." : "Influencer registrado.",
        error: "No se pudo guardar. Revisa tu conexión.",
        alExito: onClose,
      },
    );
  }

  function borrar() {
    if (!influencer) return;
    ejecutar(() => borrarInfluencer(influencer.id), {
      confirmar: `¿Borrar a ${influencer.nombre}? Se van también sus entregas y evaluaciones.`,
      ok: "Ficha borrada.",
      error: "No se pudo borrar. Revisa tu conexión.",
      alExito: onClose,
    });
  }

  const redesLlenas = [ig, tiktok].filter((v) => v.trim()).length;
  const contactosLlenos = [correo, celular].filter((v) => v.trim()).length;

  return (
    <DialogoFormulario
      titulo={influencer ? "Editar influencer" : "Nuevo influencer"}
      onCerrar={onClose}
      onGuardar={guardar}
      etiquetaGuardar={influencer ? "Guardar cambios" : "Registrar influencer"}
      pending={pending}
      onBorrar={influencer ? borrar : undefined}
    >
      <Hero pasoTitulo="¿Quién es?">
        <CampoHero
          id="inf-nombre"
          etiqueta="Nombre"
          placeholder="Nombre completo"
          valor={nombre}
          onCambio={setNombre}
        />
        <DescripcionHero
          id="inf-notas"
          etiqueta="Notas"
          placeholder="Acuerdos, condiciones, seguimiento… (opcional)"
          valor={notas}
          onCambio={setNotas}
        />
      </Hero>

      <Propiedades
        pasoTitulo="El programa"
        pasoAyuda="Deja porcentajes y crédito vacíos para usar lo del tier."
      >
        <PastillaOpcion
          etiqueta="Etapa"
          opciones={ETAPAS_INFLUENCER}
          valor={etapa}
          onCambio={setEtapa}
        />
        <PastillaOpcion<string>
          etiqueta="Tier"
          opciones={opcionesTier}
          valor={tier ?? SIN_TIER}
          onCambio={(v) => setTier(v === SIN_TIER ? null : (v as TierInfluencerId))}
        />
        <PastillaEntrada
          etiqueta="Código de descuento"
          placeholder="MARIOFF10"
          valor={codigo}
          onCambio={(v) => setCodigo(v.toUpperCase())}
          opcional
          idMovil="inf-codigo"
        />
        <PastillaEntrada
          etiqueta="Descuento %"
          tipo="number"
          sufijo="%"
          placeholder={tierElegido ? String(tierElegido.descuentoPct) : "—"}
          valor={descuento}
          onCambio={setDescuento}
          opcional
          idMovil="inf-desc"
        />
        <PastillaEntrada
          etiqueta="Comisión %"
          tipo="number"
          sufijo="%"
          placeholder={tierElegido ? String(tierElegido.comisionPct) : "—"}
          valor={comision}
          onCambio={setComision}
          opcional
          idMovil="inf-com"
        />
        {/* El crédito es egreso: al editar, quien no lo ve tampoco lo
            recibió, y el campo vacío lo dejaría en nulo. Al dar de alta sí se
            pide. El servidor conserva el anterior de todas formas. */}
        {(dinero.egresos || !influencer) && (
          <PastillaEntrada
            etiqueta="Crédito al mes"
            tipo="number"
            prefijo="$"
            placeholder={
              tierElegido?.creditoMensual != null ? String(tierElegido.creditoMensual) : "—"
            }
            valor={credito}
            onCambio={setCredito}
            opcional
            idMovil="inf-credito"
          />
        )}
        <PastillaFecha
          etiqueta="Inicio de prueba"
          etiquetaVacia="Inicio de prueba"
          valor={inicioPrueba}
          onCambio={setInicioPrueba}
          limpiable
        />
        <PastillaEntrada
          etiqueta="Tipo de contenido"
          placeholder="Fitness, lifestyle, powerlifting…"
          valor={tipoContenido}
          onCambio={setTipoContenido}
          opcional
          idMovil="inf-contenido"
        />

        {tierElegido && (
          <p className="w-full rounded-lg bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground">
            <b className="text-foreground">{tierElegido.nombre}</b> ofrece{" "}
            {tierElegido.creditoMensual != null
              ? `${formatearMXN(tierElegido.creditoMensual)} al mes en producto`
              : "catálogo completo"}
            , código al {tierElegido.descuentoPct}% y{" "}
            {tierElegido.comisionPct > 0
              ? `${tierElegido.comisionPct}% de comisión`
              : "sin comisión"}
            . {tierElegido.entregables}. Deja porcentajes y crédito vacíos para usar estos valores.
          </p>
        )}
      </Propiedades>

      <SeccionFormulario
        titulo="Redes"
        pasoTitulo="Sus redes"
        pasoAyuda="Opcional: usuario y seguidores de cada red."
        contador={redesLlenas || null}
        abiertaPorDefecto={redesAbiertas}
      >
        <div className="grid w-full grid-cols-2 gap-3">
          <Campo etiqueta="Instagram" htmlFor="inf-ig" opcional>
            <Input
              id="inf-ig"
              placeholder="@usuario"
              value={ig}
              onChange={(e) => setIg(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Seguidores IG" htmlFor="inf-ig-seg" opcional>
            <Input
              id="inf-ig-seg"
              type="number"
              min="0"
              value={igSeguidores}
              onChange={(e) => setIgSeguidores(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="TikTok" htmlFor="inf-tt" opcional>
            <Input
              id="inf-tt"
              placeholder="@usuario"
              value={tiktok}
              onChange={(e) => setTiktok(e.target.value)}
            />
          </Campo>
          <Campo etiqueta="Seguidores TikTok" htmlFor="inf-tt-seg" opcional>
            <Input
              id="inf-tt-seg"
              type="number"
              min="0"
              value={tiktokSeguidores}
              onChange={(e) => setTiktokSeguidores(e.target.value)}
            />
          </Campo>
        </div>
      </SeccionFormulario>

      <SeccionFormulario
        titulo="Contacto"
        pasoTitulo="¿Cómo se le contacta?"
        pasoAyuda="Opcional: correo y celular."
        contador={contactosLlenos || null}
        abiertaPorDefecto={contactoAbierto}
      >
        <div className="grid w-full grid-cols-2 gap-3">
          <Campo etiqueta="Correo" htmlFor="inf-correo" opcional>
            <Input id="inf-correo" value={correo} onChange={(e) => setCorreo(e.target.value)} />
          </Campo>
          <Campo etiqueta="Celular" htmlFor="inf-celular" opcional>
            <Input id="inf-celular" value={celular} onChange={(e) => setCelular(e.target.value)} />
          </Campo>
        </div>
      </SeccionFormulario>
    </DialogoFormulario>
  );
}
