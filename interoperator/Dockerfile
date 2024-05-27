# Build the manager binary
FROM golang:1.21 as builder

WORKDIR /workspace
# Copy the Go Modules manifests
COPY interoperator/go.mod go.mod
COPY interoperator/go.sum go.sum
# cache deps before building and copying source so that we don't need to re-download as much
# and so that source changes don't invalidate our downloaded layer
RUN go mod download

# Copy the go source
COPY interoperator/main.go main.go
COPY interoperator/api/ api/
COPY interoperator/controllers/ controllers/
COPY interoperator/internal/ internal/
COPY interoperator/pkg/ pkg/

WORKDIR /rotation_workspace
COPY interoperator/kubeconfig_rotation/go.mod go.mod
COPY interoperator/kubeconfig_rotation/go.sum go.sum

RUN go mod download

COPY interoperator/kubeconfig_rotation/main.go main.go

WORKDIR /workspace

# Build
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GO111MODULE=on go build -tags provisioners -a -o manager main.go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GO111MODULE=on go build -tags schedulers -a -o scheduler main.go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GO111MODULE=on go build -tags multiclusterdeploy -a -o multiclusterdeploy main.go


WORKDIR /rotation_workspace

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GO111MODULE=on go build -a -o akc main.go
# Use distroless as minimal base image to package the manager binary
# Refer to https://github.com/GoogleContainerTools/distroless for more details
# FROM gcr.io/distroless/static:nonroot 
# Using alphine as xmake supports alphine seamlessly
FROM alpine:3.20

WORKDIR /
COPY --from=builder /workspace/manager .
COPY --from=builder /workspace/scheduler .
COPY --from=builder /workspace/multiclusterdeploy .
COPY --from=builder /rotation_workspace/akc .
# Default entrypoint is manager (provisioners)
ENTRYPOINT ["/manager"]
