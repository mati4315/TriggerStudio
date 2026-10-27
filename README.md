# Trigger Studio

Panel local/remoto para explorar medios y controlar su reproducción en OBS Studio.

## Inicio rápido en Windows

1. Instala Node.js y abre OBS con su servidor WebSocket habilitado (normalmente puerto `4455`).
2. Copia `server/.env.example` como `server/.env` y completa `OBS_WS_URL`, `OBS_WS_PASSWORD` y `MEDIA_PATH`. No compartas ni subas `server/.env`.
3. Ejecuta `lanzar_TriggerStudio.bat`. El panel abre en `http://localhost:2188/`.
4. Para usarlo desde otra PC, abre `http://<IP_DEL_BACKEND>:2188/`. Configura el Browser Source de OBS con `http://<IP_DEL_BACKEND>:2188/overlay.html` si usas reproducción web.

Para cambiar el código, empieza por [`AGENTS.md`](AGENTS.md) y después lee [`docs/ARQUITECTURA_Y_DESARROLLO.md`](docs/ARQUITECTURA_Y_DESARROLLO.md). Esa guía contiene mapa de archivos, configuración, comunicación HTTP/WebSocket, conexión por LAN/Tailscale, reproducción, empaquetado y solución de problemas.

`GUIA_OPCION_2_DOS_PCS.md` y otros documentos de etapas iniciales son referencias históricas; pueden contener ejemplos de red que ya no coinciden con tu instalación. La guía técnica de `docs/` es la referencia actual.
