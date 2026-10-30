FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
COPY public ./public
ENV PORT=8787
EXPOSE 8787
CMD ["node_modules/.bin/tsx", "src/server.ts"]
