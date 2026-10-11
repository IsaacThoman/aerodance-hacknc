FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
# tsx (a devDependency) runs the TypeScript sources directly, so install everything.
RUN npm ci --include=dev
COPY src ./src
COPY assets ./assets
EXPOSE 4000
USER node
CMD ["node_modules/.bin/tsx", "src/index.ts"]
