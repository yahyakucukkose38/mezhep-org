# Mezhep.Org: Node sunucusu (API + panel) ve site üreteci (Python) tek imajda.
FROM node:24-bookworm-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci --omit=dev && npm cache clean --force

COPY scripts/build.py scripts/build.py
COPY data data
COPY assets assets
COPY media media
COPY server/src server/src
COPY server/panel server/panel

ENV NODE_ENV=production \
    PORT=3000 \
    MZ_DATA_DIR=/data \
    PYTHON=python3

RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server/src/index.js"]
