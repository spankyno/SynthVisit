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
4. Cloudflare Pages y Cloudflare Workers Assets detectan y sirven automáticamente `index.html` para el enrutamiento de la SPA.
5. Haz clic en **Save and Deploy**.

---

### Opción C: Despliegue del Backend Headless (Playwright) en Render
Para ejecutar visitas reales en segundo plano sin abrir ventanas en tu ordenador:

1. Ve a tu panel de [Render](https://dashboard.render.com).
2. Haz clic en **New +** > **Web Service**.
3. Conecta este repositorio de GitHub.
4. En **Runtime**, selecciona **Docker** (Render detectará automáticamente el archivo [Dockerfile](file:///C:/MyOfflineFolder/synthvisit/Dockerfile)).
5. En el plan, puedes elegir el plan **Free** o **Starter**.
6. (Opcional) En **Environment Variables**, puedes configurar:
   - `REQUIRE_AUTH`: `true` (si deseas proteger el servidor con clave).
   - `HEADLESS_AUTH_KEY`: Tu clave secreta para autorizar usuarios.
7. Haz clic en **Create Web Service**.
8. Una vez desplegado, copia la URL que te asigna Render (ejemplo: `https://synthvisit-backend.onrender.com`).
9. En tu frontend de Cloudflare Pages, haz clic en la insignia superior de **Modo**, introduce la URL de Render (y tu token si configuraste uno) y pulsa **Guardar y Probar Conexión**.

---

### Opción D: Ejecución Local o en VPS
Si deseas ejecutarlo localmente o en un VPS tradicional:
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
