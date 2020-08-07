# Build the manager binary
FROM golang:1.13 as builder

WORKDIR /workspace
# Copy the Go Modules manifests
COPY interoperator-admin/go.mod go.mod
COPY interoperator-admin/go.sum go.sum
# cache deps before building and copying source so that we don't need to re-download as much
# and so that source changes don't invalidate our downloaded layer
RUN go mod download

# Copy the go source
COPY interoperator-admin/main.go main.go
COPY interoperator-admin/internal/ internal/
COPY interoperator-admin/pkg/ pkg/

# Build
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GO111MODULE=on go build -a -o interoperator-admin main.go

# Use distroless as minimal base image to package the manager binary
# Refer to https://github.com/GoogleContainerTools/distroless for more details
# FROM gcr.io/distroless/static:nonroot 
# Using alphine as xmake supports alphine seamlessly
FROM alpine:3.11.6

WORKDIR /
COPY --from=builder /workspace/interoperator-admin .

# Default entrypoint is manager (provisioners)
ENTRYPOINT ["/interoperator-admin"]
