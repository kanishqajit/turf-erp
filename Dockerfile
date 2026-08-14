FROM node:24-alpine

WORKDIR /app
COPY package.json server.mjs index.html app.js styles.css ./
COPY client ./client
COPY server ./server
RUN mkdir -p /app/data && chown -R node:node /app

USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=5174 TURF_DATABASE_PATH=/app/data/turf.sqlite
EXPOSE 5174
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:5174/api/health >/dev/null || exit 1

CMD ["node", "server.mjs"]
