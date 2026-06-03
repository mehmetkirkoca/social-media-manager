FROM node:20-alpine
WORKDIR /services/instagram
COPY instagram/package*.json ./
RUN npm install
COPY utils ./utils
COPY instagram/ .
CMD ["node", "index.js"]
