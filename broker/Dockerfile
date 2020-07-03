# FROM node:12.14-alpine also works here for a smaller image
FROM node:12.14-alpine

# set our node environment, either development or production
# defaults to production, compose overrides this to development on build and run
ENV NODE_ENV production

EXPOSE 9293 9296

# you'll likely want the latest npm, regardless of node version, for speed and fixes
# but pin this version for the best stability
RUN npm i npm@latest -g
RUN npm i lerna -g --loglevel notice

# install dependencies first, in a different location for easier app bind mounting for local development
WORKDIR /opt/service-fabrik-broker/broker

COPY broker/package.json package.json
COPY broker/lerna.json lerna.json
COPY broker/applications/osb-broker applications/osb-broker
COPY broker/applications/quota-app applications/quota-app
COPY broker/core core
COPY broker/data-access-layer data-access-layer
RUN mkdir logs

RUN lerna link convert
RUN npm install --production && npm cache clean --force
# copy in our source code last, as it changes the most

ENV CONF_DIR /opt/service-fabrik-broker/broker/config
ENV SETTINGS_PATH=$CONF_DIR/settings.yml

# the official node image provides an unprivileged user as a security best practice
# https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#non-root-user
# USER node
