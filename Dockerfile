FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src/ src/

RUN mkdir -p logs

EXPOSE 3000

CMD ["node", "src/server.js"]
