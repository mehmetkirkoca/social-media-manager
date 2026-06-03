FROM node:20-alpine
WORKDIR /services/pinterest
COPY pinterest/package*.json ./
RUN npm install
COPY utils ./utils
COPY pinterest/ .
CMD ["node", "index.js"]
