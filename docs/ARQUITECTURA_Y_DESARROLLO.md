# Trigger Studio: arquitectura, operación y desarrollo

Guía de referencia para mantener el proyecto. Describe el código actual de `server/` y cómo se conecta con OBS. Si un documento antiguo contradice esta guía o el código, prevalecen el código y esta guía.

## 1. Qué hace el programa

Trigger Studio es un panel web local para explorar una biblioteca de videos, GIFs, imágenes y audios, dispararlos en OBS y controlar la reproducción. El backend Node.js/TypeScript sirve el panel y los medios, mantiene una conexión WebSocket con OBS Studio y coordina los comandos mediante un WebSocket propio.

Hay tres piezas que conviene distinguir:

1. **Backend Trigger Studio**: corre en la PC donde está la biblioteca multimedia. Expone HTTP y WebSocket en el mismo puerto, normalmente `2188` al usar `lanzar_TriggerStudio.bat`.
2. **OBS Studio**: puede correr en esa PC o en otra. El backend se conecta al servidor OBS WebSocket, normalmente en el puerto `4455`.
3. **Clientes**: el panel de control puede abrirse en un navegador o en el contenedor Electron. `overlay.html` se carga como fuente **Navegador** dentro de OBS para presentar el medio servido por el backend.

Esquema de dos PCs recomendado:

```text
PC control / biblioteca                         PC con OBS
┌────────────────────────────┐     OBS WS      ┌────────────────────┐
│ TriggerStudio: HTTP + WS   │ ──────────────> │ OBS :4455          │
│ panel y archivos /media    │                 │ Browser Source     │
│ puerto :2188               │ <────────────── │ carga overlay.html │
└────────────────────────────┘   HTTP + WS     └────────────────────┘
```

Las PCs pueden comunicarse por una LAN o por Tailscale. No es obligatorio que estén en la misma subred si ambas tienen ruta de red entre sí. Usa la dirección que sea alcanzable desde la PC que ejecuta Trigger Studio.

## 2. Estructura y archivos importantes

| Archivo/carpeta | Responsabilidad |
| --- | --- |
| `server/src/index.ts` | Carga `.env`, configura Express, resuelve la carpeta multimedia, define las rutas HTTP e inicia HTTP/WebSocket. |
| `server/src/obsController.ts` | Cliente `obs-websocket-js` para OBS WebSocket v5: reconexión, fuentes, archivo, mute, volumen, reproducción y eventos de fin. |
| `server/src/websocketServer.ts` | Protocolo del panel/overlay, selección de fuentes, reproducción, estado activo, controles y mensajes broadcast. |
| `server/src/assetScanner.ts` | Escaneo recursivo y clasificación de los archivos multimedia. |
| `server/src/thumbnailGenerator.ts` | Genera miniaturas de video/GIF mediante FFmpeg; las guarda en `.thumbnails`. |
| `server/public/index.html` | Panel web canónico: galería, búsqueda, carpetas, filtros, disparador manual, estado OBS y dock de reproducción. |
| `server/public/overlay.html` | Página de reproducción para la fuente Navegador en OBS. Recibe estado/comandos y descarga medios por HTTP. |
| `server/.env.example` | Plantilla pública de configuración, sin credenciales reales. |
| `server/.env` | Configuración local con secretos; no se debe publicar ni copiar a documentación. Está ignorado por Git. |
| `server/media-folder.json` | Preferencia local de carpeta multimedia elegida desde el panel. Si existe, tiene prioridad sobre `MEDIA_PATH`. No debe compartirse como configuración genérica porque contiene una ruta propia de la PC. |
| `lanzar_TriggerStudio.bat` | Inicio normal del backend y apertura del panel local. |
| `client_extracted/main.cjs` | Contenedor Electron. En modo empaquetado abre `client_extracted/dist/index.html`; no inicia el backend. |
| `crear_instalador_TriggerStudio.bat` | Copia la interfaz canónica a `client_extracted`, crea `app.asar` y actualiza/crea el paquete Electron. |

`server/public/index.html` es la fuente de verdad del panel. El instalador sincroniza ese archivo con `client_extracted/dist/index.html`. No edites solo la copia empaquetada si el cambio debe quedar en el proyecto.

