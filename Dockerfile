# Invoice Engine — Railway / Render compatible image.
# Zero runtime dependencies, so there is nothing to install beyond Node itself.
FROM node:22-alpine

ENV NODE_ENV=production \
    PORT=8787 \
    DATA_DIR=/data

WORKDIR /app

# No package install step is required (no dependencies), but package.json is
# copied so start scripts and engine metadata stay consistent with the repo.
COPY package.json ./
COPY server.js ./
COPY lib ./lib
COPY public ./public
COPY seed ./seed

# Mount a persistent volume here or API keys, credits and orders are lost on
# every deploy. On Railway: railway add --volume.
RUN mkdir -p /data

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=4s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]