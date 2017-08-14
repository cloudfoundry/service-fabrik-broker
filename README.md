# Service Fabrik Broker for Cloud Foundry

This broker was inspired  by the [cf-containers-broker](https://github.com/cloudfoundry-community/cf-containers-broker). It supports Docker and Bosh-based service deployments. More details on the implemented Cloud Foundry contract can be found [here](http://docs.cloudfoundry.org/services/api.html). Read the [Big Picture](https://github.com/SAP/service-fabrik-broker/wiki/Big-Picture) behind Service Fabrik Broker.

# Table of Contents
1. [Local Development Setup](https://github.com/SAP/service-fabrik-broker#local-development-setup-ubuntu)
2. [Installing Docker](https://github.com/SAP/service-fabrik-broker#installing-docker)
3. [Installing NVM](https://github.com/SAP/service-fabrik-broker#installing-nvm)
4. [Installing Bosh Lite](https://github.com/SAP/service-fabrik-broker#installing-bosh-lite)
5. [Installing Cloud Foundry](https://github.com/SAP/service-fabrik-broker#installing-cloud-foundry)
6. [Installing the Broker](https://github.com/SAP/service-fabrik-broker#installing-the-broker)
7. [Launch the Broker](https://github.com/SAP/service-fabrik-broker#launch-the-broker)
8. [Register the Broker](https://github.com/SAP/service-fabrik-broker#register-the-broker)
9. [Upload Bosh Director Based Service Releases](https://github.com/SAP/service-fabrik-broker#upload-bosh-director-based-service-releases)
10. [Run a Service Lifecycle](https://github.com/SAP/service-fabrik-broker#run-a-service-lifecycle)
11. [How to obtain Support](https://github.com/SAP/service-fabrik-broker#how-to-obtain-support)

## Local Development Setup (Ubuntu)

Certainly when you are a broker developer, but also if you are a service developer, you may want to work locally with the broker without packaging it into a Bosh release and deploying it. You can do so using [Bosh Lite](http://docs.cloudfoundry.org/deploying/boshlite) and starting and registering the broker locally:

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

Bosh Lite is a lightweight local development environment for BOSH using Warden/Garden containers in a Vagrant box.

* Follow instructions at https://github.com/cloudfoundry/bosh-lite/blob/master/README.md#install-bosh-lite
* Run `vagrant ssh` and then remove `8.8.8.8` from `/etc/resolv.conf` to avoid 5s timeouts

### Installing Cloud Foundry

Well, you know what Cloud Foundry is, otherwise you wouldn't be interested into a service broker to begin with.

* Follow instructions at http://docs.cloudfoundry.org/deploying/boshlite/create_a_manifest.html
* You may like to shorten the polling interval for asynchronous service instance operations in `cf-release/bosh-lite/deployments/cf.yml`:
```yaml
properties:
  cc:
    broker_client_default_async_poll_interval_seconds: 1
```
* Next follow instructions at http://docs.cloudfoundry.org/deploying/common/deploy.html to deploy Cloud Foundry
* If you run into strange errors using bosh <command> and OpenSSL (when generating the manifest), update OpenSSL and patch the scripts:
```shell
wget http://www.openssl.org/source/openssl-1.0.1p.tar.gz
tar -xvzf openssl-1.0.1p.tar.gz
cd openssl-1.0.1p
./config --prefix=/usr/
make
sudo make install
# add 2>/dev/null to the bosh <command> calls in ./scripts/generate-bosh-lite-dev-manifest

* If you run into certificate errors from consul like "Unexpected response code: 500 (rpc error: failed to get conn: x509: certificate has expired or is not yet valid)". This means the certificates has expired and it is required to recreate the certificates. Follow the steps below:
  * Generate new certificates using the script cf-release/scripts/generate-consul-certs.
  * Copy the certificates in the relevant section of cf-release/templates/cf-infrastructure-bosh-lite.yml
  * Regenerate the cf-release deployment manifest
  * Now recreate the release, upload and deploy it as follows:
    ```
    bosh create release && bosh upload release && bosh deploy
    ```
* Follow instructions at https://docs.cloudfoundry.org/cf-cli/install-go-cli.html to install cf cli
```
* Target, Login, Prepare Cloud Foundry Usage
```shell
cf api --skip-ssl-validation api.bosh-lite.com
cf login -u admin -p admin
cf create-org dev
cf create-space -o dev broker
cf target -o dev -s broker
```

### Installing the Broker

* Clone this repo (assuming your working directory is ~/workspace)
```shell
cd ~/workspace
git clone https://github.com/sap/service-fabrik-broker
cd service-fabrik-broker
```
* Install dependencies
```shell
npm install
```
* Optional: To locally run all unit test
```shell
npm run -s test
```

### Launch the Broker

Useful prerequisites: When working with the broker, install `curl` (`sudo apt-get install curl`), [`jq`](https://stedolan.github.io/jq/download), and [`yaml2json`](https://github.com/bronze1man/yaml2json).

If you need to change the `settings.yml` configuration you should copy the file and point the broker to your settings file via the environment variable `SETTINGS_PATH`.
```shell
# env vars you may like to set to different than these default values
# export NODE_ENV=development
# export SETTINGS_PATH=$(pwd)/config/settings.yml 
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

### Upload Bosh Director Based Service Releases

In order for the broker to provision bosh director based services, the releases used in the service manifest templates must be manually uploaded to the targetted bosh director.
The catalog (`config/settings.yml`) only contains our own [blueprint-service](https://github.com/sap/service-fabrik-blueprint-service) which we are using for internal development, testing and documentation purposes of the Service Fabrik.
If you want to provision our `blueprint-service` as bosh director based service, follow the steps mentioned in [blueprint-boshrelease](https://github.com/sap/service-fabrik-blueprint-boshrelease) repository

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

If you need any support, have any question or have found a bug, please report it in the [GitHub bug tracking system](https://github.com/sap/service-fabrik-broker/issues). We shall get back to you.

## LICENSE

This project is licensed under the Apache Software License, v. 2 except as noted otherwise in the [LICENSE](LICENSE) file
