FROM node:20-alpine
WORKDIR /services/facebook
COPY facebook/package*.json ./
RUN npm install
COPY utils ./utils
COPY facebook/ .
CMD ["node", "index.js"]