## 3. Configuración

Configura `server/.env` usando `server/.env.example` como plantilla. Variables leídas por el código:

| Variable | Uso |
| --- | --- |
| `PORT` | Puerto HTTP/WebSocket del backend. El código usa `3000` si no está definido; el `.bat` normal establece `2188` antes de iniciar. |
| `OBS_WS_URL` | URL del WebSocket de OBS, por ejemplo `ws://127.0.0.1:4455` en la misma PC o `ws://<IP_DE_OBS>:4455` si OBS está remoto. |
| `OBS_WS_PASSWORD` | Contraseña configurada en OBS WebSocket. Mantenerla solo en el `.env` local. |
| `MEDIA_PATH` | Carpeta raíz de la biblioteca multimedia. |
| `OBS_SCENE` | Escena objetivo opcional; sin ella se usa la escena de programa activa en OBS. |
| `OBS_SOURCE_VIDEO` | Fuente para video; valor predeterminado `Overlay_Main`. |
| `OBS_SOURCE_IMAGE` | Fuente para imágenes/GIF; valor predeterminado `GIF_Overlay`. |
| `OBS_SOURCE_AUDIO` | Fuente para audio; valor predeterminado `Sound_Effect`. |

`server/src/index.ts` carga primero `.env` y después busca `server/media-folder.json`. Si este JSON contiene una propiedad `mediaPath` válida, esa ruta sobrescribe `MEDIA_PATH`. Elegir una carpeta desde el panel guarda esa preferencia y cambia el escáner en caliente.

Si `MEDIA_PATH` está vacío, el backend usa `server/media`. Al iniciar crea las subcarpetas `videos`, `gifs`, `memes`, `overlays`, `sounds` y `noticias` que falten. La ruta debe existir y ser legible por la cuenta que ejecuta Node.

### Configurar OBS WebSocket

En OBS abre **Herramientas → Ajustes del servidor WebSocket**, activa el servidor, revisa el puerto y define una contraseña. Introduce la URL y la misma contraseña en el `.env` del backend. La conexión la inicia **Trigger Studio hacia OBS**; no se configura la URL de OBS en el panel web.

Para dos PCs:

- En `OBS_WS_URL`, usa la IP LAN de la PC de OBS cuando se comunican por la red local, o su IP Tailscale cuando se conectan por Tailscale.
- La PC del backend necesita salida hacia el puerto `4455` de OBS; el firewall de la PC de OBS debe permitir ese puerto en la red/perfil correspondiente.
- El navegador/dispositivo que abre el panel necesita alcanzar la PC del backend en `2188`; permite el puerto `2188` entrante en el firewall de esa PC.
- Si se usa Tailscale, ambos equipos deben estar conectados a la misma tailnet y usar la dirección Tailscale del equipo correspondiente. No uses `localhost` para llegar a otra PC.
- No publiques los puertos `2188` ni `4455` en Internet. El panel HTTP y el WebSocket de Trigger Studio no implementan autenticación propia; la contraseña del OBS protege únicamente la conexión backend→OBS.

## 4. Cómo se muestra el contenido en OBS

### Método recomendado para dos PCs: Browser Source

En la escena de OBS crea una fuente **Navegador** (normalmente `Overlay_Main`) con URL:

```text
http://<IP_O_HOST_DEL_BACKEND>:2188/overlay.html
```

Configura ancho y alto según el lienzo de OBS. Mantén activa la fuente cuando no se vea para que su WebSocket siga conectado. Si quieres controlar el audio desde el mezclador de OBS, habilita la opción de captura/control de audio correspondiente en la fuente.

El backend publica el archivo por `/media/<ruta-relativa>`. En este modo no es necesario copiar los archivos a la PC de OBS. Cuando la fuente es `browser_source`, `obsController.playAsset()` no intenta cambiarle el archivo: `websocketServer.ts` informa el medio a los clientes y `overlay.html` lo reproduce.

**Cuidado con duplicados:** el servidor difunde `media_state` a todos los clientes y `overlay.html` reproduce cualquier evento `playing`, incluso si `inputKind` es una fuente nativa. Si una escena tiene a la vez la fuente nativa de OBS y el overlay cargado, el mismo asset puede aparecer/reproducirse por ambas rutas. Mantén una sola ruta visual/audio activa o ajusta explícitamente el filtro de `inputKind` al cambiar esta arquitectura.

