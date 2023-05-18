# Install DTaaS on Ubuntu OS

This directory contains code for running DTaaS application on Ubuntu 20.04 Operating System. The setup requires a machine which can spare 4GB RAM, 3 vCPUs and 50GB Hard Disk space to the DTaaS software.

A dummy **foo.com** URL has been used for illustration. Please change this to your unique website URL.

## Public Server with External SSL provider

This scenario assumes that you have a server that is directly connected to Internet and can get LetsEncrypt SSL certificates. Please follow these steps.

1. Create TLS certificates for Traefik gateway server. This enables serving of DTaaS application HTTPS protocol. If your webserver has direct connection to Internet and has a valid DNS name, please use [LetsEncrypt](https://letsencrypt.org/getting-started/) to generate the required certificates. Otherwise you can use follow the instructions in [README](../../ssl/README.md) of the private certificate generator.
1. Copy the generated TLS certificates in [certs](gateway/certs/) directory. Use `fullchain.pem` as name for public key and `privkey.pem` as name for private key.
1. Replace the default [gateway config directory](../../servers/config/gateway/) with the gateway directory available in this directory.

1. Start the gateway

```bash
cd ~/DTaaS/servers/config/gateway
sudo docker run -d \               
  --network=host \
  --name "traefik-gateway" \
  -v "$PWD/traefik.yml:/etc/traefik/traefik.yml" \
  -v "$PWD/dynamic:/etc/traefik/dynamic" \
  -v "$PWD/certs:/etc/traefik/certs" \
  -v "$PWD/auth:/etc/traefik/auth" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  traefik:v2.5
```

## Behind a proxy or hosting without https

This scenario assumes that your DTaaS installation is not responsible for HTTPS security. Please follow these steps.

The Traefik gateway configuration file will be at `/home/vagrant/DTaaS/servers/config/gateway/dynamic/fileConfig.yml`. Update it as per instructions in this [README](../../../servers/config/gateway/README.md).

## Create User Workspaces

There are two scripts to create necessary workspace for users and launch docker containers for using these workspaces. Please run:

1. The `files.sh` script create the required workspaces for the users.
1. The `users.sh` script create the runs the required docker containers to use workspaces. 

## Launch React Website

Change the React website configuration in _client/build/env.js_.

window.env = {
  REACT_APP_ENVIRONMENT: 'prod',
  REACT_APP_URL: 'https://foo.com/',
  REACT_APP_URL_BASENAME: '',
  REACT_APP_URL_DTLINK: '/lab',
  REACT_APP_URL_LIBLINK: '',
  REACT_APP_WORKBENCHLINK_TERMINAL: '/terminals/main',
  REACT_APP_WORKBENCHLINK_VNCDESKTOP: '/tools/vnc/?password=vncpassword',
  REACT_APP_WORKBENCHLINK_VSCODE: '/tools/vscode/',
  REACT_APP_WORKBENCHLINK_JUPYTERLAB: '/lab',
  REACT_APP_WORKBENCHLINK_JUPYTERNOTEBOOK: '',
};


Serve the react website.

```bash
cd ~/DTaaS/client
nohup serve -s build -l 4000 & disown
```

Now you should be able to access the DTaaS application at: _http://foo.com_
