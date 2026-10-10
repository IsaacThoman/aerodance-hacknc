FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# tsx (a devDependency) runs the TypeScript sources directly, so install everything.
RUN npm ci --include=dev
COPY src ./src
COPY public ./public
# data/ is a volume in compose.yaml; create it here so the volume is owned by node.
RUN mkdir -p data && chown node:node data && chmod 700 data
EXPOSE 4000
USER node
# On first boot (empty volume), create the devnet treasury before starting.
CMD ["sh", "-c", "[ -f data/treasury.json ] || node_modules/.bin/tsx src/treasury.ts; exec node_modules/.bin/tsx src/index.ts"]
