FROM node:24.8.0-bookworm-slim AS build
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY next.config.mjs jsconfig.json ./
COPY app ./app
COPY lib ./lib
COPY migrations ./migrations
RUN chmod -R a=rX /app/app /app/lib /app/migrations && npm run build

FROM node:24.8.0-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
WORKDIR /app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/migrations ./migrations
# Root owns immutable application code; UID1000 only writes mounted runtime paths.
RUN chmod -R a=rX /app && mkdir -p /app/uploads && chown 1000:1000 /app/uploads
USER 1000:1000
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
