# RGB Commander Studio
# No npm dependencies, so the image is just Node plus the app.
FROM node:24-alpine

LABEL org.opencontainers.image.title="RGB Commander Studio" \
      org.opencontainers.image.description="Design RGBcommander lighting schemes (.rgba) for Ultimarc LED boards in the browser"

ENV NODE_ENV=production \
    PORT=8080 \
    DATA_DIR=/config \
    OUTPUT_DIR=/output \
    PUID=99 \
    PGID=100 \
    UMASK=002

WORKDIR /app
COPY package.json ./
COPY server ./server
COPY public ./public

EXPOSE 8080
VOLUME ["/config", "/output"]

# Starts as root only long enough to fix ownership of Docker-created folders,
# then switches to PUID:PGID (99:100 = nobody:users on Unraid).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "server/index.js"]
