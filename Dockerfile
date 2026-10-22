# Usar imagen oficial de Playwright alineada con la version de Playwright 1.64.1
FROM mcr.microsoft.com/playwright:v1.64.1-jammy

# Directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias y configuracion de npm
COPY package.json .npmrc* ./

# Instalar dependencias del proyecto evitando conflictos de peer dependencies
RUN npm install --legacy-peer-deps

# Asegurar instalacion del binario exacto de Chromium requerido por Playwright
RUN npx playwright install chromium

# Copiar el resto del codigo
COPY . .

# Compilar frontend para produccion
RUN npm run build

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Exponer el puerto
EXPOSE 3000

# Comando de inicio del servidor con Playwright y API
CMD ["npm", "start"]
