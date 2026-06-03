FROM node:20-alpine
WORKDIR /services/tiktok
COPY tiktok/package*.json ./
RUN npm install
COPY utils ./utils
COPY tiktok/ .
CMD ["node", "index.js"]
