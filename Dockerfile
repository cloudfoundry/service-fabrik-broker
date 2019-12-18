# FROM node:12.13-alpine also works here for a smaller image
FROM node:12.13-alpine

# set our node environment, either development or production
# defaults to production, compose overrides this to development on build and run
ENV NODE_ENV production

EXPOSE 9292 9293

# you'll likely want the latest npm, regardless of node version, for speed and fixes
# but pin this version for the best stability
RUN npm i npm@latest -g

# install dependencies first, in a different location for easier app bind mounting for local development
WORKDIR /opt
COPY package.json package-lock.json* ./
RUN npm install --no-optional && npm cache clean --force
ENV PATH /opt/node_modules/.bin:$PATH

# copy in our source code last, as it changes the most
WORKDIR /opt/service-fabrik-broker
COPY . /opt/service-fabrik-broker

ENV CONF_DIR /opt/service-fabrik-broker/broker/config
ENV SETTINGS_PATH=$CONF_DIR/settings.yml

# the official node image provides an unprivileged user as a security best practice
# https://github.com/nodejs/docker-node/blob/master/docs/BestPractices.md#non-root-user
# USER node

# if you want to use npm start instead, then use `docker run --init in production`
# so that signals are passed properly. Note the code in index.js is needed to catch Docker signals
# using node here is still more graceful stopping then npm with --init afaik
# I still can't come up with a good production way to run with npm and graceful shutdown
CMD [ "npm", "start" ]