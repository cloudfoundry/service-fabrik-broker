#!/usr/bin/env bash

TEMPLATE_FILE='src/templates/wiki.template.html'
MENU_FILE='src/templates/navigation.html'
SOURCE_DIR='src/content/wiki'
DESTINATION_DIR='wiki'

# Create destination directory
if [ ! -d $DESTINATION_DIR ]; then
  mkdir $DESTINATION_DIR
fi

# TODO later: Build wiki from markdowns in src/content/wiki instead of cloning the service-fabrik-docs.wiki repository
git clone https://github.com/sap/service-fabrik-broker.wiki.git src/content/wiki

# Load all pages lexicographically sorted, but 'Home' is the first
echo "   Loading pages..."
PAGES=('Home ')
PAGES+=`ls -p $SOURCE_DIR | grep -v / | grep -v Home | grep -v _ | sed -n 's/\(.*\)\.md$/\1/p'`

# Generate Navigation
echo "   Building navigation..."
for page in $PAGES; do
  NAVIGATION+="<li class=\"toctree-l1\"><a class=\"current reference internal\" href=\"$page.html\">$page</a></li>";
done

# Generate HTML pages
echo "   Generating HTML pages..."
for page in $PAGES; do
  echo "      - $page.html";
  CONTENT=`./bin/build-wiki-page.js $SOURCE_DIR/$page.md`;
  MENU=`cat $MENU_FILE`
  while read -r line; do
    echo "${line/NAV/$NAVIGATION}"
  done < "$TEMPLATE_FILE" > "$DESTINATION_DIR/$page.html.tmp"
  while read -r line; do
    echo "${line/TITLE/$page}"
  done < "$DESTINATION_DIR/$page.html.tmp" > "$DESTINATION_DIR/$page.html.tmp2" && rm "$DESTINATION_DIR/$page.html.tmp"
  while read -r line; do
    echo "${line/CONTENT/$CONTENT}"
  done < "$DESTINATION_DIR/$page.html.tmp2" > "$DESTINATION_DIR/$page.html.tmp3" && rm "$DESTINATION_DIR/$page.html.tmp2"
  while read -r line; do
    echo "${line/MENU/$MENU}"
  done < "$DESTINATION_DIR/$page.html.tmp3" > "$DESTINATION_DIR/$page.html" && rm "$DESTINATION_DIR/$page.html.tmp3"
done

# TODO later: remove when the html's are not longer built from the wiki repo
rm -rf src/content/wiki
