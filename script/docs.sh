#!/bin/bash

export VERSION={"$1":-latest}
export TOP_DIR=$(pwd)
export COMMIT_HASH=$(git rev-parse --short HEAD)

echo ${VERSION}
printf "generate and publish documents"
mkdocs build --config-file mkdocs.yml --site-dir "site/online/${VERSION}"
mkdocs build --config-file mkdocs_offline.yml --site-dir "site/offline/${VERSION}"

cp docs/redirect-page.html site/index.html

cd site/offline
zip -r latest.zip latest

cd ${TOP_DIR}
git checkout webpage-docs

rm -rf latest
mv site/online/latest . 
mv site/offline/latest.zip .
mv site/index.html .

#git add .
#git commit -m "docs for ${COMMIT_HASH} commit"