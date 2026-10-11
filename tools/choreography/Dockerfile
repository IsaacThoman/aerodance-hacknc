FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run studio:build

FROM build AS test
RUN npm test && npm run studio:test && npm --prefix temp/frutiger-character test

FROM mcr.microsoft.com/playwright:v1.58.2-noble AS ui-test
WORKDIR /app
COPY --from=build /app ./
RUN npm install --no-save --package-lock=false playwright@1.58.2
CMD ["node", "tools/choreography/tests/browser.mjs"]

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production STUDIO_DATA_DIR=/data STUDIO_PORT=3000
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir /data && chown node:node /data
COPY --from=build /app/tools/choreography/dist ./tools/choreography/dist
COPY tools/choreography/server ./tools/choreography/server
COPY tools/choreography/core.js ./tools/choreography/core.js
COPY packages/pose ./packages/pose
COPY packages/character/calibration.js ./packages/character/calibration.js
COPY packages/stages ./packages/stages
COPY client/src/pose/protocol.js ./client/src/pose/protocol.js
EXPOSE 3000
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://localhost:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "tools/choreography/server/index.js"]
