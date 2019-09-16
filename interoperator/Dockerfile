# Build the manager binary
FROM golang:1.11.2 as builder

# Copy in the go src
WORKDIR /go/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator
COPY . .
# Install dep
RUN curl https://raw.githubusercontent.com/golang/dep/master/install.sh | sh
RUN dep ensure

# Build
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags provisioners -a -o manager github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/cmd/manager
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags schedulers -a -o scheduler github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/cmd/manager
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -tags multiclusterdeploy -a -o multiclusterdeploy github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/cmd/manager

# Copy the controller-manager into a thin image
FROM ubuntu:latest
WORKDIR /
COPY --from=builder /go/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/manager .
COPY --from=builder /go/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/scheduler .
COPY --from=builder /go/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/multiclusterdeploy .
COPY config/samples/templates/ config/samples/templates/
# Default entrypoint is manager (provisioners)
ENTRYPOINT ["/manager"]
