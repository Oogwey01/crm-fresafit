import { redirect } from "next/navigation";
import { PANELES_CANAL } from "@/lib/catalogos";

/* El módulo no tiene portada propia: entrar a /canales lleva a la primera
   plataforma disponible. Una pantalla intermedia con tres tarjetas para elegir
   sería un clic de más para llegar siempre al mismo lado. */
export default function CanalesPage() {
  redirect(PANELES_CANAL.find((p) => p.activo)!.href);
}
