FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/server.js ./
ENV NODE_ENV=production
EXPOSE 3000
CMD ["npm", "start"]
