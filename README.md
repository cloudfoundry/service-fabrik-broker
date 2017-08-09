# Service Fabrik Broker for Cloud Foundry

This broker was inspired  by the [cf-containers-broker](https://github.com/cloudfoundry-community/cf-containers-broker). It is supporting Docker- and Bosh-based service deployments. More details on the implemented Cloud Foundry contract can be found [here](http://docs.cloudfoundry.org/services/api.html).

## Local Development Setup (Ubuntu)

Certainly when you are a broker developer, but also if you are a service developer, you may want to work locally with the broker without packaging it into a Bosh release and deploying it. You can do so using [Bosh Lite](http://docs.cloudfoundry.org/deploying/boshlite) and starting and registering the broker locally:

### Installing Docker

The famous Docker will be required for a local start of the broker. You can avoid this by removing any Docker service defintion from the broker settings/configuration/catalog.

* Follow instructions at https://docs.docker.com/engine/installation/linux/ubuntulinux
 
If you're using a Mac, we recommend to use [Docker for MAC](https://docs.docker.com/docker-for-mac/).

* https://download.docker.com/mac/beta/Docker.dmg

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
* If you run into strange errors using bosh <command> and OpenSSL (when generating the manifest), update OpenSSL and patch the scripts:
```shell
wget http://www.openssl.org/source/openssl-1.0.1p.tar.gz
tar -xvzf openssl-1.0.1p.tar.gz
cd openssl-1.0.1p
./config --prefix=/usr/
make
sudo make install
# add 2>/dev/null to the bosh <command> calls in ./scripts/generate-bosh-lite-dev-manifest
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
If you want to provision our `blueprint-service` as bosh director based service, you first have to checkout the [blueprint-boshrelease](https://github.com/sap/service-fabrik-blueprint-boshrelease) repository and upload the release version **defined in the catalog** (e.g., `0.0.11`) yourself:
```shell
cd ~/workspace
git clone https://github.com/sap/service-fabrik-blueprint-boshrelease
cd blueprint-boshrelease
bosh upload release releases/blueprint/blueprint-0.0.11.yml
```

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
