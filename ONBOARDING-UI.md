# Arrancar el CRM para trabajar en la interfaz

Esta guía es para quien entra a mover el diseño y la experiencia de uso del CRM
—colores, espaciados, tablas, formularios, cómo se navega— sin meterse con la
base de datos ni con las integraciones a los canales de venta.

## 1. Lo que necesitas instalado

- **Node.js 20 o superior** y **pnpm** (`npm install -g pnpm`).
- **git**.
- La **app de Claude** en tu computadora.

No hace falta el CLI de Supabase. El proyecto lo intenta usar al arrancar para
regenerar los tipos de la base, y si no lo encuentra sigue de largo con los que
ya vienen en el repo.

## 2. Bajar el proyecto

```bash
git clone https://github.com/Oogwey01/crm-fresafit.git
cd crm-fresafit
pnpm install
```

## 3. Las credenciales

Aarón te pasa un archivo `.env.local` ya recortado. Lo pones en la raíz del
proyecto y no lo compartes con nadie ni lo subes al repo (git ya lo ignora).

Ese archivo apunta a **FresaFit CRM Diseño**, una base aparte que es copia de
producción: los mismos pedidos, los mismos clientes, el mismo catálogo, para que
juzgues el diseño con volumen de verdad y no con tres filas de ejemplo. Lo que
hagas ahí no toca la operación real.

Tampoco trae los tokens de Tienda Nube, Mercado Libre ni TikTok, así que desde
tu máquina es imposible que un cambio tuyo escriba en las tiendas.

Si algún día la base se queda vieja, se refresca desde producción con
`scripts/clonar-datos-a-entorno.sh`.

## 4. Levantar la aplicación

```bash
pnpm dev
```

Abre <http://localhost:3000> y entra con el usuario que te den.

## 5. Cómo se entrega el trabajo

Nunca directo a `main`. Siempre así:

```bash
git checkout main && git pull          # partir de lo último
git checkout -b ui/nombre-del-cambio   # una rama por cambio
# … trabajas …
git add -A && git commit -m "descripción de lo que cambiaste"
git push -u origin ui/nombre-del-cambio
```

Después abres un Pull Request en GitHub. Vercel te va a dejar un comentario con
una liga de *preview*: esa liga es el cambio corriendo de verdad, y es la que
Aarón y Armando abren para revisar el diseño antes de aprobarlo. Cuando lo
aprueban y se mergea, sale a producción solo.

## 6. Ponle candados a tu Claude

En la raíz del proyecto:

```bash
cp .claude/settings.solo-ui.json .claude/settings.local.json
```

Eso le impide a Claude tocar la base de datos, correr los scripts de
mantenimiento o desplegar, y le pide confirmación antes de hacer commits o
tocar código de servidor. Es una red de seguridad, no una jaula: si algún día
necesitas algo de eso, se habla y se ajusta.

## 7. Lo que no se toca

- **`supabase/migrations/`** — cambia la forma de la base de datos en
  producción. No es territorio de interfaz.
- **`lib/`** y **`app/api/`** — la lógica del negocio y lo que habla con los
  canales de venta. Si un cambio de diseño te obliga a entrar ahí, coméntalo
  antes en el PR.
- **El candado de escritura a canales**, explicado en
  [ARQUITECTURA.md](ARQUITECTURA.md). El CRM lee de Tienda Nube, Mercado Libre
  y TikTok, pero no les escribe. Es la regla más importante del proyecto.

Todo lo demás —[components/](components/) y las pantallas de
[app/](app/)— es donde vive la interfaz y es tuyo para mejorar.
