FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-compose

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY config ./config
COPY generated ./generated
COPY docs ./docs
COPY audience_group.md ./
COPY content_classifier.json ./
COPY content_strat.json ./
COPY .env ./

EXPOSE 4310

CMD ["node", "src/server.js"]
