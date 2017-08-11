#!/usr/bin/env bash

DESTINATION_DIR='api'

# Create destination directory
if [ ! -d $DESTINATION_DIR ]; then
  mkdir $DESTINATION_DIR;
fi

VERSIONS='v1.0'

for version in $VERSIONS; do
  echo "   - building $version";
  NOCACHE=1 aglio --theme-template src/templates/aglio/index.jade -i src/content/api/broker/$version/index.apib -o $DESTINATION_DIR/broker_$version.html;
done