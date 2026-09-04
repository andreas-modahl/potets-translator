# Web app only. The Discord bot has its own entry point (dist/index.js) and can
# be run from the same image by overriding CMD.
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY public ./public
# Generated speech is cached here; mount a volume to keep it across restarts.
RUN mkdir -p data
EXPOSE 3000
CMD ["node", "dist/server.js"]
