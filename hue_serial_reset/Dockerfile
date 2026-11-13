FROM ghcr.io/home-assistant/base:3.24

RUN apk add --no-cache nodejs npm python3 build-base linux-headers

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
    && apk del python3 build-base linux-headers

COPY server.js ./server.js
COPY public ./public

CMD ["node", "server.js"]
