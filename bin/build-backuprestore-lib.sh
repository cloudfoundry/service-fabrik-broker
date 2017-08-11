#!/usr/bin/env bash

BACKUP_RESTORE_LIB_PATH='https://github.com/sap/service-fabrik-backup-restore.git'
export PYTHONPATH="$(pwd)/src/content/backup-restore-library/service-fabrik-backup-restore/lib/clients"

### replace the NAV placeholder in layout
cd src
mv templates/sphinx/service-fabrik/layout.html templates/sphinx/service-fabrik/layout.html.tmp
NAVIGATION=`cat templates/navigation.html`
while read -r line; do
  echo "${line/NAV/$NAVIGATION}"
done < "templates/sphinx/service-fabrik/layout.html.tmp" > "templates/sphinx/service-fabrik/layout.html"
### clone service-fabrik-backup-restore repository to use the python doc strings
cd content/backup-restore-library
git clone $BACKUP_RESTORE_LIB_PATH
### create a dummy module 'retrying'
mkdir -p service-fabrik-backup-restore/lib/clients/retrying
### mock the 'retry' decorator
printf 'def retry(*func, **kw):\n    def inner(*args, **kwargs):\n        return func\n    return inner' \
  > service-fabrik-backup-restore/lib/clients/retrying/__init__.py # Create a dummy retrying module
printf 'import retrying' \
  > service-fabrik-backup-restore/lib/clients/__init__.py
### remove python3 specifics
sed -r -i "s/(, file=sys.stderr)//1" service-fabrik-backup-restore/lib/clients/index.py
### build the html report
sphinx-build -a -b html source/ ../../../backup-restore-library/
### clean up
rm -rf service-fabrik-backup-restore
cd ../..
rm templates/sphinx/service-fabrik/layout.html
mv templates/sphinx/service-fabrik/layout.html.tmp templates/sphinx/service-fabrik/layout.html
cd ..
