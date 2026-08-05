"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { guardarInfluencer, borrarInfluencer } from "@/app/(app)/influencers/actions";
import {
  ETAPAS_INFLUENCER,
  TIERS_INFLUENCER,
  obtenerEtapaInfluencer,
  obtenerTierInfluencer,
} from "@/lib/catalogos";
import { aNumero } from "@/lib/validacion";
import { formatearMXN } from "@/lib/moneda";
import type { EtapaInfluencerId, Influencer, TierInfluencerId } from "@/lib/types";

const SIN_TIER = "sin_tier";

/* Alta y edición de una ficha del programa. Los porcentajes y el crédito se
   dejan vacíos a propósito: en vacío rige lo del tier, y el placeholder enseña
   cuál es ese valor para no tener que escribirlo. */
export function InfluencerDialog({
  influencer,
  onClose,
}: {
  influencer: Influencer | null; // null = alta
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

  const tierElegido = obtenerTierInfluencer(tier);

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

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{influencer ? "Editar influencer" : "Nuevo influencer"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 flex flex-col gap-1.5">
              <Label htmlFor="inf-nombre">Nombre</Label>
              <Input
                id="inf-nombre"
                autoFocus
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Nombre completo"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-correo">Correo</Label>
              <Input id="inf-correo" value={correo} onChange={(e) => setCorreo(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-celular">Celular</Label>
              <Input id="inf-celular" value={celular} onChange={(e) => setCelular(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-ig">Instagram</Label>
              <Input id="inf-ig" placeholder="@usuario" value={ig} onChange={(e) => setIg(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-ig-seg">Seguidores IG</Label>
              <Input
                id="inf-ig-seg"
                type="number"
                min="0"
                value={igSeguidores}
                onChange={(e) => setIgSeguidores(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-tt">TikTok</Label>
              <Input
                id="inf-tt"
                placeholder="@usuario"
                value={tiktok}
                onChange={(e) => setTiktok(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-tt-seg">Seguidores TikTok</Label>
              <Input
                id="inf-tt-seg"
                type="number"
                min="0"
                value={tiktokSeguidores}
                onChange={(e) => setTiktokSeguidores(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label>Etapa</Label>
              <Select value={etapa} onValueChange={(v) => v && setEtapa(v as EtapaInfluencerId)}>
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) => obtenerEtapaInfluencer(v)?.nombre ?? "Etapa"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {ETAPAS_INFLUENCER.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.nombre}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Tier</Label>
              <Select
                value={tier ?? SIN_TIER}
                onValueChange={(v) => setTier(!v || v === SIN_TIER ? null : (v as TierInfluencerId))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {(v: string) =>
                      v === SIN_TIER ? "Sin asignar" : (obtenerTierInfluencer(v)?.nombre ?? "Tier")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={SIN_TIER}>Sin asignar</SelectItem>
                  {TIERS_INFLUENCER.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.nombre} · {t.seguidores}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-codigo">Código de descuento</Label>
              <Input
                id="inf-codigo"
                placeholder="MARIOFF10"
                className="font-mono"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value.toUpperCase())}
              />
            </div>
          </div>

          {tierElegido && (
            <p className="rounded-lg bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground">
              <b className="text-foreground">{tierElegido.nombre}</b> ofrece{" "}
              {tierElegido.creditoMensual != null
                ? `${formatearMXN(tierElegido.creditoMensual)} al mes en producto`
                : "catálogo completo"}
              , código al {tierElegido.descuentoPct}% y{" "}
              {tierElegido.comisionPct > 0
                ? `${tierElegido.comisionPct}% de comisión`
                : "sin comisión"}
              . {tierElegido.entregables}. Deja los campos de abajo vacíos para usar estos valores.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-desc">Descuento %</Label>
              <Input
                id="inf-desc"
                type="number"
                min="0"
                max="100"
                step="0.5"
                placeholder={tierElegido ? String(tierElegido.descuentoPct) : "—"}
                value={descuento}
                onChange={(e) => setDescuento(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-com">Comisión %</Label>
              <Input
                id="inf-com"
                type="number"
                min="0"
                max="100"
                step="0.5"
                placeholder={tierElegido ? String(tierElegido.comisionPct) : "—"}
                value={comision}
                onChange={(e) => setComision(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-credito">Crédito al mes</Label>
              <Input
                id="inf-credito"
                type="number"
                min="0"
                step="100"
                placeholder={tierElegido?.creditoMensual != null ? String(tierElegido.creditoMensual) : "—"}
                value={credito}
                onChange={(e) => setCredito(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="inf-prueba">Inicio de prueba</Label>
              <DatePicker id="inf-prueba" value={inicioPrueba} onChange={setInicioPrueba} limpiable />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inf-contenido">Tipo de contenido</Label>
            <Input
              id="inf-contenido"
              placeholder="Fitness, lifestyle, powerlifting…"
              value={tipoContenido}
              onChange={(e) => setTipoContenido(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="inf-notas">Notas</Label>
            <Textarea
              id="inf-notas"
              rows={2}
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              placeholder="Acuerdos, condiciones, seguimiento…"
            />
          </div>
        </div>

        <PieDialogoCRUD
          pending={pending}
          etiquetaGuardar={influencer ? "Guardar cambios" : "Registrar influencer"}
          onGuardar={guardar}
          onCancelar={onClose}
          onBorrar={influencer ? borrar : undefined}
        />
      </DialogContent>
    </Dialog>
  );
}
