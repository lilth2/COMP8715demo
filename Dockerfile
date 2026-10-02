FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json *.html *.js ./
COPY --chown=node:node admin ./admin
COPY --chown=node:node backend ./backend
RUN mkdir -p /app/backend/.private && chown node:node /app/backend/.private
USER node
EXPOSE 8765
CMD ["node", "backend/server.js"]
