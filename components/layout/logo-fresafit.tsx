import Image from "next/image";
import logoNegro from "@/public/Header_OG.png";
import logoBlanco from "@/public/logo-fresafit-blanco.png";
import { cn } from "@/lib/utils";

/* Wordmark de la marca. Son dos archivos (el mismo trazo en negro y en blanco)
   porque un PNG no se recolorea con CSS: el negro va sobre fondo claro y el
   blanco sobre oscuro, y se alternan con `dark:`. `tono="blanco"` lo fija
   cuando el fondo no depende del tema — el panel rosa del login, por ejemplo. */
export function LogoFresafit({
  className,
  tono = "auto",
  priority = false,
}: {
  className?: string;
  tono?: "auto" | "blanco";
  priority?: boolean;
}) {
  if (tono === "blanco") {
    return <Image src={logoBlanco} alt="Fresa Fit" priority={priority} className={className} />;
  }
  return (
    <>
      <Image
        src={logoNegro}
        alt="Fresa Fit"
        priority={priority}
        className={cn(className, "dark:hidden")}
      />
      {/* Duplicado para el tema oscuro: sin alt, para no leer la marca dos veces. */}
      <Image
        src={logoBlanco}
        alt=""
        aria-hidden
        priority={priority}
        className={cn(className, "hidden dark:block")}
      />
    </>
  );
}
