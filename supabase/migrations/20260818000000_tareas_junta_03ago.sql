-- ============================================================================
-- 20260818000000_tareas_junta_03ago.sql — Tareas de la junta del 03/08/2026
-- ----------------------------------------------------------------------------
-- Alta de las tareas que se acordaron en la junta de Los Locos del lunes
-- 03/08/2026 (Armando, Julio, Manuel, René y Aarón), transcritas del audio.
--
-- Acuerdo de la junta: TODO lo que no tenga fecha propia vence el jueves
-- 06/08/2026, que es cuando se revisan avances ("vamos a ver cómo trabajamos
-- en presión"). Las dos excepciones son el pago del CFE (martes 4, "sí o sí")
-- y las juntas, que van en su día y hora.
--
-- Requiere 20260817000000_tareas_coasignados.sql: varias de estas tareas son
-- de dos o tres personas.
--
-- Idempotente: se puede correr dos veces sin duplicar (se reconoce por título).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Las tareas
--
--    `responsable` y las personas se resuelven por prefijo del nombre, que en
--    este equipo es único (Julio, Manuel, Luna, Argelia, René, Diego, Aaron).
--    Quien delega es Armando: es quien reparte el trabajo en la junta, así que
--    es a él a quien deben volver los avisos de "atorado".
--
--    Los recordatorios de las juntas se ponen 30 min antes de la hora, no a la
--    hora en punto: el cron corre cada ~15 min y un aviso que llega cuando la
--    junta ya empezó no sirve de nada.
-- ---------------------------------------------------------------------------
with datos (
  titulo, descripcion, responsable, area, prioridad, etiquetas, fecha_limite, recordatorio
) as (
  values
  -- ---------------------------- Julio -------------------------------------
  (
    'Recomendaciones de lives (Fresafit y demás empresas)',
    E'Sacar la lista de todo lo que se tiene que hacer en un live para que funcione: qué dice María y qué dicen las buenas prácticas de TikTok Shop (mostrar el producto de cerca, ponérselo, quitárselo, etc.).\n\nEl entregable tiene que servir para Fresafit AHORA y quedar reutilizable para las demás empresas de la agencia.\n\nProductos prioritarios que se enseñan: muñequeras, straps, cinturones de hebilla de gimnasio y cinturones de palanca rígidos.',
    'Julio', 'contenido', 'alta', array['live','tiktok'], date '2026-08-06', null::timestamptz
  ),
  (
    'Bitácoras y estadísticas de los lives',
    E'Empezar a levantar bitácoras del proceso de los lives (Julio define si diarias, semanales o mensuales) para poder MEDIR y decidir con datos.\n\nQué registrar: GMV gastado, por qué hubo picos altos y por qué no, ventas, y todas las variables que se estén probando (si las chicas están sentadas o paradas, etc.).\n\nObjetivo: encontrar el punto de equilibrio / sweet spot para tomar decisiones en base al live.',
    'Julio', 'contenido', 'alta', array['live','tiktok'], date '2026-08-06', null::timestamptz
  ),
  (
    'Adaptar el estudio para que se vea de ventas',
    E'Acondicionar el estudio para que quien entre al live sepa de inmediato que es un estudio de VENTAS: que se vean los productos atrás, en frente y donde haga falta.\n\nVa en equipo con Manuel.',
    'Julio', 'contenido', 'media', array['live','locos'], date '2026-08-06', null::timestamptz
  ),
  (
    'Perseguir a María (nos está atrasando)',
    E'María no ha estado contestando y nos tiene detenidas varias tareas. Hay que buscarla, que nos apoye y nos ayude con lo que quedó pendiente.',
    'Julio', 'contenido', 'alta', array['urgente','bloqueado'], date '2026-08-06', null::timestamptz
  ),
  (
    'Investigar la protección de GMV',
    E'Qué pasa con el dinero cuando el GMV sale mal, como esta vez: el objetivo era 4 y promediamos como 2.\n\nInvestigar qué pasa si estamos así una semana: si ese dinero se reembolsa en créditos publicitarios, en créditos para que los clientes compren, o qué destino tiene.',
    'Julio', 'contenido', 'media', array['tiktok','publicidad'], date '2026-08-06', null::timestamptz
  ),

  -- --------------------------- Luna y Arge ---------------------------------
  (
    'Protocolo de las chicas en el live',
    E'Poner por escrito las reglas del live y cumplirlas. El live es de VENTAS, no de entretenimiento: el punto es vender, hay comisiones y ventas de por medio y nos afecta a todos.\n\nPuntos acordados:\n- Si hay gente coqueteando, no es nada más salir de la curiosidad: hay que poner límites.\n- Que NO se vea YouTube en el live; en la pantalla se ve el programa.\n\nJulio queda al pendiente de que se cumpla.',
    'Luna', 'contenido', 'alta', array['live','locos'], date '2026-08-06', null::timestamptz
  ),

  -- ----------------------------- Manuel ------------------------------------
  (
    'Proyecto de 90 días de contenido',
    E'Ver todo el proyecto de 90 días de contenido: la planeación general de principio a fin. Es lo que va a dar trabajo diario, así que hay que dejar armado el plan completo.',
    'Manuel', 'diseno', 'alta', array['video','guion'], date '2026-08-06', null::timestamptz
  ),
  (
    'Ver a Luisito para grabar y editar',
    E'Hablar con Luisito por el tema de grabar y editar, y traer cuál es su propuesta.',
    'Manuel', 'diseno', 'media', array['video'], date '2026-08-06', null::timestamptz
  ),
  (
    'Conseguir los manuales de identidad (Armando y Bart Jerseys)',
    E'Falta el manual de identidad de la imagen de Armando y el de Bart Jerseys.\n\nDe cada marca se piden DOS: el manual de la marca y el manual de creación de contenido.',
    'Manuel', 'diseno', 'media', array['grafico'], date '2026-08-06', null::timestamptz
  ),
  (
    'Flujo para generar creativos en automático',
    E'Armar el flujo que junte manual de identidad + ejemplos de creativos + elementos gráficos con un prompt y un generador, para que cambiando solo esas tres piezas salga el creativo de cualquier marca.\n\nPunto de partida: pedir a las marcas un catálogo en blanco y sobre eso hacer los formatos. La idea es partir de los formatos base ya definidos (antes y después, etc.) y que el flujo genere las variantes.\n\nDecidir de qué manera se resuelven los formatos: o genera cuadrado y vertical por separado, o genera vertical con la información centrada como si fuera cuadrado.\n\nEsto nos sirve para TODAS las empresas de la agencia.',
    'Manuel', 'diseno', 'media', array['grafico','locos'], date '2026-08-06', null::timestamptz
  ),

  -- ----------------------------- Armando -----------------------------------
  (
    'Checklist de arranque para empresas nuevas',
    E'Armar el checklist de todo lo que se le pide a cualquier empresa que entra, para no volver a improvisarlo cada vez: accesos, manual de identidad, manual de creación de contenido, etc.\n\nEs algo rutinario que aplica a todas las empresas de la agencia.',
    'Diego', 'direccion', 'media', array['locos','estrategia'], date '2026-08-06', null::timestamptz
  ),

  -- ------------------------------ Aarón ------------------------------------
  (
    'Dar de alta a Diana y los accesos de todo Fresafit',
    E'Diana no está en el CRM: hay que darla de alta como administradora.\n\nY todos los de Fresafit tienen que tener ya su contraseña y su perfil para poder entrar, cuando menos a ver las tareas.',
    'Aaron', 'tech', 'alta', array['urgente'], date '2026-08-06', null::timestamptz
  ),
  (
    'Aplicación estilo Revie (WhatsApp marketing)',
    E'Seguir con el desarrollo de la aplicación estilo Revie: WhatsApp marketing, reseñas, campañas y chatbot.',
    'Aaron', 'tech', 'media', array['mejora'], date '2026-08-06', null::timestamptz
  ),
  (
    'Migración de Shopify a Tienda Nube',
    E'Empezar a adelantar la migración de Shopify a Tienda Nube.',
    'Aaron', 'tech', 'media', array['integracion'], date '2026-08-06', null::timestamptz
  ),

  -- ------------------------------ René -------------------------------------
  (
    'Cubo: fulfillment',
    E'El fulfillment de Cubo. Es LA prioridad de René. Diego le pasa el enfoque.',
    'René', 'operaciones', 'alta', array['envio'], date '2026-08-06', null::timestamptz
  ),
  (
    'Mercado Libre Full',
    E'El tema de Mercado Libre Full.',
    'René', 'operaciones', 'alta', array['envio'], date '2026-08-06', null::timestamptz
  ),
  (
    'Pagar el CFE',
    E'Pagar el recibo de CFE el martes 4 de agosto, sí o sí.',
    'René', 'operaciones', 'alta', array['urgente','finanzas'], date '2026-08-04',
    (timestamp '2026-08-04 09:00' at time zone 'America/Mexico_City')
  ),

  -- ------------------------- Juntas y capacitaciones ------------------------
  (
    'Junta Armando + Aarón (10:00)',
    E'Junta del martes 4 de agosto a las 10:00 AM entre Armando (fundador) y Aarón (programador).',
    'Diego', 'direccion', 'alta', array['reunion'], date '2026-08-04',
    (timestamp '2026-08-04 09:30' at time zone 'America/Mexico_City')
  ),
  (
    'Junta Los Locos con Nutravia: regulatorios (15:00)',
    E'Junta del martes 4 de agosto a las 3:00 PM con Nutravia para el tema de REGULATORIOS.\n\n(Ojo: la capacitación de la nutrióloga NO es ésta, es el jueves a las 11:00.)',
    'Diego', 'direccion', 'alta', array['reunion','locos','cliente'], date '2026-08-04',
    (timestamp '2026-08-04 14:30' at time zone 'America/Mexico_City')
  ),
  (
    'Capacitación con la nutrióloga de Nutravia (11:00)',
    E'Jueves 6 de agosto a las 11:00 AM: capacitación que da la nutrióloga de Nutravia, en base a lo que queremos enseñar en los lives.',
    'Julio', 'contenido', 'alta', array['reunion','locos','cliente'], date '2026-08-06',
    (timestamp '2026-08-06 10:30' at time zone 'America/Mexico_City')
  ),
  (
    'Revisión de avances de todos los proyectos (jueves)',
    E'Nos juntamos el jueves 6 de agosto a ver avances de todos los proyectos, con calma y quedándonos un rato más para revisar bien.\n\nTodas las tareas de esta junta vencen ese día.',
    'Diego', 'direccion', 'media', array['reunion','locos'], date '2026-08-06',
    (timestamp '2026-08-06 09:00' at time zone 'America/Mexico_City')
  )
)
insert into public.tasks (
  titulo, descripcion, responsable_id, area, prioridad, estado,
  fecha_limite, fecha_inicio, recordatorio_at, etiquetas, created_by
)
select
  d.titulo,
  d.descripcion,
  resp.id,
  d.area,
  d.prioridad,
  'por_hacer',
  d.fecha_limite,
  date '2026-08-03',
  d.recordatorio,
  d.etiquetas,
  (select id from public.profiles where nombre ilike 'Diego%' limit 1)
from datos d
left join lateral (
  select id from public.profiles where nombre ilike d.responsable || '%' limit 1
) resp on true
where not exists (
  select 1 from public.tasks t where t.titulo = d.titulo
);

-- ---------------------------------------------------------------------------
-- 2) Quién más trabaja cada tarea (lo que en la junta se pidió como "que
--    involucre a dos personas"). El principal ya quedó en responsable_id.
-- ---------------------------------------------------------------------------
with pares (titulo, persona) as (
  values
  -- El estudio lo adaptan Julio y Manuel juntos.
  ('Adaptar el estudio para que se vea de ventas',            'Manuel'),
  -- El protocolo es de las dos chicas, con Julio vigilando que se cumpla.
  ('Protocolo de las chicas en el live',                      'Argelia'),
  ('Protocolo de las chicas en el live',                      'Julio'),
  -- La junta de las 10 es de Armando con Aarón.
  ('Junta Armando + Aarón (10:00)',                           'Aaron'),
  -- Las juntas con Nutravia son de Los Locos.
  ('Junta Los Locos con Nutravia: regulatorios (15:00)',      'Julio'),
  ('Junta Los Locos con Nutravia: regulatorios (15:00)',      'Manuel'),
  ('Capacitación con la nutrióloga de Nutravia (11:00)',      'Manuel'),
  ('Capacitación con la nutrióloga de Nutravia (11:00)',      'Luna'),
  ('Capacitación con la nutrióloga de Nutravia (11:00)',      'Argelia'),
  -- La revisión del jueves es de todos los que traen proyecto.
  ('Revisión de avances de todos los proyectos (jueves)',     'Julio'),
  ('Revisión de avances de todos los proyectos (jueves)',     'Manuel'),
  ('Revisión de avances de todos los proyectos (jueves)',     'René'),
  ('Revisión de avances de todos los proyectos (jueves)',     'Aaron')
)
insert into public.task_assignees (task_id, user_id)
select t.id, p.id
from pares x
join public.tasks t
  on t.titulo = x.titulo and t.deleted_at is null
join lateral (
  select id from public.profiles where nombre ilike x.persona || '%' limit 1
) p on true
on conflict (task_id, user_id) do nothing;

notify pgrst, 'reload schema';
