FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json ./
RUN bun install --production

COPY src ./src

ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
