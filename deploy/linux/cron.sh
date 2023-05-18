#!/bin/bash

# restart the react website if it's not already running

nc -z localhost 4000
PORT_STATUS=$?
if (( PORT_STATUS == 1 ))
then
  echo "starting react website"
  cd /home/vagrant/DTaaS/client
  nohup serve -s build -l 4000 & disown
fi


# restart lib microservice if it's not running
nc -z localhost 4001
PORT_STATUS=$?
if (( PORT_STATUS == 1 ))
then
  cd /home/vagrant/DTaaS/servers/lib
  nohup yarn start & disown
fi


docker start traefik-gateway
