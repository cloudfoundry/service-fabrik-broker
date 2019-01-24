# Build the manager binary
FROM golang:1.11.2 as builder

# Copy in the go src
WORKDIR /go/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator
COPY . .
# Install dep
RUN curl https://raw.githubusercontent.com/golang/dep/master/install.sh | sh
RUN dep ensure

# Build
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -a -o manager github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/cmd/manager

# Copy the controller-manager into a thin image
FROM ubuntu:latest
WORKDIR /root/
COPY --from=builder /go/src/github.com/cloudfoundry-incubator/service-fabrik-broker/interoperator/manager .
COPY config/samples/templates/ config/samples/templates/
ENTRYPOINT ["./manager"]
