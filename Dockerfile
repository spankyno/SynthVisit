# Usar imagen oficial de Playwright con Node.js y navegadores Chromium preinstalados
FROM mcr.microsoft.com/playwright:v1.50.0-jammy

# Directorio de trabajo
WORKDIR /app

# Copiar archivos de dependencias y configuración de npm
COPY package.json .npmrc* ./

# Instalar dependencias del proyecto evitando conflictos de peer dependencies
RUN npm install --legacy-peer-deps

# Copiar el resto del código
COPY . .

# Compilar frontend para producción
RUN npm run build

# Variables de entorno por defecto
ENV NODE_ENV=production
ENV PORT=3000

# Exponer el puerto
EXPOSE 3000

# Comando de inicio del servidor con Playwright y API
CMD ["npm", "start"]
