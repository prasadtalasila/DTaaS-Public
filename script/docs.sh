#!/bin/bash

if [ -n "$1" ]; then
  VERSION="$1"
else
  VERSION="latest"
fi

export VERSION
TOP_DIR=$(pwd)
export TOP_DIR
COMMIT_HASH=$(git rev-parse --short HEAD)
export COMMIT_HASH

echo ${VERSION}
if [ -d site ]
then
  rm -rf site
fi

printf "generate and publish documents"
mkdocs build --config-file mkdocs.yml --site-dir "site/online/${VERSION}"
mkdocs build --config-file mkdocs_offline.yml --site-dir "site/offline/${VERSION}"

cp docs/redirect-page.html site/index.html

if [ -d "site/offline/${VERSION}" ]
then
  cd site/offline || exit
  mv "${VERSION}" "DTaaS-${VERSION}-html"
  zip -r "DTaaS-${VERSION}-html.zip" "DTaaS-${VERSION}-html"
fi

cd "${TOP_DIR}" || exit
git checkout webpage-docs

# If you want to make the current branch into docs branch
# use the following commands to clean up the irrelevant files
# rm -rf client deploy docs files LICENSE.md mkdocs.yml mkdocs_offline.yml README.md servers ssl STATUS.md
# rm -rf .git-hooks/*
# rm script/configure-git-hooks.sh script/grafana.sh script/influx.sh script/install.bash

if [ -d "${VERSION}" ]; then
  rm -rf "${VERSION}"
fi

mv "site/online/${VERSION}" .
mv "site/offline/${VERSION}/pdf/DTaaS-docs.pdf" "${VERSION}/pdf/DTaaS-${VERSION}.pdf"
rmdir "site/offline/${VERSION}/pdf" || exit
mv "site/offline/${VERSION}-html.zip" .
mv "site/offline/pdf/${VERSION}-html.zip" .
mv site/index.html .

git add .
git commit -m "docs for ${COMMIT_HASH} commit"