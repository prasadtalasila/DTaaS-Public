# DTaaS on Single Vagrant Machine

This directory contains code for running DTaaS application in two vagrant VMs. The setup requires two machines with the following configuration:

Machine1: 16GB RAM, 8 vCPUs and 50GB Hard Disk space

Machine2: 6GB RAM, 3 vCPUs and 50GB Hard Disk space

```txt
Default number of users: two
Default services: rabbitmq, influxdb, grafana
```


A dummy **foo.com** URL has been used for illustration. Please change this to your unique website URL.

In this setup, all the user (Jupyter) workspaces shall be run on server1 while all the services will be run on server2.


Please follow these steps to make this work in your local environment.


1. Create [**dtaas** Vagrant box](../make_boxes/dtaas/README.md). Copy _vagrant_ SSH private key here. This shall be useful for logging into the vagrant machines created for two-machine deployment. You would have created an SSH key pair - _vagrant_ and _vagrant.pub_. The _vagrant_ is the private SSH key and is needed for the next steps.
1. Copy _vagrant_ SSH private key into the current directory (`deploy/vagrant/single-machine`).
1. Update the **boxes.json**. Fields to update are:
    1. `name` - name of server1 (`"name" = "workspaces"`)
    1. `hostname` - hostname of server1 (`"name" = "server1.foo.com"`)
    1. MAC address (`:mac => "xxxxxxxx"`). This change is required if you have a DHCP server assigning domain names based on MAC address. Otherwise, you can leave this field unchanged.
    1. `name` - name of server2 (`"name" = "services"`)
    1. `hostname` - hostname of server2 (`"name" = "server2.foo.com"`)
    1. MAC address (`:mac => "xxxxxxxx"`). This change is required if you have a DHCP server assigning domain names based on MAC address. Otherwise, you can leave this field unchanged.
    1. Other adjustments are optional.

### Server1
1. Execute the following commands from terminal
```bash
vagrant up --provision server1
vagrant ssh
```

The Traefik gateway configuration file will be at `/home/vagrant/DTaaS/servers/config/gateway/dynamic/fileConfig.yml`. Update it as per instructions in this [README](../../../servers/config/gateway/README.md).


Change the React website configuration in _client/build/env.js_.
```js
window.env = {
  REACT_APP_ENVIRONMENT: 'development',
  REACT_APP_URL_LIB: 'http://foo.com/user1/shared/filebrowser/files/workspace/?token=admin',
  REACT_APP_URL_DT: 'http://foo.com/user1/lab',
  REACT_APP_URL_WORKBENCH: 'http://foo.com/user1',
};
```
Serve the react website. From inside the vagrant machine,
```bash
cd ~/DTaaS/client
nohup serve -s build -l 4000 & disown
```

Now you should be able to access the DTaaS application at: _http://foo.com_

Each user gets a dedicated workspaces. Two users have been provisioned in this default setup. You can update the configuration to have more users. All the users have the same password, please keep this in mind while allowing more users.

The following URLs must work now:
* http://foo.com (website; by default this is configured for a single user)
* http://foo.com/user1 (user1 workspace)
* http://foo.com/user2 (user2 workspace)

### Server2

1. Execute the following commands from terminal

```
vagrant up --provision server2
vagrant ssh
```

RabbitMQ, Grafana and InfluxDB services are provisioned on this server. 
InfluxDB webUI will be available at: server2.foo.com.

Other services are available at:

| Service | URL | Port | External Access |
|:---|:---|:---|:---|
| InfluxDB |  |  |  |
||


### Linking The Two Servers

The services running on server2 must be made available on server1. Hence SSH commands need to be executed on server1 to perform remote port fowarding from server2 to server1. Log into server1 and perform

```
./link.sh
```
