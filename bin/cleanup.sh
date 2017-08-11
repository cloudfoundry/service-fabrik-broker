#!/usr/bin/env bash

RESOURCES="architecture api backup-restore-library css js fonts img wiki index.html"

for resource in $RESOURCES; do
  echo "Removing $resource...";
  rm -rfv $resource;
done