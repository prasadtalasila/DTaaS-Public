#!/bin/bash

#-------------
echo "\n\n start the DTaaS client server"
echo ".........................."
cd /home/vagrant/DTaaS
git fetch --all
git checkout feature/distributed-demo

cd /home/vagrant/DTaaS/client
yarn install    #install the nodejs dependencies
yarn build      #build the react app into build/ directory

#one of the environments; specify only one; "dev" used the REACT_APP_ENV is not set
yarn configapp dev
#yarn start &	#start the application in the background
nohup serve -s build -l 4000 & disown

#-------------
echo "\n\n start the jupyter notebook server"
cd /home/vagrant/DTaaS/data/assets

docker run -d \
 -p 8090:8080 \
  --name "ml-workspace-user1" \
  -v "/home/vagrant/DTaaS/data/assets/user1:/workspace" \
  -v "/home/vagrant/DTaaS/data/assets/common:/workspace/common:ro" \
  --env AUTHENTICATE_VIA_JUPYTER="" \
  --env WORKSPACE_BASE_URL="user1" \
  --shm-size 512m \
  --restart always \
  mltooling/ml-workspace:0.13.2

#-------------
echo "\n\n start the traefik gateway server"
echo ".........................."
cd /home/vagrant/DTaaS/servers/config/gateway
sudo docker run -d \
 --name "traefik-gateway" \
 --network=host -v $PWD/traefik.yml:/etc/traefik/traefik.yml \
 -v $PWD/auth:/etc/traefik/auth \
 -v $PWD/dynamic:/etc/traefik/dynamic \
 -v /var/run/docker.sock:/var/run/docker.sock \
 traefik:v2.5

