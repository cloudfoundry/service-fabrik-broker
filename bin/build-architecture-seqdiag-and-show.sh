#!/bin/bash

./bin/build-architecture-seqdiag.sh "$1" && \
  eog "${1//.seq/.png}" &>/dev/null
