# Service Fabrik Inter Operator

Service Fabrik Inter Operator is the component of Service Fabrik responsible for mapping the OSB resources to service specific resources mentioned in the templates of the Service Operator.

![InterOperator](https://github.wdf.sap.corp/I068838/service-fabrik-interoperator/blob/add-readme/images/InterOperator.png)

## Getting Started

These instructions will get you a copy of the project up and running on your local machine for development and testing purposes. See deployment for notes on how to deploy the project on a live system.

### Prerequisites

* Install [kustomize](https://github.com/kubernetes-sigs/kustomize)
* Install [kubebuilder](https://github.com/kubernetes-sigs/kubebuilder)

```
version=2.1.0 # latest stable version
arch=amd64

# download the release
curl -L -O https://github.com/kubernetes-sigs/kubebuilder/releases/download/v${version}/kubebuilder_${version}_darwin_${arch}.tar.gz

# extract the archive
tar -zxvf kubebuilder_${version}_darwin_${arch}.tar.gz
sudo mv kubebuilder_${version}_darwin_${arch} /usr/local/kubebuilder

# update your PATH to include /usr/local/kubebuilder/bin
export PATH=$PATH:/usr/local/kubebuilder/bin


# install mockgen
go get github.com/golang/mock/gomock
go get github.com/golang/mock/mockgen
go install github.com/golang/mock/mockgen

# update your PATH to include $GOPATH/bin
export PATH=$PATH:$GOPATH/bin
```

#### Get dependencies
```
go mod download
```

### Generate the crds and mocks

```
make generate manifests
```

### Generate clients for crds

```
go mod vendor
bash vendor/k8s.io/code-generator/generate-groups.sh client github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/api osb:v1alpha1 --go-header-file hack/boilerplate.go.txt
```

### Installing

A step by step series of examples that tell you how to get a development env running

Installing the CRDs

```
make install
```

Run it locally

```
make run
```

In a new terminal, create an instance of the CRD and check if controller picks it up

```
kubectl apply -f config/samples/interoperator_v1alpha1_serviceinstance.yaml
```

## Deployment

Give example of how to deploy it k8s using the docker file

## Authors

* **Vivek Anand Kallampally**
* **Amit malav**
* **Subhankar Chattopadhyay**

See also the list of [contributors](https://github.com/cloudfoundry-incubator/service-fabrik-broker/contributors) who participated in this project.

## License


## Acknowledgments

* [Kubebuilder](https://github.com/kubernetes-sigs/kubebuilder)
