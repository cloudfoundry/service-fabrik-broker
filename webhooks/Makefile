
test: fmt lint vet
	go test -coverpkg=./pkg/webhooks/... -coverprofile=coverage.txt ./pkg/webhooks/manager/... -log_dir=${PWD}/logs

coverage: test
	go tool cover -html=./coverage.txt

fmt:
	go fmt ./pkg/webhooks/manager/... ./pkg/apis/...

lint:
	golint ./pkg/webhooks/manager/... ./pkg/apis/...

vet:
	go vet ./pkg/webhooks/manager/... ./pkg/apis/...

build:
	go build ./pkg/webhooks/manager

generate:
	${GOPATH}/src/k8s.io/code-generator/generate-groups.sh "deepcopy,client,informer,lister" \
		github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/client \
		github.com/cloudfoundry-incubator/service-fabrik-broker/webhooks/pkg/apis \
		instance:v1alpha1

clean:
	rm -rf coverage.txt manager
