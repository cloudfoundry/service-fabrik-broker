#!/usr/bin/env bash

SOURCE_DIR='src/architecture'
DESTINATION_DIR='architecture'

# Create destination directory
if [ ! -d $DESTINATION_DIR ]; then
  mkdir $DESTINATION_DIR;
fi

DIAGRAMS=$(ls $SOURCE_DIR/*.seq)

for diagram in $DIAGRAMS; do
  source_filename="$(basename $diagram)"
  target_filename="${source_filename//.seq/.png}"
  echo "   - building $target_filename from $source_filename";
  ./bin/build-architecture-seqdiag.sh "$diagram" $DESTINATION_DIR/$target_filename
done