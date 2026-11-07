# 文字起こし中継サーバー（Cloud Run）
FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY dist ./dist
ENV NODE_ENV=production
CMD ["node", "dist/server.js"]
