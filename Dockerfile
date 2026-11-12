# The MirrorMirror website server (server/) with the public site (site/) it serves. Deployed on Railway.
FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev
COPY server/*.js server/
COPY server/preview-template server/preview-template
COPY site site
# Free GeoIP file for visitor locations (DB-IP City Lite, CC BY 4.0). A failed download never fails the build.
RUN node server/geo-fetch.js
RUN mkdir -p server/data && chown node:node server/data
USER node
CMD ["node", "server/server.js"]
