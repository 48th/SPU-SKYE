FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ARG NEXT_PUBLIC_STATION_API_URL=http://127.0.0.1:8001
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_STATION_API_URL=$NEXT_PUBLIC_STATION_API_URL \
    NEXT_TELEMETRY_DISABLED=1
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
EXPOSE 80
CMD ["npm", "run", "start", "--", "--hostname", "0.0.0.0", "--port", "80"]
