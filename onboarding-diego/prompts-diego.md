# Qué le pega Diego a su Claude

## 1. La primera vez (una sola vez, al abrir el proyecto)

> Voy a trabajar en el diseño y la experiencia de uso del CRM de Fresafit, y es
> la primera vez que abro este proyecto en esta computadora.
>
> Antes de tocar nada, lee `ONBOARDING-UI.md` y `AGENTS.md`. Después haz el
> arranque que ahí se describe: copia `.claude/settings.solo-ui.json` a
> `.claude/settings.local.json`, instala las dependencias con pnpm, levanta la
> aplicación y dime en qué dirección la abro.
>
> El archivo `.env.local` ya está en la raíz: no lo abras, no lo cambies y no me
> lo muestres.
>
> Cuando esté corriendo, hazme un recorrido por las pantallas que tiene el CRM y
> dime cuáles son las que más se usan, para saber por dónde empezar.

## 2. Cada cambio que vaya a hacer

> Quiero cambiar ___________ en la pantalla de ___________.
>
> Empieza creando una rama con `git checkout -b ui/nombre-corto` partiendo de
> `main` actualizado. Trabaja solo en `components/` y en las pantallas de
> `app/`; si el cambio te obliga a entrar a `lib/` o a `app/api/`, párate y
> dímelo antes.
>
> Cuando termines, levanta la aplicación para que yo lo vea en el navegador. Si
> me gusta, haz el commit, sube la rama y abre el pull request.

## 3. Si algo se rompe

> La aplicación dejó de levantar / la pantalla ___________ marca error.
> Lee el error completo, dime en una frase qué pasó y arréglalo si es de la
> interfaz. Si el problema está en la base de datos o en las integraciones,
> **no** lo toques: avísame y yo lo escalo.

---

## Ver los cambios

**Mientras trabaja** — la aplicación corriendo en su máquina, en
<http://localhost:3000>. Es donde ve cada ajuste al instante.

**Para enseñárselos a alguien más** — cada pull request que abra genera una
liga de preview de Vercel: la aplicación completa, desplegada, en una URL que
se puede abrir desde cualquier celular. Esa es la liga que se le manda a
Armando para que apruebe el diseño antes de que nada llegue a producción.

Si algún día Diego quiere enseñar algo sin abrir un pull request, la otra vía
es una captura o una grabación de pantalla de su `localhost:3000`.
