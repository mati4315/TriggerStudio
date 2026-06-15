# TriggerStudio - Paso 1: Backend & Conexión a OBS

Hemos completado el **Paso 1** para el desarrollo de **TriggerStudio**. Este paso implementa la base del Backend en **Node.js + TypeScript** que se comunica con OBS Studio a través de WebSockets y expone un servidor WebSocket local y una interfaz de control web minimalista para validar el flujo.

---

## 🛠️ Estructura del Backend Creada

La estructura del proyecto dentro de la carpeta `server/` quedó de la siguiente manera:

*   **`src/obsController.ts`**: Gestiona la conexión con el WebSocket de OBS Studio (v5), maneja las reconexiones automáticas si se cae OBS, y expone métodos para cambiar configuraciones de archivo y visibilidad en fuentes multimedia de OBS.
*   **`src/websocketServer.ts`**: Servidor WebSocket local que escucha comandos enviados desde los controladores (ej. PC2 o panel de testeo) y los procesa en llamadas a OBS.
*   **`src/assetScanner.ts`**: Escanea recursivamente el directorio de medios (`media/` o `D:/OBS_MEDIA/`) para catalogar de forma dinámica todos los videos, GIFs e imágenes que se pueden disparar.
*   **`src/index.ts`**: Punto de entrada del servidor. Une Express, el WebSocket y la lógica de inicio. Además crea la estructura de directorios necesaria automáticamente.
*   **`public/index.html`**: Panel de control interactivo con estética premium glassmorphic, visualización dinámica de archivos y disparador manual para pruebas locales o remotas en la LAN.

---

## ⚙️ Configuración Previa en OBS Studio

Para que el backend pueda controlar tu OBS, debés tener configurado el servidor WebSocket en OBS Studio:

1.  Abre **OBS Studio (v30 o superior)**.
2.  Ve a **Herramientas (Tools)** ➜ **Ajustes del servidor WebSocket (WebSocket Server Settings)**.
3.  Asegúrate de marcar **Habilitar servidor WebSocket (Enable WebSocket server)**.
4.  Configura el puerto en **4455** (por defecto).
5.  Copia la **Contraseña (Password)**.

---

## 🚀 Cómo Iniciar el Backend

Sigue estos pasos para arrancar el servidor:

### 1. Configurar las Variables de Entorno (`.env`)
Abre el archivo `server/.env` y configura tus credenciales:
```env
PORT=3000
OBS_WS_URL=ws://127.0.0.1:4455
OBS_WS_PASSWORD=PEGAR_AQUI_LA_CONTRASENA_DE_OBS
MEDIA_PATH=D:/OBS_MEDIA
```
> [!NOTE]
> Si la ruta `D:/OBS_MEDIA` no existe, el servidor creará y usará automáticamente una carpeta local llamada `server/media` con subcarpetas para facilitar las pruebas.

### 2. Levantar el Servidor en Modo Desarrollo
Abre tu consola en la carpeta `server/` y ejecuta:
```powershell
npm run dev
```

El backend imprimirá logs detallados sobre la conexión con el WebSocket de OBS y el inicio del servidor en el puerto `3000`.

---

## 🧪 Cómo Realizar la Prueba de Control (Paso 1)

1.  Abre OBS Studio.
2.  Crea una escena llamada `FUNNY_OVERLAYS` (o el nombre que prefieras, configurable en variables de entorno).
3.  Dentro de esa escena, agrega una fuente de tipo **Fuente multimedia (Media Source)** llamada `Overlay_Main`.
4.  Abre un navegador (en la misma PC o en otra notebook conectada a tu red local) e ingresa a:
    `http://localhost:3000` (o `http://<IP_DE_PC1>:3000` desde PC2).
5.  Verás el panel de control interactivo de TriggerStudio. Los indicadores deberán mostrar:
    *   **Servidor:** Conectado (en verde)
    *   **OBS Studio:** Conectado (en verde)
6.  Para probar el disparo rápido de un video:
    *   Copia cualquier video de prueba en `server/media/videos/` (por ejemplo, renombralo como `boom.mp4`).
    *   Presiona el botón **Recargar (Refresh)** en el panel web para que el scanner detecte tu video.
    *   Haz click sobre la tarjeta del video recién agregado ➜ ¡OBS cargará el archivo e iniciará la reproducción instantáneamente de forma visible!
    *   También puedes usar la sección **Disparador Manual** ingresando el nombre exacto de un archivo.
