/* ============================================================================
   scripts/generar-iconos.mjs — El logo de la app, en todos sus tamaños
   ----------------------------------------------------------------------------
   La fresa de Fresafit se dibuja UNA vez aquí (cuerpo, hojas y semillas como
   constantes) y de ahí salen todas las piezas que piden iOS, Android y los
   navegadores:

     app/icon.svg          favicon vectorial (Next lo enlaza solo)
     app/favicon.ico       navegadores viejos: 16/32/48 px, sin semillas porque
                           a ese tamaño se vuelven ruido
     app/apple-icon.png    pantalla de inicio de iOS (180×180, fondo pleno:
                           iOS pinta de negro cualquier transparencia)
     public/icono-192.png  manifest de Android + avisos push (sw.js)
     public/icono-512.png  manifest de Android, normal y "maskable" — la fruta
                           cabe en el círculo seguro del 80% que recorta Android
     public/icono-badge.png  silueta blanca sobre transparente: Android la usa
                           como máscara monocroma en la barra de estado

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

/* --- Geometría (lienzo de 512×512) --------------------------------------- */

const CUERPO =
  "M256 176 C196 168 128 186 124 252 C120 322 186 398 256 430 C326 398 392 322 388 252 C384 186 316 168 256 176 Z";

/* Una hoja en forma de gota apuntando hacia arriba; la corona son cinco copias
   giradas alrededor del mismo punto de anclaje, justo sobre la fruta. */
const HOJA = "M0 12 C-22 2 -28 -32 0 -62 C28 -32 22 2 0 12 Z";
const GIROS_HOJAS = [0, -32, 32, -64, 64];

/* [cx, cy, rx, ry] — colocadas a mano para seguir el estrechamiento del fruto. */
const SEMILLAS = [
  [208, 236, 11, 15], [256, 232, 11, 15], [304, 236, 11, 15],
  [184, 292, 11, 15], [232, 290, 11, 15], [280, 290, 11, 15], [328, 292, 11, 15],
  [208, 348, 11, 15], [256, 350, 11, 15], [304, 348, 11, 15],
  [232, 400, 10, 14], [280, 400, 10, 14],
];

const DEGRADADO = `<linearGradient id="fondo" x1="0" y1="0" x2="512" y2="512" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="#f9639f"/>
      <stop offset="1" stop-color="#d42a72"/>
    </linearGradient>`;

function fresa({ conSemillas }) {
  const hojas = GIROS_HOJAS.map(
    (g) => `<path transform="translate(256 172)${g ? ` rotate(${g})` : ""}" d="${HOJA}"/>`,
  ).join("\n      ");
  /* Las semillas van rellenas con el degradado del fondo para leerse como
     huecos calados en la fruta, no como puntos encima. */
  const semillas = conSemillas
    ? `\n    <g fill="url(#fondo)">
      ${SEMILLAS.map(([cx, cy, rx, ry]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`).join("\n      ")}
    </g>`
    : "";
  return `<g transform="rotate(-8 256 290)">
    <path fill="#fff" d="${CUERPO}"/>
    <g fill="#fff">
      ${hojas}
    </g>${semillas}
  </g>`;
}

function svgIcono({ conSemillas }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <!-- Generado por scripts/generar-iconos.mjs — editar ahí, no aquí. -->
  <defs>
    ${DEGRADADO}
  </defs>
  <rect width="512" height="512" fill="url(#fondo)"/>
  ${fresa({ conSemillas })}
</svg>
`;
}

/* Silueta suelta (sin fondo) agrandada para llenar el lienzo: como el badge no
   lleva fondo, el margen del ícono normal la haría verse diminuta. */
function svgBadge() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <g transform="translate(256 256) scale(1.3) translate(-256 -262)">
  ${fresa({ conSemillas: false })}
  </g>
</svg>
`;
}

/* --- Rasterizado ---------------------------------------------------------- */

/* Se rasteriza a la densidad del tamaño final en vez de escalar un PNG grande:
   librsvg dibuja las curvas directo al tamaño pedido y quedan más nítidas. */
function png(svg, tamano) {
  return sharp(Buffer.from(svg), { density: (72 * tamano) / 512 })
    .resize(tamano, tamano)
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

const completo = svgIcono({ conSemillas: true });
const simple = svgIcono({ conSemillas: false });

const salidas = [
  ["app/icon.svg", Buffer.from(completo)],
  ["app/apple-icon.png", await png(completo, 180)],
  ["public/icono-512.png", await png(completo, 512)],
  ["public/icono-192.png", await png(completo, 192)],
  ["public/icono-badge.png", await png(svgBadge(), 96)],
  [
    "app/favicon.ico",
    ico(
      await Promise.all(
        [16, 32, 48].map(async (t) => ({ tamano: t, datos: await png(simple, t) })),
      ),
    ),
  ],
];

for (const [relativa, datos] of salidas) {
  await writeFile(path.join(RAIZ, relativa), datos);
  console.log(`✓ ${relativa} (${datos.length.toLocaleString()} bytes)`);
}
