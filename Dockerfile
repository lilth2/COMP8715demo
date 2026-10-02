FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node package.json server.js server-data.js ./
COPY --chown=node:node *.html *.js ./
RUN mkdir -p /app/.private && chown node:node /app/.private
USER node
EXPOSE 8765
CMD ["node", "server.js"]
