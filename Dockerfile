FROM node:22-alpine

RUN apk add --no-cache docker-cli docker-cli-compose python3 make g++

WORKDIR /app

COPY package.json ./
RUN npm install --production
COPY src ./src
COPY public ./public
COPY config ./config
COPY generated ./generated
COPY docs ./docs
COPY audience_group.md ./
COPY content_classifier.json ./
COPY content_strat.json ./
COPY .env ./
EXPOSE 4310

CMD ["node", "src/server.js"]