### Fuentes nativas de OBS

También se admiten fuentes `ffmpeg_source` (Fuente multimedia) y `image_source`. Para estas fuentes, el backend manda a OBS una ruta local al archivo que resolvió en la PC del servidor. Si OBS está en otra PC, esa ruta debe tener sentido también en esa computadora (por ejemplo, misma estructura de carpetas o una unidad compartida). Para evitar esa dependencia, usa Browser Source en el esquema de dos PCs.

El backend consulta el tipo de input de OBS. Si la fuente no existe en la escena, intenta crear un Scene Item con la fuente existente; es más fiable preparar las fuentes de antemano y asignarles los nombres configurados.

### Resolución de fuentes

- Video → `OBS_SOURCE_VIDEO` o `Overlay_Main`.
- Imagen/GIF → `OBS_SOURCE_IMAGE` o `GIF_Overlay`; si no está en la escena, cae a la fuente de video.
- Audio → `OBS_SOURCE_AUDIO` o `Sound_Effect`; si no está en la escena, cae a la fuente de video.
- Un comando puede incluir `sourceName` para seleccionar una fuente explícita.
- Sin `OBS_SCENE` ni `sceneName`, se consulta la escena de programa actual.

La clasificación de la biblioteca está en `assetScanner.ts`. Extensiones de video: `.mp4`, `.mkv`, `.webm`, `.avi`, `.mov`, `.m4v`; imagen: `.gif`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.bmp`; audio: `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac`, `.flac`. Las listas no están completamente centralizadas: `overlay.html` no clasifica actualmente `.avi`/`.m4v` como video y trata `.ogg` como video aunque el escáner también lo acepta como audio. Reconciliar las detecciones antes de depender de esos formatos en el Browser Source.

## 5. Recorrido de una reproducción

1. El panel pide `GET /api/assets` y construye las tarjetas usando rutas relativas a la carpeta multimedia.
2. El usuario pulsa una tarjeta o dispara un archivo manualmente. El panel manda `action: "play"` al WebSocket del backend.
3. `websocketServer.ts` resuelve el nombre/archivo, determina tipo y fuente, y confirma que existe dentro de `MEDIA_PATH`.
4. Las acciones de reproducir/parar se encolan. Al iniciar un nuevo medio, el servidor cancela los temporizadores anteriores y detiene/elimina el estado activo anterior: el diseño mantiene **un contenido a la vez**.
5. `OBSController.playAsset()` actualiza/reinicia fuentes nativas cuando corresponde, habilita el Scene Item y centra la fuente. Para Browser Source, el overlay recibe `media_state` y solicita `/media/...`.
6. Se emiten mensajes de estado para que panel y overlay actualicen la tarjeta, el dock de reproducción y el contenido visible.
7. OBS o el overlay informa que terminó. El backend limpia el estado y cualquier auto-stop asociado.

Los videos normales empiezan silenciados por defecto; noticias y audios empiezan con sonido. En las opciones avanzadas de cada video se puede cambiar si ese video empieza en silencio; la preferencia se guarda por asset en el almacenamiento local del navegador y se aplica al instante si el video ya está reproduciéndose. El mute del dock también actualiza esa preferencia. El volumen del dock está entre `0` y `200%`: fuentes nativas ajustan el input de OBS; en Browser Source se manda al reproductor del overlay (con Web Audio para amplificar por encima de 100%). Mute y reproducción también se propagan al overlay.

El dock inferior permite play/pausa, mute, volumen y seek. Su altura de escritorio es compacta (56 px); en móvil puede ocupar dos filas. Pulsar la tarjeta del video/audio que ya está activo alterna pausa/reproducción. El seek se envía al soltar el control. El overlay informa progreso desde el reproductor HTML; además, para inputs nativos el backend consulta el estado del input de OBS periódicamente.

`duration: 0` significa duración automática. En el estado actual hay un temporizador de 3 segundos para imágenes estáticas y 4 segundos para otros tipos no-video/no-audio, incluidos GIFs; un valor positivo recibido del panel define duración personalizada. Al vencer, el backend invoca `stopAsset()` y emite `hidden`; esto oculta el overlay Browser Source, pero una fuente nativa `image_source` puede seguir visible porque `stopAsset()` no deshabilita un Scene Item de imagen estática. Los videos y audios normalmente terminan según el evento de OBS o del reproductor.

## 6. HTTP y WebSocket

HTTP y WebSocket comparten el puerto configurado en `PORT`.

### HTTP

| Ruta | Uso |
| --- | --- |
| `GET /` | Panel de control (`server/public/index.html`). |
| `GET /overlay.html` | Overlay para la fuente Navegador de OBS. |
| `GET /api/assets` | Escanea y devuelve la biblioteca. |
| `GET /api/status` | Estado OBS, ruta multimedia y puerto del backend. |
| `POST /api/media/analyze` | Vuelve a leer tamaño exacto y fecha de modificación desde disco; recibe `{ "file": "videos/ejemplo.mp4" }`. La resolución la consulta el reproductor del panel con metadatos, sin iniciar reproducción. |
| `POST /api/media/compress` | Inicia la compresión de un video y devuelve un `jobId`. Acepta `{ "file": "videos/ejemplo.mov", "mode": "keep" | "720p" }`. Al finalizar reemplaza el original de forma transaccional. |
| `GET /api/media/compress/<jobId>` | Devuelve `status`, `progress`, `phase`, `error` y `result` para mostrar el progreso del trabajo. |
| `GET /media/<ruta-relativa>` | Sirve archivos de `MEDIA_PATH`, incluidas miniaturas de `.thumbnails`. |
| `POST /api/media-folder/select` | Abre selector de carpeta en Windows; solo acepta solicitudes originadas en localhost. Guarda `server/media-folder.json`. |
| `POST /api/media-folder/open` | Abre la carpeta en Explorer; solo acepta solicitudes locales. |

Se permite CORS desde cualquier origen. Las rutas de medios y los WebSocket no tienen autenticación de usuario. Usa la app en una red de confianza y limita acceso con firewall/Tailscale.

La compresión se ejecuta con el FFmpeg incluido en el backend. `keep` codifica H.264/AAC a calidad alta y conserva las dimensiones; `720p` limita el cuadro a 1280×720 (o 720×1280 en vertical), mantiene la proporción y no amplía videos pequeños. WebM se codifica con VP9/Opus para mantener un contenedor compatible. FFmpeg escribe primero un archivo temporal oculto y solo sustituye el original cuando finaliza correctamente; si falla, conserva el original. La interfaz consulta el progreso periódicamente y actualiza el catálogo al terminar. El resultado puede variar según el códec y la compresión del original.

### Mensajes WebSocket del panel → backend

El JSON lleva una propiedad `action`:

| Acción | Campos relevantes | Efecto |
| --- | --- | --- |
| `play` | `asset` (o `video`), `type`, `category`, `duration`, `mute`, opcional `sceneName`/`sourceName` | Reproduce un asset. `asset` es ruta relativa dentro de la biblioteca. |
| `stop` / `hide` | opcional `sourceName` | Con fuente detiene esa fuente; sin fuente ejecuta parada general. |
| `status` | — | Solicita estado de conexión y medios activos. |
| `mute` | `sourceName`, `mute` | Cambia mute del medio activo. |
| `volume` | `sourceName`, `volume` (0–200) | Cambia volumen del activo. |
| `playback` | `sourceName`, `playback: "play"\|"pause"` | Play/pausa. |
| `seek` | `sourceName`, `currentTime` en segundos | Busca una posición. |
| `progress` | `sourceName`, `asset`, `currentTime`, `duration`, `paused` | Informe de progreso del overlay. |
| `ended` | `sourceName`, `asset` | El overlay informa que terminó. |

Ejemplo mínimo:

```json
{"action":"play","asset":"videos/ejemplo.mp4","type":"video","category":"Videos","duration":0,"mute":true}
```

### Mensajes emitidos por el backend

El backend emite `status`, `success`, `warning`, `error`, `media_state`, `player_control`, `player_state`, `player_progress`, `volume` y `all_stopped`. `media_state` incluye fuente, archivo, tipo, tipo de input OBS, mute y volumen para sincronizar el dashboard y `overlay.html`. Cada `play` entra en la cola del servidor: detiene lo anterior (y deshabilita el Scene Item si era una fuente de imagen), difunde `all_stopped` con motivo `replace` y después inicia el nuevo medio. El overlay cancela la limpieza diferida anterior al recibir el siguiente medio para evitar borrar una selección nueva.

## 7. Catálogo y miniaturas

`AssetScanner` recorre `MEDIA_PATH` recursivamente. Ignora elementos ocultos (nombres que empiezan con `.`) y la carpeta `.thumbnails`. La categoría se obtiene de la primera carpeta; sin carpeta se usa `General`. El `folder` del asset se conserva para navegación y filtros y `sizeBytes` informa el tamaño actual del archivo. Al abrir las opciones de un video, el panel lee su resolución con metadatos HTML del reproductor sin iniciar la reproducción. El botón **Analizar archivo** vuelve a consultar `stat.size` en el servidor antes de comprimir y presenta el tamaño en MB decimales.

Las miniaturas de imágenes estáticas apuntan a la misma imagen. Para videos y GIFs, `ThumbnailGenerator` genera JPG en `MEDIA_PATH/.thumbnails` usando FFmpeg incluido por `@ffmpeg-installer/ffmpeg`. Para video toma un fotograma alrededor de 0.5 s; para GIF toma el primero. La generación es asíncrona, así que una miniatura puede aparecer tras actualizar el catálogo.

El panel tiene vista de carpetas navegables (activada por defecto), vista plana, filtros por tipo/noticias/favoritos, búsqueda por nombre/ruta/carpeta, breadcrumbs, actualización del catálogo y selector/abridor de carpeta. La estrella de cada archivo guarda o quita ese elemento de favoritos; el filtro **Favoritos** muestra una lista plana de todos los tipos de medio guardados. La lista se conserva en `localStorage` bajo la clave `trigger_favorite_assets_v1` y es propia del navegador/app. El engranaje junto al título de galería abre ajustes del encabezado (`.gallery-header`), ancho de tarjeta, tamaño de letra, alto de miniatura y separación; una barra sobre `#assets-grid` cambia rápidamente el ancho de las tarjetas para mostrar más o menos columnas. El tamaño del encabezado escala su título y los espacios entre filas; por defecto es 90%. Estas preferencias se guardan automáticamente con la clave `trigger_gallery_display_preferences_v1` en `localStorage` y son propias del navegador/app, no se sincronizan entre dispositivos. La configuración del host y el mute personalizado también son preferencias locales.

