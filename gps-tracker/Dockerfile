FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
RUN mkdir -p /app/public/photos /app/data
EXPOSE 3003
CMD ["node", "server.js"]
