#start RabbitMQ server
docker run -d \
 --name rabbitmq-server \
 -p 15672:15672 -p 5672:5672 \
 rabbitmq:3-management
# setup users and permissions from within the rabbitmq container
docker exec rabbitmq-server rabbitmqctl add_user incubator incubator
docker exec rabbitmq-server rabbitmqctl set_permissions -p "/" incubator ".*" ".*" ".*"

#start Grafana server
docker run -d \
 -p 3000:3000 \
 --name=grafana-test \
 -e "GF_SERVER_SERVE_FROM_SUB_PATH=true" \
 -e "GF_SERVER_DOMAIN=localhost" \
 -e "GF_SERVER_ROOT_URL=%(protocol)s://%(domain)s:%(http_port)s/vis" \
 -e "GF_PATHS_CONFIG=/etc/grafana/grafana.ini"  \
 -e "GF_PATHS_DATA=/var/lib/grafana" \
 -e "GF_PATHS_HOME=/usr/share/grafana" \
 -e "GF_PATHS_LOGS=/var/log/grafana" \
 -e "GF_PATHS_PLUGINS=/var/lib/grafana/plugins" \
 -e "GF_PATHS_PROVISIONING=/etc/grafana/provisioning" \
 -e "HOME=/home/grafana" \
  grafana/grafana
printf "Complete the setup from GUI"

#-------------
printf "\n\n start the InfluxDB server"
printf ".........................."
# note: InfluxDB doesn't work on /vagrant shared folder
INFLUXDB_DATA="${PWD}/data/influxdb2"
mkdir -p "$INFLUXDB_DATA"

# Remember to change the settings
# src: https://hub.docker.com/_/influxdb/
docker run -d -p 80:8086 \
  --name influxdb24 \
  -v "$INFLUXDB_DATA/data":/var/lib/influxdb2 \
  -v "$INFLUXDB_DATA/config":/etc/influxdb2 \
  -e DOCKER_INFLUXDB_INIT_MODE=setup \
  -e DOCKER_INFLUXDB_INIT_USERNAME=dtaas \
  -e DOCKER_INFLUXDB_INIT_PASSWORD=dtaas1357 \
  -e DOCKER_INFLUXDB_INIT_ORG=dtaas \
  -e DOCKER_INFLUXDB_INIT_BUCKET=dtaas \
  influxdb:2.4

#docker run -d -p 9086:8086 \
# --name influx24 \
# -v ${PWD}/data/influxdb2:/var/lib/influxdb2 \
# influxdb:2.4
printf "Complete the setup from GUI"
