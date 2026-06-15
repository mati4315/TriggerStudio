# Sistema de Control Remoto para OBS Studio (PC1 + PC2)

## Objetivo del Proyecto

Crear una aplicación nativa para Windows que permita controlar OBS Studio remotamente desde otra computadora dentro de la misma red local.

La idea principal es:

* PC1 = computadora principal con OBS Studio
* PC2 = notebook/control remoto visual

Desde PC2 se podrán disparar:

* videos
* GIFs
* imágenes
* sonidos
* overlays

Al hacer click en un elemento visual dentro de la app:

* el contenido aparecerá automáticamente en OBS
* se reproducirá instantáneamente
* podrá ocultarse automáticamente o manualmente

El objetivo es que otra persona pueda usar PC2 como “panel de memes/reacciones/chistes” durante streamings o transmisiones en vivo.

---

# Arquitectura Recomendada

## PC1 (Streamer / OBS)

Debe contener:

* OBS Studio
* Todos los archivos multimedia
* Backend local
* Servidor WebSocket/API

Responsabilidades:

* renderizar el contenido en OBS
* reproducir videos/GIFs
* controlar escenas y fuentes
* enviar previews/thumbnails a PC2

---

## PC2 (Controlador Remoto)

Debe contener:

* App nativa Windows
* UI visual con thumbnails
* Botones de disparo rápido

Responsabilidades:

* mostrar biblioteca multimedia
* enviar órdenes a PC1
* NO renderizar videos pesados
* NO ejecutar OBS

---

# Tecnologías Recomendadas

## Backend PC1

Lenguaje recomendado:

* Node.js + TypeScript

Alternativa:

* C#

Motivo:

* obs-websocket-js funciona excelente
* desarrollo rápido
* buena compatibilidad WebSocket
* fácil mantenimiento

---

## Frontend PC2

Opción recomendada:

* Electron + React

Alternativas:

* WPF (C#)
* WinUI 3

Electron es recomendable porque:

* rápido de desarrollar
* UI moderna
* thumbnails simples
* WebSocket fácil
* escalable

---

# Comunicación Entre PCs

## Método recomendado

WebSocket local

Flujo:

PC2
→ envía comando
→ backend PC1 recibe
→ backend controla OBS

---

# OBS Studio

## Requisitos

Instalar:

* OBS Studio 30+

OBS ya incluye:

* obs-websocket integrado

---

# Configuración OBS

## Activar WebSocket

OBS:
Tools
→ WebSocket Server Settings

Activar:

* Enable WebSocket server
* Enable Authentication

Configurar:

* Password segura
* Puerto 4455

---

# Estructura Multimedia Recomendada

PC1:

D:/OBS_MEDIA/

Subcarpetas:

D:/OBS_MEDIA/
videos/
gifs/
memes/
overlays/
sounds/

---

# Flujo del Sistema

## Caso típico

1. Usuario abre app en PC2

2. App obtiene lista multimedia desde PC1

3. App muestra thumbnails

4. Usuario hace click

5. PC2 envía comando:
   {
   "type": "play",
   "asset": "meme1.mp4"
   }

6. Backend PC1:

   * cambia media source
   * reinicia reproducción
   * muestra overlay
   * reproduce contenido en OBS

---

# Estrategia Correcta en OBS

## NO crear sources dinámicamente

RECOMENDADO:

* crear media sources fijas
* reutilizarlas

Ejemplo:

Scene:
"FUNNY_OVERLAYS"

Sources:

* Overlay_Main
* Overlay_Secondary
* GIF_Overlay
* Sound_Effect

La app solo cambia:

* archivo multimedia
* visibilidad
* reproducción

Esto evita:

* lag
* memory leaks
* problemas de sincronización

---

# Escenas Recomendadas

## Escena principal

STREAM_MAIN

## Escena memes

FUNNY_OVERLAYS

## Escena full-screen meme

FULLSCREEN_MEME

## Escena reacciones

REACTIONS

---

# Sistema de Assets

## Cada asset debe tener:

* id
* nombre
* categoría
* thumbnail
* duración
* tipo

Ejemplo:

{
"id": "meme_001",
"name": "vine boom",
"type": "video",
"file": "videos/vineboom.mp4",
"thumbnail": "thumbs/vineboom.jpg",
"duration": 4
}

---

# Generación Automática de Thumbnails

Backend PC1 debe:

* escanear carpetas
* generar thumbnails automáticamente
* guardar metadata

Herramienta recomendada:

* ffmpeg

---

# Funciones Principales MVP

## Versión 1

### Obligatorio

* listado multimedia
* thumbnails
* click para reproducir
* reproducción instantánea
* ocultar automáticamente
* soporte videos
* soporte GIFs
* soporte imágenes

### Opcional

* sonidos
* hotkeys
* categorías
* favoritos
* búsqueda

---

# UX Recomendada

## Diseño tipo Stream Deck

Grid visual:

[ meme ]
[ gif ]
[ video ]
[ boom ]

Click instantáneo.

---

# Funciones Avanzadas Futuras

## Posibles upgrades

### Hotkeys globales

Ejemplo:
CTRL + 1

### Stream Deck físico

Compatibilidad futura.

### Multiusuario

Varias notebooks controlando OBS.

### Panel web

Control desde celular.

### Queue System

Cola de memes/reacciones.

### Cooldowns

Evitar spam.

### Roles

Admin
Operador
Viewer

---

# Rendimiento

## IMPORTANTE

NO transmitir archivos multimedia desde PC2.

Los archivos SIEMPRE deben:

* existir en PC1
* reproducirse en PC1

PC2 solo manda comandos.

Esto reduce:

* latencia
* uso de red
* problemas de sincronización

---

# Seguridad

## Recomendaciones

* usar solo LAN local
* proteger WebSocket con password
* validar comandos entrantes
* limitar IPs permitidas

---

# Librerías Recomendadas

## OBS

obs-websocket-js

## Backend

Express
ws

## Frontend

React
Electron

## Multimedia

ffmpeg

---

# Estructura del Proyecto

## Backend PC1

/server
/assets
/thumbnails
obsController.ts
assetScanner.ts
websocketServer.ts

---

## Frontend PC2

/client
/components
/pages
/assets
App.tsx

---

# API Recomendada

## Endpoint assets

GET /assets

Retorna:

* lista multimedia
* thumbnails
* metadata

---

## WebSocket Commands

### Reproducir

{
"action": "play",
"assetId": "meme_001"
}

### Stop

{
"action": "stop"
}

### Hide

{
"action": "hide"
}

### Fullscreen

{
"action": "fullscreen",
"assetId": "meme_003"
}

---

# Control OBS Recomendado

## Acciones necesarias

* SetInputSettings
* SetSceneItemEnabled
* TriggerMediaInputAction
* SetCurrentProgramScene

---

# Estrategia Recomendada MVP

## FASE 1

Objetivo:
probar concepto rápido

Duración:
2-4 días

Funciones:

* un source
* reproducir videos
* thumbnails
* click → play

---

## FASE 2

Agregar:

* categorías
* múltiples overlays
* sonidos
* auto-hide

---

## FASE 3

Agregar:

* animaciones
* panel web
* stream deck
* multiusuario

---

# Recomendación Final Importante

NO desarrollar plugin nativo de OBS al principio.

Primero:

* app externa
* WebSocket
* MVP rápido

Luego, si el proyecto crece:

* plugin OBS
* integración profunda
* GPU optimizations

Porque el sistema externo:

* es muchísimo más rápido de desarrollar
* más estable
* más fácil de mantener
* menos dependiente de versiones OBS

---

# Resultado Esperado

Un sistema donde:

* OBS corre en PC1
* Otra persona usa PC2
* Hace click en memes/videos/GIFs
* OBS los reproduce instantáneamente
* Ideal para streams, podcasts y reacciones en vivo

Tipo:
“soundboard visual para streamers”.



---------------------------------------------------------------










El orden correcto sería este:

FASE 1 — PROBAR OBS + WEBSOCKET

Primero hacé esto:

Objetivo

Desde una segunda PC:

enviar un comando
que OBS reproduzca un video automáticamente

Nada más.

Sin interfaz linda.
Sin thumbnails.
Sin diseño.

Qué crear primero
1. Backend en PC1

Esto es PRIORIDAD ABSOLUTA.

Creás un backend pequeño:

Node.js
Express
WebSocket

Ese backend:

se conecta a OBS
recibe comandos
controla OBS

Ejemplo:

PC2 manda:

{
  "action": "play",
  "video": "boom.mp4"
}

Backend PC1:

cambia source
reproduce video
muestra overlay
Luego de eso
2. App mínima en PC2

NO hagas una app compleja todavía.

Solo:

una ventana
3 botones

Ejemplo:

[ BOOM ]
[ FAIL ]
[ MEME ]

Y que al hacer click:

mande WebSocket al backend

Con eso ya validaste TODO el proyecto.

Lo más importante del proyecto

NO es la interfaz.

Es esto:

latencia baja
sincronización
control OBS
estabilidad
reproducción instantánea

Eso es lo difícil.

La UI después es fácil.

MVP REALISTA

Te diría que el MVP correcto es:

PC1
OBS
Backend Node.js
WebSocket Server
1 escena
1 media source
PC2
app mínima
botones
conexión websocket
Si eso funciona...

Recién ahí:

PASO 2

Agregás:

thumbnails
categorías
gifs
overlays
auto hide
sonidos
Error que comete mucha gente

Empiezan por:

React
Electron
diseño
animaciones

Y todavía ni probaron:

si OBS responde rápido
si el video se reinicia bien
si el overlay aparece instantáneo
si hay delay en LAN
Mi recomendación concreta
Semana 1

Hacer SOLO esto:

Backend
conectar a OBS websocket
reproducir un video
ocultarlo luego
PC2
botón HTML básico
enviar comando
Tecnologías EXACTAS que usaría
PC1 Backend
Node.js
TypeScript
obs-websocket-js
ws
PC2 MVP

Primero:

HTML + JS simple

Luego:

Electron

NO arrancaría con WPF todavía.

Orden IDEAL
PASO 1

Conectar a OBS

PASO 2

Reproducir video remotamente

PASO 3

Ocultar automáticamente

PASO 4

Mini panel botones

PASO 5

Thumbnails

PASO 6

App nativa linda

PASO 7

Sistema profesional

Consejo MUY importante

En OBS:

NO crees/eliminés sources constantemente.

Hacé:

1 source fija
cambiar el archivo
reiniciar playback

Eso hace TODO más rápido.

La arquitectura correcta mentalmente es:
OBS = motor gráfico
Backend = cerebro
PC2 = control remoto visual

Y ahí el proyecto empieza a tomar forma de verdad.