Cada tarjeta de video muestra un engranaje para abrir opciones avanzadas y un parlante para alternar rápidamente su preferencia predeterminada de mute. Desde las opciones se ven tamaño y resolución del original y la resolución estimada de salida según el modo; al finalizar también se muestran el tamaño y resolución reales. Se puede comprimir conservando resolución o limitarla a 720p para originales mayores. El video original se reemplaza al finalizar; el catálogo se actualiza con el mismo flujo del botón `btn-refresh`.

## 8. Ejecutar y desarrollar

### Inicio normal en Windows

Ejecuta `lanzar_TriggerStudio.bat` desde la raíz del proyecto. El script entra en `server/`, establece `PORT=2188`, comprueba Node y dependencias, crea `.env` desde `.env.example` si no existe, abre `http://localhost:2188/` y ejecuta `npm start`.

El `.bat` libera el puerto `2188` matando el PID que lo tenga ocupado. Antes de cambiarlo, recuerda que podría terminar otro programa que use ese puerto.

### Desarrollo backend

```powershell
cd "D:\plugins para mi OBS\Trigger Studio\server"
npm install
npm run dev
```

`npm run dev` ejecuta `src/index.ts` y respeta `PORT` existente en el entorno o `.env`. Para el modo compilado:

```powershell
npm run build
npm start
```

