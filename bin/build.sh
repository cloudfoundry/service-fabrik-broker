#!/usr/bin/env bash

# Copy directories
echo "Copying..."
bash ./bin/build-copy.sh

# generate Architecture Sequence Diagrams
echo "Building Architecture Sequence Diagrams..."
bash ./bin/build-architecture.sh

# generate Broker API documentation HTML
echo "Building Broker API documentation..."
bash ./bin/build-api-broker.sh

# generate Agent API documentation HTML
echo "Building Agent API documentation..."
bash ./bin/build-api-agent.sh

# generate Backup Restore Python Library documentation HTML
echo "Building Backup and Restore Python Library documentation..."
bash ./bin/build-backuprestore-lib.sh

# generate Service Fabrik Wiki
echo "Building Service Fabrik Wiki..."
bash ./bin/build-wiki.sh

echo "Finished"