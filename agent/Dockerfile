FROM node:24-alpine
WORKDIR /app/agent
ENV NODE_ENV=production
COPY agent/package.json agent/package-lock.json ./
# tsx (a devDependency) runs the TypeScript sources directly, so install everything.
RUN npm ci --include=dev
COPY agent/src ./src
COPY agent/assets ./assets
COPY packages/trophy-art /app/packages/trophy-art
EXPOSE 4000
USER node
CMD ["node_modules/.bin/tsx", "src/index.ts"]
