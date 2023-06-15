#!/bin/bash

export commit_hash=$(git rev-parse --short HEAD)

printf "generate and publish documents"
mkdocs build --config-file mkdocs.yml --site-dir site/online/latest
mkdocs build --config-file mkdocs_offline.yml --site-dir site/offline/latest
cd site/offline
zip -r latest.zip latest
cp docs/redirect-page.html site/index.html

git checkout website-docs

rm -rf latest
mv site/online/latest . 
mv site/offline/latest.zip .
mv site/index.html .

git add .
git commit -m "docs for ${commit_hash} commit"