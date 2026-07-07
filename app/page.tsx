import { redirect } from "next/navigation";

/* La raíz siempre lleva al tablero de Tareas.
   El middleware ya redirige a /login a quien no tenga sesión. */
export default function Home() {
  redirect("/tareas");
}
