FROM node:22-alpine
WORKDIR /app
COPY server.js .
ENV PORT=3000
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=2s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
USER node
CMD ["node", "server.js"]