El script `build` compila TypeScript a `server/dist/`. El lanzador solo compila automáticamente cuando `dist/` no existe, así que después de cambiar `src/*.ts` hay que ejecutar `npm run build` explícitamente. No hay suite de pruebas configurada en `server/package.json`; `npm test` está definido como comando placeholder que falla intencionalmente.

### Panel Electron e instalador

`client_extracted/main.cjs` solo carga el panel: en modo empaquetado abre `dist/index.html`; en desarrollo intenta `http://localhost:5173`. El servidor backend se inicia aparte. Para sincronizar y empaquetar la interfaz, `crear_instalador_TriggerStudio.bat` copia `server/public/index.html` a `client_extracted/dist/index.html`, genera `app.asar`, puede reemplazar una instalación en `D:\Archivos de programa\TriggerStudio` y produce/actualiza una copia en `Instalador_TriggerStudio/`. Electron carga `resources/app.asar`; un `app.asar` suelto en la raíz no actualiza la aplicación. El script respalda el paquete portable anterior como `resources/app.asar.bak` antes de sustituirlo.

## 9. Diagnóstico por síntoma

### El panel conecta al servidor, pero OBS aparece desconectado

1. Comprueba que el servidor WebSocket esté activo en OBS y que el puerto/password coincidan con el `.env` local.
2. Confirma que `OBS_WS_URL` usa una IP accesible desde la PC donde corre Node. En la misma PC usa loopback; entre PCs usa LAN o Tailscale.
3. Desde la PC del backend prueba `Test-NetConnection <IP_DE_OBS> -Port 4455`. Desde el dispositivo del panel prueba `Test-NetConnection <IP_DEL_BACKEND> -Port 2188`.
4. Revisa firewall de Windows, que OBS esté abierto y que la URL no tenga un host/puerto antiguo.

