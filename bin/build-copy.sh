#!/usr/bin/env bash

echo "   Copying directories..."
echo "      - copying css/"
cp -R src/css .
echo "      - copying fonts/"
cp -R src/fonts .
echo "      - copying img/"
cp -R src/img .
echo "      - copying js/"
cp -R src/js .
# Copy files
echo "   Copying files..."
echo "      - copying index.html"
cp src/index.html index.html
