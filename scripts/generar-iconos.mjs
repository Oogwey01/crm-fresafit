/* ============================================================================
   scripts/generar-iconos.mjs — El logo de la app, en todos sus tamaños
   ----------------------------------------------------------------------------
   La fuente es UNA sola: scripts/assets/logo-fresafit.png, la silueta oficial
   de la marca (negra sobre transparente, 1080×1080). De ahí salen todas las
   piezas que piden iOS, Android y los navegadores:

     app/icon.png          favicon que Next enlaza solo
     app/favicon.ico       navegadores viejos: 16/32/48 px, con la silueta más
                           grande porque a ese tamaño el margen se come el dibujo
     app/apple-icon.png    pantalla de inicio de iOS (180×180, fondo pleno:
                           iOS pinta de negro cualquier transparencia)
     public/icono-192.png  manifest de Android + avisos push (sw.js)
     public/icono-512.png  manifest de Android, normal y "maskable" — la fruta
                           cabe en el círculo seguro del 80% que recorta Android
     public/icono-badge.png  silueta blanca sobre transparente: Android la usa
                           como máscara monocroma en la barra de estado

   Del PNG fuente solo se aprovecha el canal alfa: la silueta se repinta de
   blanco y se apoya sobre el degradado rosa de la marca. Así el archivo puede
   cambiar de color mañana sin que estos íconos se enteren.

   Uso:  node scripts/generar-iconos.mjs
   (sharp no está en package.json: se toma prestado de Next, que lo trae.)
   ============================================================================ */

import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = createRequire(require.resolve("next/package.json"))("sharp");

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FUENTE = path.join(RAIZ, "scripts/assets/logo-fresafit.png");

/* --- Paleta ---------------------------------------------------------------- */

const DEGRADADO = `<linearGradient id="fondo" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f9639f"/>
      <stop offset="1" stop-color="#d42a72"/>
    </linearGradient>`;

/* Qué tanto del lado del lienzo ocupa la silueta, por pieza.
   0.70 no es un número bonito al azar: el dibujo es más alto que ancho, así que
   a esa escala su punto más lejano queda a ~180 px del centro, cómodamente
   dentro del círculo seguro de 204.8 px que Android recorta en los "maskable". */
const PROPORCION = { normal: 0.7, favicon: 0.86, badge: 0.94 };

/* --- Silueta --------------------------------------------------------------- */

/* Se lee el PNG en crudo para quedarnos solo con el alfa: todo píxel visible
   pasa a blanco, y los bordes suavizados conservan su transparencia parcial
   para que al posarse sobre el rosa no queden escalonados. */
async function siluetaBlanca() {
  const { data, info } = await sharp(FUENTE).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alfa = data[(y * width + x) * channels + 3];
      if (alfa <= 8) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) throw new Error(`El logo fuente salió vacío: ${FUENTE}`);

  for (let i = 0; i < data.length; i += channels) {
    data[i] = 255;
    data[i + 1] = 255;
    data[i + 2] = 255;
  }

  /* Recortado al dibujo: el margen que trae el archivo original es suyo, no
     nuestro, y aquí cada pieza decide cuánto aire quiere. */
  return sharp(data, { raw: { width, height, channels } })
    .extract({ left: minX, top: minY, width: maxX - minX + 1, height: maxY - minY + 1 })
    .png()
    .toBuffer();
}

const SILUETA = await siluetaBlanca();
const { width: SIL_ANCHO, height: SIL_ALTO } = await sharp(SILUETA).metadata();

/* La silueta se escala por su lado largo para que quepa completa, y luego se
   centra. `position: centre` de sharp reparte los sobrantes impares hacia
   abajo/derecha; medio píxel a esta escala no se ve. */
async function siluetaEscalada(tamano, proporcion) {
  const cabe = Math.round(tamano * proporcion);
  const escala = cabe / Math.max(SIL_ANCHO, SIL_ALTO);
  return sharp(SILUETA)
    .resize({
      width: Math.max(1, Math.round(SIL_ANCHO * escala)),
      height: Math.max(1, Math.round(SIL_ALTO * escala)),
      fit: "fill",
      kernel: "lanczos3",
    })
    .png()
    .toBuffer();
}

/* --- Rasterizado ----------------------------------------------------------- */

/* El fondo se rasteriza a la densidad del tamaño final en vez de escalar un PNG
   grande: librsvg dibuja el degradado directo al tamaño pedido. */
async function iconoConFondo(tamano, proporcion = PROPORCION.normal) {
  const fondo = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    ${DEGRADADO}
  </defs>
  <rect width="512" height="512" fill="url(#fondo)"/>
</svg>
`;
  return sharp(Buffer.from(fondo), { density: (72 * tamano) / 512 })
    .resize(tamano, tamano)
    .composite([{ input: await siluetaEscalada(tamano, proporcion), gravity: "centre" }])
    .png()
    .toBuffer();
}

/* El badge no lleva fondo: Android lo usa como máscara monocroma, así que solo
   importa el alfa. Va sobre lienzo transparente para respetar el cuadrado. */
async function iconoBadge(tamano) {
  return sharp({
    create: { width: tamano, height: tamano, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: await siluetaEscalada(tamano, PROPORCION.badge), gravity: "centre" }])
    .png()
    .toBuffer();
}

/* Un .ico moderno es solo un contenedor: cabecera + directorio + PNGs tal
   cual (todos los navegadores actuales leen entradas PNG). */
function ico(pngs) {
  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(1, 2); // tipo: ícono
  cabecera.writeUInt16LE(pngs.length, 4);

  const entradas = [];
  let offset = 6 + 16 * pngs.length;
  for (const { tamano, datos } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(tamano >= 256 ? 0 : tamano, 0);
    e.writeUInt8(tamano >= 256 ? 0 : tamano, 1);
    e.writeUInt16LE(1, 4); // planos
    e.writeUInt16LE(32, 6); // bits por pixel
    e.writeUInt32LE(datos.length, 8);
    e.writeUInt32LE(offset, 12);
    entradas.push(e);
    offset += datos.length;
  }
  return Buffer.concat([cabecera, ...entradas, ...pngs.map((p) => p.datos)]);
}

const salidas = [
  ["app/icon.png", await iconoConFondo(512)],
  ["app/apple-icon.png", await iconoConFondo(180)],
  ["public/icono-512.png", await iconoConFondo(512)],
  ["public/icono-192.png", await iconoConFondo(192)],
  ["public/icono-badge.png", await iconoBadge(96)],
  [
    "app/favicon.ico",
    ico(
      await Promise.all(
        [16, 32, 48].map(async (t) => ({
          tamano: t,
          datos: await iconoConFondo(t, PROPORCION.favicon),
        })),
      ),
    ),
  ],
];

for (const [relativa, datos] of salidas) {
  await writeFile(path.join(RAIZ, relativa), datos);
  console.log(`✓ ${relativa} (${datos.length.toLocaleString()} bytes)`);
}
