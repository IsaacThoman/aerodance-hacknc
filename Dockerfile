FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM build AS test
RUN npm test

FROM mcr.microsoft.com/playwright:v1.58.2-noble AS ui-test
WORKDIR /app
COPY --from=build /app ./
RUN npm install --no-save --package-lock=false playwright@1.58.2
CMD ["node", "client/tests/ui-flow.browser.mjs"]

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY packages/pose ./packages/pose
COPY --from=build /app/dist ./dist
EXPOSE 3000
USER node
CMD ["node", "server/index.js"]
