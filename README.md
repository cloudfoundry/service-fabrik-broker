[![Coverage Status](https://coveralls.io/repos/github/cloudfoundry-incubator/service-fabrik-broker/badge.svg?branch=master)](https://coveralls.io/github/cloudfoundry-incubator/service-fabrik-broker?branch=master) [![Travis Build Status](https://travis-ci.org/cloudfoundry-incubator/service-fabrik-broker.svg?branch=master)](https://travis-ci.org/cloudfoundry-incubator/service-fabrik-broker.svg?branch=master)

# Service Fabrik Broker for Cloud Foundry

This broker was inspired  by the [cf-containers-broker](https://github.com/cloudfoundry-community/cf-containers-broker). It supports Docker and Bosh-based service deployments. More details on the implemented Cloud Foundry contract can be found [here](http://docs.cloudfoundry.org/services/api.html). Read the [Big Picture](https://github.com/SAP/service-fabrik-broker/wiki/Big-Picture) behind Service Fabrik Broker.

# Architecture

![Missing](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/gh-pages/img/SF2.0-tam-block-diagram-overview.png?raw=true)
Above is the component diagram of Service Fabrik.
Service Fabrik has been re-designed to a model which is event driven and based on decoupled components which participate and communicate via an [APIServer](https://kubernetes.io/docs/concepts/overview/kubernetes-api/) managed by Service Fabrik. 

The concept is based on Event Sourcing where the Event Store is point of coordination for different components. This facilitates easy onboarding of external components and modules into the service Fabrik eco-system.

To facilitate plugging in external components, we intend to model service Fabrik on a resource and control loop based programming model.

This allows capabilities like provisioning and operations on provisioned instances to be built independently and plugged into the Service Fabrik APIServer based on specific requirements.

Steps to Integrate new provisioners are mentioned in [here](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/master/SF2.0.md)

# Capabilities

1. Bringing in a new provisioner is easier.

2. Bringing in new Backup and Restore approach and plugging in the existing framework is easier now.

3. New Monitoring and Logging endpoint can be plugged in where the events generated while resource change and operations change can be watched by custom managers.

4. State of the service instances are managed in the API Server, so Cloud Controller and BOSH dependency can be something we can get rid of for state information. Hence, BOSH and Cloud Controller overload can be reduced.


# Table of Contents
1. [Local Development Setup](#local-development-setup-ubuntu)
2. [Installing Docker](#installing-docker)
3. [Installing NVM](#installing-nvm)
4. [Installing Bosh Lite](#installing-bosh-lite)
5. [Installing Cloud Foundry](#installing-cloud-foundry)
6. [Installing the Broker](#installing-the-broker)
7. [Launch the Broker](#launch-the-broker)
8. [Register the Broker](#register-the-broker)
9. [Launch the Managers](#launch-the-managers)
10. [Upload Bosh Director Based Service Releases](#upload-bosh-director-based-service-releases)
11. [Run a Service Lifecycle](#run-a-service-lifecycle)
12. [How to obtain Support](#how-to-obtain-support)
13. [Advanced Debugging](#advanced-debugging)

## Local Development Setup (Ubuntu)

Certainly when you are a broker developer, but also if you are a service developer, you may want to work locally with the broker without packaging it into a Bosh release and deploying it. You can do so using [Bosh Lite](https://github.com/cloudfoundry/bosh-lite) and starting and registering the broker locally:

### Installing Docker

The famous Docker will be required for a local start of the broker. You can avoid this by removing any Docker service defintion from the broker settings/configuration/catalog.

* Follow instructions at https://docs.docker.com/engine/installation/linux/docker-ce/ubuntu/

If you're using a Mac, we recommend to use [Docker for MAC](https://docs.docker.com/docker-for-mac/).

* https://download.docker.com/mac/beta/Docker.dmg

Post installation of docker make modifications to [manage docker as a non-root user](https://docs.docker.com/engine/installation/linux/linux-postinstall/#manage-docker-as-a-non-root-user)


### Installing NVM

NVM helps you manage node versions and isolated environments.

* Follow instructions at https://github.com/creationix/nvm/#install-script
```shell
curl -o- https://raw.githubusercontent.com/creationix/nvm/v0.31.3/install.sh | bash
source ~/.nvm/nvm.sh
nvm install node
nvm use node
```

### Installing Bosh Lite

Boshlite on Virtual Box (recommended):
Follow [this](https://github.com/cloudfoundry-incubator/service-fabrik-broker/wiki/Bootstrap-BOSH-2.0-with-local-VirtualBox) article for setting up boshlite env on virtual box.

Bosh Lite is a lightweight local development environment for BOSH using Warden/Garden containers in a Vagrant box.

* Follow instructions at https://github.com/cloudfoundry/bosh-lite/blob/master/README.md#install-bosh-lite
* Run `vagrant ssh` and then remove `8.8.8.8` from `/etc/resolv.conf` to avoid 5s timeouts
* If you want to work with BOSH2.0 and want to deploy [bosh-deployment](https://github.com/cloudfoundry/bosh-deployment), then please follow the bosh-lite installation guide as described in https://bosh.io/docs/bosh-lite.

### Installing Cloud Foundry

Well, you know what Cloud Foundry is, otherwise you wouldn't be interested into a service broker to begin with.

To run Cloud Foundry with bosh 2.0, instructions from [this](https://github.com/cloudfoundry-incubator/service-fabrik-broker/wiki/Running-Cloud-Foundry-with-BOSH-2.0) article can be followed.

After you have set up cf api, sample orgs and spaces can be created to start using it.
```shell
cf create-org dev
cf create-space -o dev broker
cf target -o dev -s broker
```

### Installing the Broker

* Clone this repo (assuming your working directory is ~/workspace)
```shell
cd ~/workspace
```
* Clone and setup fork and git-secrets ( requires [hub] and [git secrets] to be
  installed)
  ```
  sh -c "$(curl -fsSL https://raw.githubusercontent.com/cloudfoundry-incubator/service-fabrik-broker/master/bin/clone-for-development)"
  cd service-fabrik-broker
  git checkout -b my-new-feature
  # make code changes
  git push <github_username> my-new-feature
  ```
* Install dependencies
```shell
npm install
```
* Optional: To locally run all unit test
To run all the unit tests:
```shell
npm run -s test
```
To run only unit tests for specific processes like broker, deployment_hooks
```shell
# help
npm run -s help
```


### Uploading the cloud-config:
Then, we need to upload the cloud-config required for service-fabrik on bosh.

For bosh-lite, you can upload cloud-config in the following manner:
```shell
cd templates
bosh –e bosh upload-cloud-config config/cloud-config.yml
```
To use along with the boshrelease of Service-Fabrik, `cloud-config-boshlite.yml` is provided here : https://github.com/cloudfoundry-incubator/service-fabrik-boshrelease/blob/master/templates/cloud-config-boshlite.yml

For AWS, we need to update the vars-files for the cloud-config. 
The vars file to be edited is `cloud-config-aws-vars.yml`. It can be found in the `templates` directory.
Once the vars file is filled with proper details, the cloud-config can be uploaded:
```shell
cd templates
bosh –e bosh upload-cloud-config --vars-store=cloud-config-aws-vars.yml cloud-config-aws.yml
```
The required files mentioned above can be found here: https://github.com/cloudfoundry-incubator/service-fabrik-boshrelease/tree/master/templates

### Launch the Deployment Hooks Process
This process executes action scripts provided by services in restricted environment.
More information on how to configure action scripts is documented here: https://github.com/cloudfoundry-incubator/service-fabrik-broker/wiki/Deployment-hooks-for-service-lifecycle-operations
If you don't want any predeployment action to run please comment out `actions` property in [service](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/rel-2018.T08a/broker/config/settings.yml#L574) and [plan](https://github.com/cloudfoundry-incubator/service-fabrik-broker/blob/rel-2018.T08a/broker/config/settings.yml#L685) from catalog.

If predeployment actions are present in service catalog then deployment hook process has to be running.
Before starting deployment hooks process, SETTINGS_PATH env variable has to be set.
```shell
export SETTINGS_PATH=$(pwd)/deployment_hooks/config/settings.yml
```
If you need  to change the `settings.yml` configuration you should copy the file and point the deployment_hooks to your settings file via the environment variable `SETTINGS_PATH`.
```shell
# env vars you may like to set to different than these default values
# export NODE_ENV=development ## For bosh2.0, use the environment boshlite2, as the passwords and BOSH IP are different.
# cp $(pwd)/deployment_hooks/config/settings.yml $(pwd)/deployment_hooks/config/my-settings.yml
# export SETTINGS_PATH=$(pwd)/deployment_hooks/config/my-settings.yml
node $(pwd)/deployment_hooks/HookServer.js
```

### Launch the Broker
[APIServer](https://kubernetes.io/docs/concepts/overview/kubernetes-api/) is a prerequisite for the Service Fabrik. To get more details about the APIs, [this](https://github.com/kubernetes/community/blob/master/contributors/devel/api-conventions.md) can be looked into.

Assuming that apiserver is already deployed on boshlite, to start provisioning, broker process has to be started.

If apiserver is not deployed already, please follow [this](https://github.com/cloudfoundry-incubator/service-fabrik-boshrelease#deploying-apiserver) guide.

Useful prerequisites: When working with the broker, install `curl` (`sudo apt-get install curl`), [`jq`](https://stedolan.github.io/jq/download), and [`yaml2json`](https://github.com/bronze1man/yaml2json).

Dependencies on other processes: broker process is dependent on deployment hooks process which has to be running for broker to run any lifecycle operation if actions are present in service catalogs.

Before starting broker process SETTINGS_PATH env variable has to be set.
```shell
export SETTINGS_PATH=$(pwd)/broker/config/settings.yml
```
If you need  to change the `settings.yml` configuration you should copy the file and point the broker to your settings file via the environment variable `SETTINGS_PATH`.
```shell
# env vars you may like to set to different than these default values
# export NODE_ENV=development ## For bosh2.0, use the environment boshlite2, as the passwords and BOSH IP are different.
# cp $(pwd)/broker/config/settings.yml $(pwd)/broker/config/my-settings.yml
# export SETTINGS_PATH=$(pwd)/broker/config/my-settings.yml
npm run -s start
```
Check endpoint with curl
```shell
curl -sk -u broker:secret -H "X-Broker-Api-Version: 2.9" https://127.0.0.1:9293/cf/v2/catalog | jq .
```

### Register the Broker

You have to do this only once or whenever you modify the catalog. Then of course, use `update-service-broker` instead of `create-service-broker`.

* Registration
```shell
cf create-service-broker service-fabrik-broker broker secret https://10.0.2.2:9293/cf # host IP reachable from within the Vagrant box
cf service-brokers # should show the above registered service broker
curl -sk -u broker:secret -H "X-Broker-Api-Version: 2.9" https://127.0.0.1:9293/cf/v2/catalog | jq -r ".services[].name" | xargs -L 1 -I {} cf enable-service-access {}
cf service-access # should show all services as enabled, cf marketplace should show the same
```

### Launch the Managers
For running lifecycle operations, corresponding manager processes have to be started. Currently Service Fabrik Broker supports Bosh Director based and Docker Based services.

Assuming that all required env variables (SETTINGS_PATH, NODE_ENV) are already set. Both bosh manager and docker manager can be launched.
```shell
node managers/StartBoshManagers.js #to start bosh manager
node managers/StartDockerManagers.js #to start docker manager
```

### Upload Bosh Director Based Service Releases

In order for the broker to provision bosh director based services, the releases used in the service manifest templates must be manually uploaded to the targetted bosh director.
The catalog (`config/settings.yml`) only contains our own [blueprint-service](https://github.com/sap/service-fabrik-blueprint-service) which we are using for internal development, testing and documentation purposes of the Service Fabrik.
If you want to provision our `blueprint-service` as bosh director based service, follow the steps mentioned in [blueprint-boshrelease](https://github.com/sap/service-fabrik-blueprint-boshrelease) repository.

### Run a Service Lifecycle

You will need a Cloud Foundry application, let's call it `my-app` (see below). If you have no specific one, you can use our [blueprint-app](https://github.com/sap/service-fabrik-blueprint-app).

```shell
cf create-service blueprint v1.0-container my-service
cf bind-service my-app my-service
# take a look at the generated binding with cf env my-app
cf restart my-app # do this a.) to make binding information available in environment of the app and b.) to activate the security group created with the service
# verify the application sees the service; if you have deployed the above app, run curl -skH "Accept: application/json" "https://my-app.bosh-lite.com/test"
cf unbind-service my-app my-service
cf delete-service -f my-service
```
## How to obtain support

If you need any support, have any question or have found a bug, please report it in the [GitHub bug tracking system](https://github.com/cloudfoundry-incubator/service-fabrik-broker/issues). You can also reach us out on our [Slack Channel](https://cloudfoundry.slack.com/messages/C814KVC59).

## Advanced Debugging

Now you can start restarting your builds in Debug mode with an API request. To trigger a debug job:

1. Get the API token using the travis CLI and send a POST request to /job/:job_id/debug replacing the [TOKEN](https://blog.travis-ci.com/2013-01-28-token-token-token) and JOB_ID values below:
```
curl -s -X POST \
   -H "Content-Type: application/json" \
   -H "Accept: application/json" \
   -H "Travis-API-Version: 3" \
   -H "Authorization: token <TOKEN>" \
   -d '{ "quiet": true }' \
   https://api.travis-ci.org/job/<JOB_ID>/debug
```
The Job ID is displayed in the build log after expanding "Build system information".

2. Head back to the web UI and in the log of your job. you should see the following lines to connect to the VM:
```
Setting up debug tools.
Preparing debug sessions.
Use the following SSH command to access the interactive debugging environment:
ssh ukjiuCEkxBBnRAe32Y8xCH0zj@ny2.tmate.io
```
3. Connect from your computer using SSH into the interactive session, and once you're done, just type exit and your build will terminate.

Please note that when the debug build is thus initiated, the job will skip the remaining phases after debug. Also, please consider removing the build log after you've finished debugging.

Finally, once in the SSH session, [these bash functions](https://docs.travis-ci.com/user/running-build-in-debug-mode/#Things-to-do-once-you-are-inside-the-debug-VM) will come in handy to run the different phases in your build:


## LICENSE

This project is licensed under the Apache Software License, v. 2 except as noted otherwise in the [LICENSE](LICENSE) file.

[hub]: https://github.com/github/hub
[git secrets]: https://github.com/awslabs/git-secrets
