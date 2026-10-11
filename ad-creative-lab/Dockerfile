FROM node:22.20.0-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src ./src
COPY data ./data
RUN npm run build && npm prune --omit=dev

FROM node:22.20.0-alpine3.22
ENV NODE_ENV=production PORT=8790
WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY widgets ./widgets
COPY data ./data
USER node
EXPOSE 8790
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD wget -qO- http://127.0.0.1:8790/health >/dev/null || exit 1
CMD ["node","dist/server.js"]
