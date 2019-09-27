
# Image URL to use all building/pushing image targets
IMG ?= controller:latest

all: test manager

# Run tests
test: generate fmt vet manifests
	go test ./pkg/... ./cmd/... -coverprofile cover.out

# Build manager binary
manager: generate fmt vet
	go build -o bin/manager github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/cmd/manager

# Run against the configured Kubernetes cluster in ~/.kube/config
run_provisioners: generate fmt vet
	go run -tags provisioners ./cmd/manager/main.go

# Run schedulers only in ~/.kube/config
run_schedulers: generate fmt vet
	go run -tags schedulers ./cmd/manager/main.go

# Run multiclusterdeploy only in ~/.kube/config
run_mcd: generate fmt vet
	go run -tags multiclusterdeploy ./cmd/manager/main.go

# Run schedulers only in ~/.kube/config
run_default: generate fmt vet
	go run -tags default ./cmd/manager/main.go

# Install CRDs into a cluster
install: manifests
	kubectl apply -f config/crds

# Deploy controller in the configured Kubernetes cluster in ~/.kube/config
deploy: manifests
	kubectl apply -f config/crds
	kustomize build config/default | kubectl apply -f -

# Generate manifests e.g. CRD, RBAC etc.
manifests:
	go run vendor/sigs.k8s.io/controller-tools/cmd/controller-gen/main.go all

# Run go fmt against code
fmt:
	go fmt ./pkg/... ./cmd/...

# Run go vet against code
vet:
	go vet ./pkg/... ./cmd/...

# Generate code
generate:
ifndef GOPATH
	$(error GOPATH not defined, please define GOPATH. Run "go help gopath" to learn more about GOPATH)
endif
	go generate ./pkg/... ./cmd/...
	vendor/k8s.io/code-generator/generate-groups.sh client \
		github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/client \
		github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/pkg/apis osb:v1alpha1

# Build the docker image
docker-build: test
	docker build . -t ${IMG}
	@echo "updating kustomize image patch file for manager resource"
	sed -i'' -e 's@image: .*@image: '"${IMG}"'@' ./config/default/manager_image_patch.yaml

# Push the docker image
docker-push:
	docker push ${IMG}
