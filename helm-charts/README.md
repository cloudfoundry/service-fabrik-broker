# Helm chart

## Using helm chart

To add service fabrik interoperator helm chart repo
```shell
helm repo add sf-charts https://cloudfoundry-incubator.github.io/service-fabrik-broker/helm-charts
```

Deploy SF Interoperator using helm
```shell
helm install --set cluster.host=sf-broker.ingress.< clusterdomain > --name interoperator --namespace interoperator sf-charts/interoperator
```

## Managing the helm repo

Create a new helm package

```shell
helm package sources/interoperator
```

Update the index
```shell
helm repo index --url https://cloudfoundry-incubator.github.io/service-fabrik-broker/helm-charts .
```