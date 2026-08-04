"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  olvidarDispositivo,
  registrarDispositivo,
  probarAvisoPush,
} from "@/app/(app)/tareas/push-actions";
import { cn } from "@/lib/utils";

/* ============================================================================
   Interruptor de avisos push para ESTE dispositivo.
   ----------------------------------------------------------------------------
   Los avisos push se conceden por navegador, no por cuenta: la laptop y el
   celular se activan cada uno por su lado, y por eso el botón habla de "este
   dispositivo" y no de "mis avisos".

   El permiso lo pide el navegador y solo lo entrega en respuesta a un clic de la
   persona; pedirlo al cargar la página es la forma más rápida de que lo nieguen
   para siempre. De ahí que esto sea un botón y no un efecto.
   ============================================================================ */

const SIN_SUSCRIPCION = () => () => {};

/* base64url (como viene la clave VAPID) → ArrayBuffer, que es lo que espera
   pushManager.subscribe. */
function claveAplicacion(base64: string): ArrayBuffer {
  const relleno = "=".repeat((4 - (base64.length % 4)) % 4);
  const normal = (base64 + relleno).replace(/-/g, "+").replace(/_/g, "/");
  const crudo = atob(normal);
  const bytes = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
  return bytes.buffer;
}

/* ArrayBuffer → base64url, para mandar las claves del navegador al servidor. */
function aBase64Url(buffer: ArrayBuffer | null): string {
  if (!buffer) return "";
  const bytes = new Uint8Array(buffer);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type Estado = "cargando" | "no_soportado" | "apagado" | "encendido" | "bloqueado";

export function AvisosPush() {
  const montado = useSyncExternalStore(
    SIN_SUSCRIPCION,
    () => true,
    () => false,
  );
  const [estado, setEstado] = useState<Estado>("cargando");
  const [trabajando, setTrabajando] = useState(false);

  /* Estado inicial: ¿el navegador puede?, ¿ya dio permiso?, ¿ya hay suscripción
     en ESTE dispositivo? Solo se puede saber preguntándole al navegador, así que
     va en un efecto —asíncrono, no un setState suelto— y hasta que responde se
     muestra el hueco. */
  useEffect(() => {
    let vigente = true;
    (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        if (vigente) setEstado("no_soportado");
        return;
      }
      if (Notification.permission === "denied") {
        if (vigente) setEstado("bloqueado");
        return;
      }
      try {
        const reg = await navigator.serviceWorker.getRegistration("/sw.js");
        const sub = await reg?.pushManager.getSubscription();
        if (vigente) setEstado(sub ? "encendido" : "apagado");
      } catch {
        if (vigente) setEstado("apagado");
      }
    })();
    return () => {
      vigente = false;
    };
  }, []);

  async function encender() {
    const clave = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!clave) {
      toast.error("Faltan las claves de avisos en el servidor.");
      return;
    }
    setTrabajando(true);
    try {
      const permiso = await Notification.requestPermission();
      if (permiso !== "granted") {
        setEstado(permiso === "denied" ? "bloqueado" : "apagado");
        toast.error("El navegador no dio permiso para los avisos.");
        return;
      }

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      /* Reutiliza la suscripción si ya existía: volver a suscribir con la misma
         clave devuelve la misma, y así el servidor solo renueva la fila. */
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: claveAplicacion(clave),
        }));

      const r = await registrarDispositivo(
        {
          endpoint: sub.endpoint,
          p256dh: aBase64Url(sub.getKey("p256dh")),
          auth: aBase64Url(sub.getKey("auth")),
        },
        navigator.userAgent,
      );
      if ("error" in r) {
        toast.error(r.error);
        return;
      }
      setEstado("encendido");
      toast.success("Avisos activados en este dispositivo.");
    } catch (e) {
      console.error("[push]", e);
      toast.error("No se pudieron activar los avisos aquí.");
    } finally {
      setTrabajando(false);
    }
  }

  async function apagar() {
    setTrabajando(true);
    try {
      const reg = await navigator.serviceWorker.getRegistration("/sw.js");
      const sub = await reg?.pushManager.getSubscription();
      if (sub) {
        await olvidarDispositivo(sub.endpoint);
        await sub.unsubscribe();
      }
      setEstado("apagado");
      toast.success("Este dispositivo ya no recibirá avisos.");
    } catch {
      toast.error("No se pudieron desactivar los avisos.");
    } finally {
      setTrabajando(false);
    }
  }

  async function probar() {
    setTrabajando(true);
    try {
      const r = await probarAvisoPush();
      if ("error" in r) toast.error(r.error);
      else toast.success("Aviso de prueba enviado.");
    } finally {
      setTrabajando(false);
    }
  }

  /* Hueco del mismo alto mientras se resuelve, para que el pie del menú no
     salte al hidratar. */
  if (!montado || estado === "cargando") return <div className="h-8" aria-hidden="true" />;
  if (estado === "no_soportado") return null;

  if (estado === "bloqueado") {
    return (
      <p className="flex items-center gap-1.5 px-1 py-1.5 text-[11.5px] text-muted-foreground">
        <BellOff className="size-3.5 shrink-0" strokeWidth={1.9} />
        Avisos bloqueados en este navegador; se habilitan desde el candado de la barra
        de direcciones.
      </p>
    );
  }

  const encendido = estado === "encendido";
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        onClick={encendido ? apagar : encender}
        disabled={trabajando}
        title={
          encendido
            ? "Dejar de recibir avisos en este dispositivo"
            : "Recibir avisos aunque el CRM esté cerrado"
        }
        className={cn(
          "flex flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-[12.5px] font-medium transition-colors disabled:opacity-60",
          encendido
            ? "bg-primary/10 text-primary hover:bg-primary/15"
            : "bg-muted text-muted-foreground hover:text-foreground",
        )}
      >
        {trabajando ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin" />
        ) : encendido ? (
          <BellRing className="size-3.5 shrink-0" strokeWidth={2} />
        ) : (
          <Bell className="size-3.5 shrink-0" strokeWidth={1.9} />
        )}
        <span className="truncate">{encendido ? "Avisos activos aquí" : "Activar avisos"}</span>
      </button>
      {encendido && (
        <button
          type="button"
          onClick={probar}
          disabled={trabajando}
          title="Mandarme un aviso de prueba"
          className="shrink-0 rounded-lg px-2 py-1.5 text-[11.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-60"
        >
          Probar
        </button>
      )}
    </div>
  );
}
