FROM node:22.22.2-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8790 PERSISTENCE_BACKEND=memory
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY server/src ./src
COPY public ./public
USER node
EXPOSE 8790
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8790/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
