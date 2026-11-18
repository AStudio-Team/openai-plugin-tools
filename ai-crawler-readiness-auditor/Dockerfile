FROM node:22-bookworm-slim@sha256:c3de60bf2f9dd0ac6370e6117950ff62d6e339527e7472301c9c78a017978392
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
COPY widgets ./widgets
COPY public ./public
ENV NODE_ENV=production PORT=8790 ALLOWED_HOSTS=www.astudio.agency,astudio.agency,127.0.0.1,localhost,fixtures.astudio.agency,fixtures-ready.astudio.agency,fixtures-robots-blocked.astudio.agency,fixtures-llms-html.astudio.agency,fixtures-invalid-jsonld.astudio.agency,fixtures-sitemap-timeout.astudio.agency
USER node
EXPOSE 8790
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:8790/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