### El catálogo está vacío o falta un archivo

Comprueba `/api/status` para ver la ruta de medios, revisa `server/media-folder.json` y `MEDIA_PATH`, pulsa Actualizar y confirma que la extensión esté en `AssetScanner`. El reproductor de OBS debe poder llegar a `http://<IP_DEL_BACKEND>:2188/media/...` si se usa Browser Source.

### El archivo aparece pero no se ve/se oye en OBS

Comprueba la escena activa, el nombre/tipo de input, visibilidad y URL del Browser Source. En dos PCs verifica acceso HTTP al backend desde la PC OBS y mantén la fuente Navegador activa. Para fuentes nativas, verifica que la ruta local sea válida en la PC de OBS. Videos comunes parten silenciados; revisa el mute del dock y el audio del Browser Source/mezclador.

El control de volumen afecta al input seleccionado por Trigger Studio. Si el sonido se captura por otra fuente independiente de OBS (por ejemplo, captura de salida de escritorio), esa fuente externa no queda asociada automáticamente al volumen del asset.

### Errores de navegador que no vienen de Trigger Studio

El código de este backend registra las rutas `/api/assets`, `/api/status` y `/api/media-folder/*`; no implementa `/api/cortex-home/obs-scenes` ni `/api/cortex-home/obs-live-status`. Un `503` en esas rutas pertenece a la otra aplicación/servicio que las publica (por ejemplo, Cortex en otro puerto), no al servidor Trigger Studio de `2188`. Un `favicon.ico` 404 aislado suele ser solo una solicitud de icono; Trigger Studio incluye SVGs y no depende de ese ICO para reproducir medios.

## 10. Límites y reglas de mantenimiento

- El registro `activeAssets`, los temporizadores y el volumen de Browser Source viven en memoria; reiniciar el backend los restablece. No hay base de datos.
- El modo actual permite un medio a la vez a nivel global; preservar la cola y la limpieza al modificar `play`, `stop` o `hide`.
- HTTP, `/media` y WebSocket no tienen autenticación propia. No abrirlos a Internet ni asumir que la contraseña de OBS protege el panel.
- Mantener sincronizadas las listas de extensiones de `assetScanner.ts`, `websocketServer.ts` y `overlay.html` al agregar formatos.
- Si cambian acciones WebSocket, actualizar juntos: `ClientMessage`, el backend, panel y overlay; mensajes serializados son la interfaz entre componentes.
- Al editar UI, modificar `server/public/index.html` y regenerar la copia Electron con el script de empaquetado cuando corresponda.
- No tratar `server/obs_info.txt`, `server/finalizado/paso1_backend.md` ni `crear TriggerStudio.md` como configuración actual: contienen diagnósticos o planes de etapas anteriores.
