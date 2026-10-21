# SynthVisit — Generador de Tráfico Sintético y Emulación de Interacción

SynthVisit es una solución profesional para propietarios de propiedades verificadas en Google Search Console para probar el rendimiento, la interacción y el comportamiento de tráfico orgánico simulado.

---

## 🚀 Despliegue en Producción

### Opción A: Despliegue en Vercel
1. Sube tu repositorio a GitHub o GitLab.
2. Ve al panel de **Vercel** y haz clic en **"Add New Project"**.
3. Importa este repositorio.
4. Vercel detectará automáticamente la configuración gracias al archivo [vercel.json](file:///C:/MyOfflineFolder/synthvisit/vercel.json):
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
5. Haz clic en **Deploy**. ¡Listo para producción!

---

### Opción B: Despliegue en Cloudflare Pages
1. Ve al panel de **Cloudflare** > **Workers & Pages** > **Create application** > **Pages** > **Connect to Git**.
2. Selecciona tu repositorio.
3. En la configuración de compilación:
   - **Framework preset**: `Vite`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
4. El archivo [public/_redirects](file:///C:/MyOfflineFolder/synthvisit/public/_redirects) gestionará automáticamente el enrutamiento de la aplicación (SPA).
5. Haz clic en **Save and Deploy**.

---

### Opción C: Ejecución con Servidor Backend Completo (Node.js + Playwright)
Si deseas ejecutar la automatización real de navegadores con Playwright headless (en un VPS, Docker, Railway, Render o en local):
```bash
# 1. Instalar dependencias
npm install

# 2. Instalar binarios de navegador de Playwright (si aplica)
npx playwright install chromium

# 3. Iniciar servidor completo
npm start
```

---

## 🌟 Arquitectura Dual (Resiliente para la Nube)
- **Modo Edge / Cloud (Vercel / Cloudflare Pages)**: Opera como SPA reactiva autónoma con almacenamiento persistente en `localStorage` y simulación de visitas en tiempo real.
- **Modo Backend Dedicado (Node.js + Express)**: Si el servidor backend está disponible, la interfaz se conecta dinámicamente y utiliza Playwright para abrir instancias reales de Chromium con proxies y rotación de IP.

---

## 🛠️ Tecnologías Utilizadas
- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, Vite 6.
- **Backend**: Express, Playwright, Node-cron, Axios, Server-Sent Events (SSE).
