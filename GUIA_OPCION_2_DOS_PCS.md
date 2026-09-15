# Guía de Configuración: Trigger Studio con 2 PCs (Opción 2)

Esta guía explica paso a paso cómo usar **Trigger Studio** teniendo el servidor y los archivos multimedia en tu PC actual, y **OBS Studio** corriendo en otra PC dentro de la misma red local.

---

## 🗺️ Mapa de la Red

* **PC 1 (Esta PC - Servidor & Panel de Memes)**:
  * **IP**: `192.168.4.100`
  * Corre: `lanzar_TriggerStudio.bat` (servidor en puerto `2188`)
  * Almacena: Los videos, gifs, memes y audios en la carpeta `server/media/`

* **PC 2 (Otra PC - OBS Studio)**:
  * **IP**: `192.168.4.45`
  * Corre: **OBS Studio** con WebSocket activado en el puerto `4455`

---

## ⚙️ Paso 1: Configuración en esta PC (`server/.env`)

En el archivo `server/.env` de esta PC debes tener configurada la IP de la PC de OBS:

```env
PORT=2188
OBS_WS_URL=ws://192.168.4.45:4455
OBS_WS_PASSWORD=tu_contraseña_de_obs
MEDIA_PATH=D:/plugins para mi OBS/Trigger Studio/server/media
```

---

## 📺 Paso 2: Configuración en el OBS de la otra PC (`192.168.4.45`)

Para que los videos e imágenes se vean en OBS, tienes **2 opciones**. La **Opción A (Fuente de Navegador)** es la recomendada para este esquema de 2 PCs.

---

### ⭐ Opción A: Fuente de Navegador / Browser Source (RECOMENDADA)

Con este método, **no necesitas copiar ningún archivo a la otra PC**. OBS cargará los videos e imágenes por streaming web directamente desde tu PC.

1. Abre **OBS Studio** en la PC `192.168.4.45`.
2. Ve a la escena donde quieras que aparezcan los memes.
3. En el panel de **Fuentes (Sources)**, haz clic en el botón `+` y selecciona **Navegador (Browser Source)**.
4. Nómbrala exactamente: `Overlay_Main` (o el nombre que prefieras).
5. Configura los siguientes campos:
   * **URL**: `http://192.168.4.100:2188/overlay.html`
   * **Ancho (Width)**: `1920` (o el ancho de tu lienzo de OBS, ej. 1280 o 720)
   * **Alto (Height)**: `1080` (o el alto de tu lienzo de OBS, ej. 720 o 1280)
   * ✅ Marca la casilla: **Controlar audio vía OBS** (para escuchar y regular el volumen del video/sonido desde el mezclador de audio de OBS).
   * Desmarca la casilla: *Apagar fuente cuando no sea visible* (para que el WebSocket del navegador se mantenga siempre conectado).
6. Haz clic en **Aceptar**.
7. Centra la fuente en tu pantalla de OBS.

> 💡 **¿Cómo funciona?** Cada vez que hagas clic en un meme desde tu panel, el servidor le avisará al overlay web y el video o imagen se mostrará al instante con animaciones suaves y se ocultará automáticamente al finalizar.

---

### 📁 Opción B: Fuentes Multimedia Nativas de OBS (Media Source)

Si prefieres usar los reproductores de video nativos de OBS en lugar de una fuente de navegador:

1. Crea las siguientes fuentes fijas en tu escena de OBS:
   * **Overlay_Main**: Tipo *Fuente multimedia (Media Source)* (para videos).
   * **GIF_Overlay**: Tipo *Imagen (Image)* (para imágenes y GIFs).
   * **Sound_Effect**: Tipo *Fuente multimedia (Media Source)* (para sonidos).
2. **⚠️ Importante sobre los archivos en Opción B**:
   Dado que OBS intentará abrir el archivo directamente desde su propio sistema operativo, la ruta donde están los videos (ej. `D:\plugins para mi OBS\Trigger Studio\server\media\...`) debe existir con los mismos archivos en la PC `192.168.4.45`, o la carpeta debe estar compartida por red Windows (SMB).
   *(Por esta razón, la Opción A de Browser Source es mucho más simple y limpia).*

---

## 🎮 Paso 3: ¡Listo para Disparar!

1. Inicia `lanzar_TriggerStudio.bat` en esta PC.
2. Abre tu panel de control en `http://localhost:2188` (o desde cualquier celular/tablet conectado a la misma red ingresando a `http://192.168.4.100:2188`).
3. Comprueba que el estado del sistema indique:
   * **Servidor**: Conectado
   * **OBS Studio**: Conectado
4. ¡Haz clic en cualquier video, imagen o sonido y se verá en tu OBS remoto!
