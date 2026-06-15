# TriggerStudio Client

Este es el cliente nativo de escritorio para **TriggerStudio**, desarrollado con **Electron**, **React**, **TypeScript** y **Vite**.

Permite visualizar la biblioteca de medios del servidor en un panel premium con diseño glassmorphic y disparar de forma remota videos, audios, imágenes y GIFs directamente en OBS Studio con baja latencia.

---

## 🎨 Características de la UI
* **Tema Premium Glassmorphic:** Fondos semi-transparentes de efecto vidrio con desenfoques radiales de color y bordes luminosos.
* **Filtros por Tipo:** Segmentación instantánea por Videos, GIFs/Imágenes y Sonidos.
* **Control Remoto Inmediato:** Grid interactivo que muestra las previsualizaciones y el estado "EN VIVO" de los recursos activos.
* **Consola de Eventos:** Registro integrado de eventos y respuestas del servidor en tiempo real.
* **Disparador Manual:** Formulario para introducir nombres de archivos, seleccionar su tipo y duración en segundos.
* **Configurador del Servidor:** Interfaz de usuario para ajustar la IP y el puerto de conexión LAN con persistencia local en `localStorage`.

---

## 🚀 Requisitos previos
1. Tener instalado [Node.js](https://nodejs.org/).
2. Asegurar que el servidor de TriggerStudio (`/server`) esté corriendo en la misma red local.

---

## 🛠️ Comandos de Desarrollo

Instalar dependencias:
```bash
npm install
```

Iniciar el entorno de desarrollo (lanza el servidor de desarrollo de Vite y la ventana de Electron concurrentemente):
```bash
npm start
```

Compilar la aplicación para producción (empaqueta el bundle en la carpeta `/dist` para que Electron la ejecute localmente sin servidor de desarrollo):
```bash
npm run build
```

---

## 📂 Estructura del Proyecto
* `main.cjs` - Proceso principal de Electron. Configura y gestiona el ciclo de vida de la ventana nativa.
* `src/main.tsx` - Punto de entrada de React.
* `src/App.tsx` - Componente principal que gestiona las conexiones WebSocket, los estados de sincronización y los widgets del panel.
* `src/index.css` - Estilos globales de la interfaz de usuario con variables de diseño, paletas de colores modernos y micro-animaciones.
