#!/bin/bash
target="${1//.seq/.png}"

if [[ ! -z $2 ]]; then
  output="-o $2";
  target="${2//.seq/.png}"
fi

# Generate sequence diagram png image
seqdiag -Tpng --no-transparency -f '/Library/Fonts/Verdana.ttf' "${1}" $output && \
  echo -e "Sequence diagram image created and stored in ${target}."

# -f '/Library/Fonts/Verdana.ttf' 
# Use the above font option to override the fonts on Mac
