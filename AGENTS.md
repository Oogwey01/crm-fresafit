<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Este CRM

Antes de escribir código aquí, lee [ARQUITECTURA.md](ARQUITECTURA.md): dónde va
cada cosa, cómo se consulta a Supabase sin que PostgREST te recorte los datos en
silencio, y las media docena de reglas que NO se tocan (empezando por el candado
de escritura a canales).

# Si vienes solo a mover la interfaz

Lee [ONBOARDING-UI.md](ONBOARDING-UI.md) antes de arrancar. En corto: la
interfaz vive en [components/](components/) y en las pantallas de
[app/](app/), y eso es lo que se toca. `lib/`, `app/api/` y
`supabase/migrations/` son la lógica del negocio, lo que habla con los canales
de venta y la forma de la base en producción: si un cambio visual te obliga a
entrar ahí, dilo en el pull request en vez de resolverlo por tu cuenta.

Nada sale a producción por push directo. Rama, pull request, y quien revisa
aprueba desde la liga de preview que deja Vercel.
