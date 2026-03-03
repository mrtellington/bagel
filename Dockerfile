FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY dist/ ./dist/
COPY bridge/ ./bridge/
CMD ["node", "dist/index.js"]
