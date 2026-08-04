"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Loader2, Lock, Mail } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { LogoFresafit } from "@/components/logo-fresafit";
import { cn } from "@/lib/utils";

/* Marca de fresa (mismo trazo que el logo del sidebar), como SVG para que se
   vea nítida sobre el degradado del panel de marca. */
function FresaMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 21c-4.5-2.6-7.5-5.9-7.5-9.6C4.5 8.4 6.6 6.5 9 6.5c1.4 0 2.5.7 3 1.6.5-.9 1.6-1.6 3-1.6 2.4 0 4.5 1.9 4.5 4.9 0 3.7-3 7-7.5 9.6Z"
        fill="currentColor"
      />
      <path
        d="M11 3.2c.4 1 .1 2.1-.8 2.9M13.4 3.6c-.2 1 .3 2 1.3 2.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

/* Correo de Dirección (única fuente en lib/catalogos.ts → EQUIPO_SEED). */
const CORREO_DIRECCION = "armando@fresafit.com.mx";

/* Aviso de "te sacamos, no te trabaste": lo pone el layout de (app) al rebotar
   aquí con ?sesion=expirada. Vive en su propio componente porque
   useSearchParams() obliga a Next a esperar la petición para renderizar quien lo
   use; aislado así, el resto del login se sigue prerenderizando estático. */
function AvisoSesionExpirada() {
  if (useSearchParams().get("sesion") !== "expirada") return null;
  return (
    <p
      role="status"
      className="mb-5 rounded-xl border border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5 text-[13.5px] font-medium text-amber-700 dark:text-amber-400"
    >
      Tu sesión terminó. Vuelve a entrar para continuar.
    </p>
  );
}

const CLASE_INPUT =
  "w-full rounded-xl border border-input bg-background py-3 pl-11 pr-3.5 text-[14.5px] text-foreground outline-none transition-[border-color,box-shadow] placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/15";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verPassword, setVerPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCargando(true);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setError("Correo o contraseña incorrectos.");
      setCargando(false);
      return;
    }

    // Refrescar para que el middleware/servidor vean la sesión nueva.
    router.push("/tareas");
    router.refresh();
  }

  return (
    /* dvh y no screen: en el celular `screen` ignora la barra de direcciones y
       el login quedaba con scroll de más. */
    <div className="flex min-h-dvh w-full bg-lienzo">
      {/* Panel de marca (solo escritorio) */}
      <div
        className="relative hidden w-[48%] max-w-[720px] shrink-0 flex-col justify-between overflow-hidden p-14 text-white lg:flex"
        style={{
          background: "linear-gradient(150deg,#b01656 0%,var(--primary) 52%,#f0679f 100%)",
        }}
      >
        {/* Decoración: círculos suaves + semillas flotando */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -right-16 -top-20 size-[340px] rounded-full bg-white/[0.07]" />
          <div className="absolute -bottom-32 -left-20 size-[420px] rounded-full bg-white/[0.05]" />
          <FresaMark className="absolute left-[16%] top-[22%] size-11 animate-[floatSeed_7s_ease-in-out_infinite] text-white/[0.14] motion-reduce:animate-none" />
          <FresaMark className="absolute right-[20%] top-[60%] size-[30px] animate-[floatSeed_9s_ease-in-out_infinite_0.8s] text-white/[0.12] motion-reduce:animate-none" />
        </div>

        {/* Marca — el panel es rosa siempre, así que el wordmark va en blanco. */}
        <div className="relative">
          <LogoFresafit tono="blanco" priority className="h-8 w-auto" />
        </div>

        {/* Titular */}
        <div className="relative max-w-[440px]">
          <h2 className="font-heading text-[38px] font-bold leading-[1.12] tracking-[-0.8px]">
            Tu operación,
            <br />
            en un solo lugar.
          </h2>
          <p className="mt-4.5 text-[15.5px] leading-relaxed text-white/80">
            Tareas, inventario y métricas del negocio — sincronizado con Tienda Nube y siempre a la
            mano.
          </p>
        </div>

        {/* Pie */}
        <div className="relative text-[12.5px] text-white/60">
          Sistema interno · acceso restringido al equipo
        </div>
      </div>

      {/* Panel del formulario */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <div className="w-full max-w-[380px]">
          {/* Marca compacta (solo móvil) */}
          <div className="mb-8 lg:hidden">
            <LogoFresafit priority className="h-6 w-auto" />
          </div>

          <div className="mb-7">
            <h1 className="text-[27px] font-bold tracking-[-0.5px]">Inicia sesión</h1>
            <p className="mt-2 text-[14.5px] text-muted-foreground">
              Ingresa con tu correo del equipo para continuar.
            </p>
          </div>

          <Suspense fallback={null}>
            <AvisoSesionExpirada />
          </Suspense>

          <form onSubmit={onSubmit} noValidate>
            {/* Correo */}
            <label htmlFor="email" className="mb-2 block text-[13px] font-semibold text-foreground/80">
              Correo
            </label>
            <div className="relative mb-4.5 flex items-center">
              <Mail
                className="pointer-events-none absolute left-3.5 size-[17px] text-muted-foreground"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="tu@fresafit.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className={CLASE_INPUT}
              />
            </div>

            {/* Contraseña */}
            <div className="mb-2 flex items-center justify-between">
              <label htmlFor="password" className="text-[13px] font-semibold text-foreground/80">
                Contraseña
              </label>
              <a
                href={`mailto:${CORREO_DIRECCION}?subject=${encodeURIComponent(
                  "Restablecer contraseña — Sistema interno",
                )}`}
                className="text-[12.5px] font-semibold text-primary hover:underline"
              >
                ¿Olvidaste tu contraseña?
              </a>
            </div>
            <div className="relative mb-5 flex items-center">
              <Lock
                className="pointer-events-none absolute left-3.5 size-[17px] text-muted-foreground"
                strokeWidth={1.8}
                aria-hidden="true"
              />
              <input
                id="password"
                type={verPassword ? "text" : "password"}
                autoComplete="current-password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className={cn(CLASE_INPUT, "pr-11")}
              />
              <button
                type="button"
                onClick={() => setVerPassword((v) => !v)}
                aria-label={verPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                className="absolute right-2 flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                {verPassword ? (
                  <EyeOff className="size-[17px]" strokeWidth={1.8} aria-hidden="true" />
                ) : (
                  <Eye className="size-[17px]" strokeWidth={1.8} aria-hidden="true" />
                )}
              </button>
            </div>

            {error && (
              <p
                role="alert"
                className="mb-4 rounded-xl border border-destructive/20 bg-destructive/10 px-3.5 py-2.5 text-[13.5px] font-medium text-destructive"
              >
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={cargando}
              className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-primary py-3.5 text-[15px] font-semibold text-primary-foreground shadow-[0_10px_24px_-10px_rgba(232,67,147,0.75)] transition-[filter,opacity] hover:brightness-[1.06] disabled:cursor-not-allowed disabled:opacity-70"
            >
              {cargando ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Entrando…
                </>
              ) : (
                <>
                  Entrar
                  <ArrowRight className="size-4" strokeWidth={2.1} aria-hidden="true" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 text-center text-[12.5px] text-muted-foreground">
            ¿Problemas para entrar?{" "}
            <a
              href={`mailto:${CORREO_DIRECCION}?subject=${encodeURIComponent(
                "No puedo entrar al sistema interno",
              )}`}
              className="font-semibold text-primary hover:underline"
            >
              Escríbele a Dirección
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
