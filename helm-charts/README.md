# Helm chart

## Prerequisites

* Install [helm](https://helm.sh/docs/intro/install/) - Supported Version 2.16.1
## Using helm chart

To add service fabrik interoperator helm chart repo
```shell
helm repo add sf-charts https://cloudfoundry.github.io/service-fabrik-broker/helm-charts
```

Deploy SF Interoperator using helm
```shell
helm install --set cluster.host=sf-broker.ingress.< clusterdomain > --name interoperator --namespace interoperator sf-charts/interoperator
```

## Managing the helm repo

Create a new helm package
Clone Broker twice. One with master branch and one with gh-pages branch

```shell
helm package -d <path to gh-pages clone>/helm-charts <path to master clone>helm-charts/interoperator
```

Update the index

```shell
cd <path to gh-pages clone>/helm-charts
helm repo index --url https://cloudfoundry.github.io/service-fabrik-broker/helm-charts .
```