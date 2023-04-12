# DTaaS on Single Vagrant Machine

This directory contains code for running DTaaS application inside one vagrant VM. The setup requires a machine which can spare 16GB RAM, 8 vCPUs and 50GB Hard Disk space to the vagrant box.

A dummy **foo.com** URL has been used for illustration. Please change this to your unique website URL.

Please follow these steps to make this work in your local environment.


In this setup, all the user (Jupyter) workspaces shall be run on server1 while all the services will be run on server2.

```txt
Default number of users: two
Default services: rabbitmq, influxdb, grafana
```



