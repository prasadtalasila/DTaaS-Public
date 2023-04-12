#!/bin/bash
printf "gateway provision script"


#-------------
printf "\n\n start the DTaaS client server"
printf ".........................."
cd /vagrant/DTaaS/client || exit

#yarn install    #install the nodejs dependencies
#yarn build      #build the react app into build/ directory

#one of the environments; specify only one; "dev" used the REACT_APP_ENV is not set
#yarn configapp
yarn start &	#start the application in the background


#-------------
printf "\n\n start the jupyter notebook server"
cd /home/vagrant || exit
cp -R /vagrant/assets .
chown -R vagrant:vagrant assets

docker run -d \
 -p 8090:8080 \
  --name "ml-workspace-user1" \
  -v "${PWD}/assets/user/1:/workspace" \
  -v "${PWD}/assets/shared:/workspace/shared:ro" \
  --env AUTHENTICATE_VIA_JUPYTER="" \
  --env WORKSPACE_BASE_URL="user/1" \
  --shm-size 512m \
  --restart always \
  mltooling/ml-workspace:0.13.2

docker run -d \
 -p 8092:8080 \
  --name "ml-workspace-user2" \
  -v "${PWD}/assets/user/2:/workspace" \
  -v "${PWD}/assets/shared:/workspace/shared:ro" \
  --env AUTHENTICATE_VIA_JUPYTER="" \
  --env WORKSPACE_BASE_URL="user/2" \
  --shm-size 512m \
  --restart always \
  mltooling/ml-workspace:0.13.2


#-------------
printf "\n\n start the traefik gateway server"
printf ".........................."
cp -R /vagrant/gateway /home/vagrant
sudo chown -R vagrant:vagrant /home/vagrant/gateway
cd /home/vagrant/gateway || exit
sudo docker run -d \
 --network=host -v "$PWD/traefik.yml:/etc/traefik/traefik.yml" \
 -v "$PWD/auth:/etc/traefik/auth" \
 -v "$PWD/dynamic:/etc/traefik/dynamic" \
 -v /var/run/docker.sock:/var/run/docker.sock \
 traefik:v2.5

# access the services on server2 from server1
# RabbitMQ
ssh -i /vagrant/vagrant -fNT -L 15672:localhost:15672 vagrant@server2.foo.com
ssh -i /vagrant/vagrant -fNT -L 5672:localhost:5672 vagrant@server2.foo.com

#InfluxDB
ssh -i /vagrant/vagrant -fNT -L 40000:localhost:80 vagrant@worker4-server.lab.cps.digit.au.dk
#Grafana
ssh -i /vagrant/vagrant -fNT -L 40005:localhost:3000 vagrant@worker4-server.lab.cps.digit.au.dk

