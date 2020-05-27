
# Image URL to use all building/pushing image targets
IMG ?= controller:latest
# Produce CRDs that work back to Kubernetes 1.11 (no version conversion)
CRD_OPTIONS ?= "crd:trivialVersions=true"

# Get the currently used golang install path (in GOPATH/bin, unless GOBIN is set)
ifeq (,$(shell go env GOBIN))
GOBIN=$(shell go env GOPATH)/bin
else
GOBIN=$(shell go env GOBIN)
endif

all: manager

# Run tests
test: generate fmt vet manifests
	go test ./... -coverprofile cover.out

# Build manager binary
manager: generate fmt vet
	go build -o bin/manager main.go

# Run against the configured Kubernetes cluster in ~/.kube/config
run: generate fmt vet manifests
	go run ./main.go

# Run against the configured Kubernetes cluster in ~/.kube/config
run_provisioners: generate fmt vet manifests
	go run -tags provisioners ./main.go

# Run schedulers only in ~/.kube/config
run_schedulers: generate fmt vet manifests
	go run -tags schedulers ./main.go

# Run multiclusterdeploy only in ~/.kube/config
run_mcd: generate fmt vet manifests
	go run -tags multiclusterdeploy ./main.go

# Run default only in ~/.kube/config
run_default: generate fmt vet manifests
	go run -tags default ./main.go

# Install CRDs into a cluster
install: manifests
	kustomize build config/crd | kubectl apply -f -

# Deploy controller in the configured Kubernetes cluster in ~/.kube/config
deploy: manifests
	cd config/manager && kustomize edit set image controller=${IMG}
	kustomize build config/default | kubectl apply -f -

# Generate manifests e.g. CRD, RBAC etc.
manifests: controller-gen
	$(CONTROLLER_GEN) $(CRD_OPTIONS) rbac:roleName=manager-role webhook paths="./..." output:crd:artifacts:config=config/crd/bases
	cp -v config/crd/bases/osb.servicefabrik.io_sfplans.yaml ../helm-charts/interoperator/crds/sfplan.yaml
	cp -v config/crd/bases/osb.servicefabrik.io_sfservicebindings.yaml ../helm-charts/interoperator/crds/sfservicebinding.yaml
	cp -v config/crd/bases/osb.servicefabrik.io_sfserviceinstances.yaml ../helm-charts/interoperator/crds/sfserviceinstance.yaml
	cp -v config/crd/bases/osb.servicefabrik.io_sfservices.yaml ../helm-charts/interoperator/crds/sfservice.yaml
	cp -v config/crd/bases/resource.servicefabrik.io_sfclusters.yaml ../helm-charts/interoperator/crds/sfcluster.yaml

# Run go fmt against code
fmt:
	go fmt ./...

# Run go vet against code
vet:
	go vet ./...

# Generate code
generate: controller-gen
	go generate ./internal/... ./pkg/... ./api/... ./controllers/...
	$(CONTROLLER_GEN) object:headerFile=./hack/boilerplate.go.txt paths="./..."

# Build the docker image
docker-build: test
	docker build . -t ${IMG}

# Push the docker image
docker-push:
	docker push ${IMG}

# find or download controller-gen
# download controller-gen if necessary
controller-gen:
ifeq (, $(shell which controller-gen))
	@{ \
	set -e ;\
	CONTROLLER_GEN_TMP_DIR=$$(mktemp -d) ;\
	cd $$CONTROLLER_GEN_TMP_DIR ;\
	go mod init tmp ;\
	go get sigs.k8s.io/controller-tools/cmd/controller-gen@v0.2.4 ;\
	rm -rf $$CONTROLLER_GEN_TMP_DIR ;\
	}
CONTROLLER_GEN=$(GOBIN)/controller-gen
else
CONTROLLER_GEN=$(shell which controller-gen)
endif
