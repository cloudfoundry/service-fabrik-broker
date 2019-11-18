# Build the manager binary
FROM golang:1.13.4 as builder

WORKDIR /workspace
# Copy the Go Modules manifests
COPY go.mod go.mod
COPY go.sum go.sum
# cache deps before building and copying source so that we don't need to re-download as much
# and so that source changes don't invalidate our downloaded layer
RUN go mod download

# Copy the go source
COPY main.go main.go
COPY api/ api/
COPY controllers/ controllers/
COPY internal/ internal/
COPY pkg/ pkg/

# Build
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GO111MODULE=on go build -tags provisioners -a -o manager main.go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GO111MODULE=on go build -tags schedulers -a -o scheduler main.go
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 GO111MODULE=on go build -tags multiclusterdeploy -a -o multiclusterdeploy main.go

# Use distroless as minimal base image to package the manager binary
# Refer to https://github.com/GoogleContainerTools/distroless for more details
FROM gcr.io/distroless/static:nonroot 
WORKDIR /
COPY --from=builder /workspace/manager .
COPY --from=builder /workspace/scheduler .
COPY --from=builder /workspace/multiclusterdeploy .
USER nonroot:nonroot

# Default entrypoint is manager (provisioners)
ENTRYPOINT ["/manager"]
