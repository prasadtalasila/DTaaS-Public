#!/bin/bash
set -eux

printf "NOTE\n"
printf "----\n"
printf "This script installs DTaaS with default settings.\n"
printf "The setup is good for testing but not for secure installation.\n"


printf "\n\nDownload the required docker images\n"
printf "---------\n"

docker pull traefik:v2.5 || exit
docker pull influxdb:2.4 || exit
docker pull mltooling/ml-workspace:0.13.2 || exit
docker pull grafana/grafana || exit
docker pull telegraf || exit
docker pull gitlab/gitlab-ce:15.10.0-ce.0 || exit


printf "\n\nCloning the DTaaS codebase\n"
printf "---------\n"
if [-d DTaaS ]
then
  cd DTaaS || exit
else
  git clone https://github.com/INTO-CPS-Association/DTaaS.git DTaaS
  cd DTaaS || exit
  git fetch --all
  git checkout release-v0.2
fi

TOP_DIR=$(pwd)

#-------------
printf "\n\n start the react website"
cd "${TOP_DIR}/client" || exit
yarn install
yarn build

#one of the environments; specify only one; "dev" used the REACT_APP_ENV is not set
yarn configapp dev
cp "${TOP_DIR}/deploy/config/client/env.js" build/env.js
nohup serve -s build -l 4000 & disown

#-------------
printf "\n\n start the user workspaces\n"
printf "--------\n"
docker run -d \
 -p 8090:8080 \
  --name "ml-workspace-user1" \
  -v "${TOP_DIR}/files/user1:/workspace" \
  -v "${TOP_DIR}/files/common:/workspace/common:ro" \
  --env AUTHENTICATE_VIA_JUPYTER="" \
  --env WORKSPACE_BASE_URL="user1" \
  --shm-size 512m \
  --restart always \
  mltooling/ml-workspace:0.13.2

docker run -d \
 -p 8091:8080 \
  --name "ml-workspace-user2" \
  -v "${TOP_DIR}/files/user2:/workspace" \
  -v "${TOP_DIR}/files/common:/workspace/common:ro" \
  --env AUTHENTICATE_VIA_JUPYTER="" \
  --env WORKSPACE_BASE_URL="user2" \
  --shm-size 512m \
  --restart always \
  mltooling/ml-workspace:0.13.2

#-------------
printf "\n\n start the traefik gateway server\n"
printf "--------\n"
cd "${TOP_DIR}/servers/config/gateway" || exit
cp "${TOP_DIR}/deploy/config/gateway/auth" auth
cp "${TOP_DIR}/deploy/config/gateway/fileConfig.yml" "dynamic/fileConfig.yml"

sudo docker run -d \
 --name "traefik-gateway" \
 --network=host -v "$PWD/traefik.yml:/etc/traefik/traefik.yml" \
 -v "$PWD/auth:/etc/traefik/auth" \
 -v "$PWD/dynamic:/etc/traefik/dynamic" \
 -v /var/run/docker.sock:/var/run/docker.sock \
 traefik:v2.5

