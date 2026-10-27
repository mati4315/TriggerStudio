# Instrucciones para asistentes y desarrolladores

Antes de cambiar este proyecto, lee [`docs/ARQUITECTURA_Y_DESARROLLO.md`](docs/ARQUITECTURA_Y_DESARROLLO.md). Esa guía describe el comportamiento que existe actualmente; los documentos antiguos de planificación pueden no coincidir con el código.

- El backend activo está en `server/src/`; la interfaz web canónica está en `server/public/index.html`; el overlay que se carga como fuente Navegador de OBS está en `server/public/overlay.html`.
- El lanzador normal es `lanzar_TriggerStudio.bat`. Este ejecuta `server/dist/index.js`, no TypeScript directamente. Después de modificar `server/src/*.ts`, ejecuta `npm run build` desde `server/` antes de iniciar el programa.
- `crear_instalador_TriggerStudio.bat` sincroniza el panel web a `client_extracted/dist/index.html`, empaqueta Electron y puede reemplazar la instalación local. Lee el script y confirma el destino antes de ejecutarlo.
- No leas, imprimas, copies ni documentes secretos de `server/.env`. Usa nombres de variables o valores ficticios. No guardes contraseñas de OBS, tokens ni datos de acceso en Markdown, logs o ejemplos.
- Conserva los cambios locales que ya existan. Revisa `git status` antes de editar y limita los cambios a lo necesario para la solicitud.
- No supongas que las dos PCs están en la misma LAN: `OBS_WS_URL` debe apuntar a una dirección que la PC del servidor pueda alcanzar, ya sea IP LAN o Tailscale. Consulta la guía para separar la conexión panel-servidor de la conexión servidor-OBS.
- El proyecto no tiene una suite de pruebas configurada. Para cambios de TypeScript, la comprobación básica disponible es `npm run build`; no afirmes que se probó en OBS si no hubo una sesión real conectada.
